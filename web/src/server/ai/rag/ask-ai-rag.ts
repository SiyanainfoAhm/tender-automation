import "server-only";

import { EMBEDDING_DIMENSIONS } from "@/server/ai/rag/types";
import { embedTexts } from "@/server/ai/rag/embeddings";
import {
  assignEvidenceIds,
  buildGroundedContext,
  parseCitations,
  trimEvidenceToBudget,
} from "@/server/ai/rag/citations";
import {
  searchCompanyChunksHybrid,
  searchTenderChunksHybrid,
  mergeRetrievedChunkLists,
} from "@/server/ai/rag/hybrid-search";
import { getTenderIndexReadiness } from "@/server/ai/rag/index-readiness";
import {
  ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
  ensureOnDemandTenderIndexing,
} from "@/server/ai/rag/on-demand-tender-index";
import {
  buildFtsQuery,
  normalizeAskAiQuery,
  resolveAskAiAction,
} from "@/server/ai/rag/intents";
import { buildActionRetrievalQueries } from "@/server/ai/rag/action-retrieval";
import { isBroadAskAiAction } from "@/lib/ai/ask-ai-actions";
import {
  MAX_COMPANY_CHUNKS,
  MAX_TENDER_CHUNKS,
} from "@/server/ai/rag/retrieval-types";
import {
  buildAskAiUserPrompt,
  getAskAiChatModel,
  GROUNDED_TENDER_SYSTEM_PROMPT,
} from "@/server/ai/rag/prompts";
import type {
  AskAiRagReply,
  EvidenceItem,
} from "@/server/ai/rag/retrieval-types";
import type {
  AskAiAction,
  AskAiRetrievalMeta,
  AskAiStreamErrorCode,
} from "@/lib/ai/ask-ai-stream";
import { getOpenAiClient } from "@/server/ingestion/structuredExtract";
import { getTenderById } from "@/server/repositories/tenderRepository";

export const ASK_AI_RETRIEVAL_TIMEOUT_MS = 20_000;
export const ASK_AI_MODEL_TIMEOUT_MS = 90_000;

export type PreparedTenderRag = {
  startedAt: number;
  tenderId: string;
  companyId: string;
  normalizedQuestion: string;
  action: AskAiAction;
  warnings: string[];
  indexStatus: "ready" | "partial" | "none";
  /** When set, skip OpenAI and return this answer (legacy early exits only). */
  earlyAnswer?: string | null;
  evidence: EvidenceItem[];
  userPrompt: string;
  systemPrompt: string;
  model: string;
  timings: {
    queryEmbeddingMs: number;
    tenderVectorMs: number;
    tenderFtsMs: number;
    companyVectorMs: number;
    companyFtsMs: number;
    retrievalTotalMs: number;
    promptBuildMs: number;
  };
  contextTokensApprox: number;
  tenderChunks: number;
  companyChunks: number;
  embeddingTokens?: number;
};

function logRag(event: string, payload: Record<string, unknown>) {
  console.info("[ai-rag-ask]", event, payload);
}

export function extractResponsesText(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const record = response as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: unknown }> }>;
  };
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }
  const nested = record.output?.[0]?.content?.[0]?.text;
  return typeof nested === "string" ? nested.trim() : "";
}

/**
 * Expand short/ambiguous follow-ups using recent user questions for retrieval only.
 * Prior assistant answers are never treated as factual evidence.
 */
export function buildRetrievalQuestion(options: {
  question: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
}): string {
  const recentUser = (options.conversation || [])
    .filter((item) => item.role === "user")
    .map((item) => item.content.trim())
    .filter(Boolean)
    .slice(-3);

  const looksLikeFollowUp =
    options.question.length < 80 ||
    /\b(it|that|this|those|them|we|our|meet|qualify)\b/i.test(options.question);

  if (!looksLikeFollowUp || recentUser.length === 0) {
    return options.question;
  }

  return normalizeAskAiQuery(
    `${recentUser.join(" ")} ${options.question}`,
  ).slice(0, 1_500);
}

export function buildRetrievalMeta(
  prepared: PreparedTenderRag,
  options: {
    llmMs: number;
    llmFirstTokenMs?: number;
    streamed?: boolean;
  },
): AskAiRetrievalMeta {
  return {
    action: prepared.action,
    queryEmbeddingMs: prepared.timings.queryEmbeddingMs,
    tenderVectorMs: prepared.timings.tenderVectorMs,
    tenderFtsMs: prepared.timings.tenderFtsMs,
    companyVectorMs: prepared.timings.companyVectorMs,
    companyFtsMs: prepared.timings.companyFtsMs,
    retrievalTotalMs: prepared.timings.retrievalTotalMs,
    promptBuildMs: prepared.timings.promptBuildMs,
    llmMs: options.llmMs,
    totalMs: Date.now() - prepared.startedAt,
    tenderChunks: prepared.tenderChunks,
    companyChunks: prepared.companyChunks,
    contextTokensApprox: prepared.contextTokensApprox,
    indexStatus: prepared.indexStatus,
    llmFirstTokenMs: options.llmFirstTokenMs,
    streamed: options.streamed,
  };
}

/**
 * Shared RAG preparation (retrieval + prompt). No OpenAI generation.
 * Does NOT download SharePoint documents.
 */
export async function prepareTenderRagRequest(options: {
  tenderId: string;
  companyId: string;
  message: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  action?: string | null;
  signal?: AbortSignal;
}): Promise<PreparedTenderRag> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const normalizedQuestion = normalizeAskAiQuery(options.message);
  if (!normalizedQuestion) throw new Error("A question is required.");

  throwIfAborted(options.signal);

  const tenderLoaded = await getTenderById(options.tenderId);
  if (!tenderLoaded) throw new Error("Tender not found.");

  const action = resolveAskAiAction(normalizedQuestion, options.action);
  const readiness = await getTenderIndexReadiness(options.tenderId);
  if (readiness.status === "none") {
    // On-demand indexing will start in the stream/Ask AI layer.
  } else {
    warnings.push(...readiness.warnings);
  }

  if (readiness.status === "none") {
    return {
      startedAt,
      tenderId: options.tenderId,
      companyId: options.companyId,
      normalizedQuestion,
      action,
      warnings,
      indexStatus: "none",
      // Stream / Ask AI layer starts on-demand indexing; do not invent an answer here.
      earlyAnswer: null,
      evidence: [],
      userPrompt: "",
      systemPrompt: GROUNDED_TENDER_SYSTEM_PROMPT,
      model: getAskAiChatModel(),
      timings: {
        queryEmbeddingMs: 0,
        tenderVectorMs: 0,
        tenderFtsMs: 0,
        companyVectorMs: 0,
        companyFtsMs: 0,
        retrievalTotalMs: 0,
        promptBuildMs: 0,
      },
      contextTokensApprox: 0,
      tenderChunks: 0,
      companyChunks: 0,
    };
  }

  const client = getOpenAiClient();
  if (!client) throw new Error("OpenAI is not configured for this application.");

  // Prefer explicit action for retrieval; follow-ups may enrich the question text.
  const retrievalQuestion = buildRetrievalQuestion({
    question: normalizedQuestion,
    conversation: options.conversation,
  });
  const retrievalAction = resolveAskAiAction(
    retrievalQuestion,
    options.action ?? action,
  );

  const queries = buildActionRetrievalQueries({
    action: retrievalAction,
    question: retrievalQuestion,
  });

  throwIfAborted(options.signal);

  const embedStarted = Date.now();
  const { embeddings, embeddingTokens } = await embedTexts(queries);
  const queryEmbeddingMs = Date.now() - embedStarted;
  if (embeddings.length !== queries.length) {
    throw new Error("Embedding batch size mismatch for retrieval queries.");
  }
  for (const vector of embeddings) {
    if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Invalid query embedding dimension ${vector?.length ?? 0}; expected ${EMBEDDING_DIMENSIONS}.`,
      );
    }
  }

  throwIfAborted(options.signal);

  const retrievalStarted = Date.now();
  const tenderLimit = isBroadAskAiAction(retrievalAction)
    ? Math.min(MAX_TENDER_CHUNKS + 2, 10)
    : MAX_TENDER_CHUNKS;
  const companyLimit = isBroadAskAiAction(retrievalAction)
    ? Math.min(MAX_COMPANY_CHUNKS + 1, 6)
    : MAX_COMPANY_CHUNKS;

  const perQuery = await Promise.all(
    queries.map(async (query, index) => {
      const queryEmbedding = embeddings[index]!;
      const ftsQuery = buildFtsQuery({
        normalizedQuestion: query,
        action: retrievalAction,
      });
      const [tenderSearch, companySearch] = await Promise.all([
        searchTenderChunksHybrid({
          tenderId: options.tenderId,
          queryEmbedding,
          ftsQuery,
          matchCount: tenderLimit * 2,
        }),
        searchCompanyChunksHybrid({
          companyId: options.companyId,
          queryEmbedding,
          ftsQuery,
          matchCount: companyLimit * 2,
        }),
      ]);
      return { tenderSearch, companySearch };
    }),
  );

  const tenderChunks = mergeRetrievedChunkLists(
    perQuery.map((row) => row.tenderSearch.chunks),
    tenderLimit,
  );
  const companyChunks = mergeRetrievedChunkLists(
    perQuery.map((row) => row.companySearch.chunks),
    companyLimit,
  );

  const tenderVectorMs = perQuery.reduce(
    (sum, row) => sum + row.tenderSearch.vectorMs,
    0,
  );
  const tenderFtsMs = perQuery.reduce(
    (sum, row) => sum + row.tenderSearch.ftsMs,
    0,
  );
  const companyVectorMs = perQuery.reduce(
    (sum, row) => sum + row.companySearch.vectorMs,
    0,
  );
  const companyFtsMs = perQuery.reduce(
    (sum, row) => sum + row.companySearch.ftsMs,
    0,
  );
  const retrievalTotalMs = Date.now() - retrievalStarted;

  const promptStarted = Date.now();
  let evidence = assignEvidenceIds({
    tenderChunks,
    companyChunks,
  });
  evidence = trimEvidenceToBudget(evidence);
  const { contextText, contextTokensApprox } = buildGroundedContext(evidence);

  if (evidence.length === 0) {
    warnings.push(
      "No sufficiently relevant indexed chunks were retrieved for this question.",
    );
  } else if (isBroadAskAiAction(action)) {
    const emptyQueryCount = perQuery.filter(
      (row) =>
        row.tenderSearch.chunks.length === 0 &&
        row.companySearch.chunks.length === 0,
    ).length;
    if (emptyQueryCount > 0 || tenderChunks.length < 3) {
      warnings.push(
        "Some indexed tender sections were not sufficiently represented in retrieved evidence. Verify the full RFP before submission.",
      );
    }
  }

  const historyText = (options.conversation || [])
    .slice(-6)
    .map(
      (item) =>
        `${item.role === "user" ? "User" : "Assistant"}: ${item.content.slice(0, 2_000)}`,
    )
    .join("\n\n");

  const userPrompt = buildAskAiUserPrompt({
    question: normalizedQuestion,
    action,
    historyText,
    contextText,
    tenderTitle:
      typeof tenderLoaded.tender.title === "string"
        ? tenderLoaded.tender.title
        : null,
  });
  const promptBuildMs = Date.now() - promptStarted;

  return {
    startedAt,
    tenderId: options.tenderId,
    companyId: options.companyId,
    normalizedQuestion,
    action,
    warnings,
    indexStatus: readiness.status,
    evidence,
    userPrompt,
    systemPrompt: GROUNDED_TENDER_SYSTEM_PROMPT,
    model: getAskAiChatModel(),
    timings: {
      queryEmbeddingMs,
      tenderVectorMs,
      tenderFtsMs,
      companyVectorMs,
      companyFtsMs,
      retrievalTotalMs,
      promptBuildMs,
    },
    contextTokensApprox,
    tenderChunks: tenderChunks.length,
    companyChunks: companyChunks.length,
    embeddingTokens,
  };
}

/** Non-streaming generation on a prepared RAG request. */
export async function generateTenderRagAnswer(
  prepared: PreparedTenderRag,
  options?: { signal?: AbortSignal },
): Promise<AskAiRagReply> {
  if (prepared.indexStatus === "none") {
    const retrievalMeta = buildRetrievalMeta(prepared, {
      llmMs: 0,
      streamed: false,
    });
    retrievalMeta.indexStatus = "indexing";
    return {
      answer: "",
      sources: [],
      warnings: [
        ...prepared.warnings.filter(
          (w) => !/not been indexed|not indexed yet/i.test(w),
        ),
        ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
      ],
      retrievalMeta,
    };
  }

  if (prepared.earlyAnswer) {
    const retrievalMeta = buildRetrievalMeta(prepared, {
      llmMs: 0,
      streamed: false,
    });
    return {
      answer: prepared.earlyAnswer,
      sources: [],
      warnings: prepared.warnings,
      retrievalMeta,
    };
  }

  const client = getOpenAiClient();
  if (!client) throw new Error("OpenAI is not configured for this application.");

  throwIfAborted(options?.signal);

  const llmStarted = Date.now();
  const response = await client.responses.create(
    {
      model: prepared.model,
      input: [
        { role: "system", content: prepared.systemPrompt },
        { role: "user", content: prepared.userPrompt },
      ],
    },
    { signal: options?.signal },
  );
  const llmMs = Date.now() - llmStarted;

  const answer = extractResponsesText(response);
  if (!answer) throw new Error("OpenAI returned an empty assessment.");

  const warnings = [...prepared.warnings];
  const cited = parseCitations({ answer, evidence: prepared.evidence });
  warnings.push(...cited.warnings);

  const retrievalMeta = buildRetrievalMeta(prepared, {
    llmMs,
    streamed: false,
  });

  logRag("completed", {
    tender_id: prepared.tenderId,
    company_id: prepared.companyId,
    ...retrievalMeta,
  });

  return {
    answer,
    sources: cited.sources,
    warnings,
    retrievalMeta,
  };
}

/**
 * Indexed hybrid RAG Ask AI path (non-streaming).
 * Does NOT download SharePoint documents or run extraction at question time.
 */
export async function askTenderAiRag(options: {
  tenderId: string;
  companyId: string;
  message: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  action?: string | null;
  signal?: AbortSignal;
  sessionToken?: string | null;
}): Promise<AskAiRagReply> {
  const prepared = await prepareTenderRagRequest(options);
  if (prepared.indexStatus === "none") {
    await ensureOnDemandTenderIndexing({
      tenderId: options.tenderId,
      companyId: options.companyId,
      sessionToken: options.sessionToken,
    });
  }
  return generateTenderRagAnswer(prepared, { signal: options.signal });
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("Request cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    name === "AbortError" ||
    message.includes("aborted") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  );
}

export function classifyAskAiError(error: unknown): {
  code: AskAiStreamErrorCode;
  message: string;
  retryable: boolean;
} {
  if (isAbortError(error)) {
    return {
      code: "REQUEST_CANCELLED",
      message: "Request cancelled.",
      retryable: false,
    };
  }
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes("not found")) {
    return { code: "NOT_FOUND", message: "Tender not found.", retryable: false };
  }
  if (lower.includes("too long") || lower.includes("required")) {
    return { code: "BAD_REQUEST", message: raw, retryable: false };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return {
      code: "MODEL_TIMEOUT",
      message: "Ask AI timed out. Please try again.",
      retryable: true,
    };
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("too many")
  ) {
    return {
      code: "MODEL_RATE_LIMIT",
      message: "Ask AI is temporarily rate limited. Please retry shortly.",
      retryable: true,
    };
  }
  if (lower.includes("openai") || lower.includes("model") || lower.includes("empty assessment")) {
    return {
      code: "MODEL_ERROR",
      message: "Ask AI couldn't complete this request.",
      retryable: true,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "Ask AI couldn't complete this request.",
    retryable: true,
  };
}

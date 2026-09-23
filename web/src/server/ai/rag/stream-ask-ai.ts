import "server-only";

import { parseCitations } from "@/server/ai/rag/citations";
import {
  buildRetrievalMeta,
  classifyAskAiError,
  isAbortError,
  prepareTenderRagRequest,
  throwIfAborted,
  type PreparedTenderRag,
} from "@/server/ai/rag/ask-ai-rag";
import { getOpenAiClient } from "@/server/ingestion/structuredExtract";
import {
  encodeSseEvent,
  type AskAiRetrievalMeta,
  type AskAiStreamEvent,
} from "@/lib/ai/ask-ai-stream";
import { actionStatusText } from "@/lib/ai/ask-ai-actions";
import { resolveAskAiAction, normalizeAskAiQuery } from "@/server/ai/rag/intents";
import {
  getActionMaxOutputTokens,
  getAskAiTimeouts,
  isAskAiDevMetaEnabled,
  TENDER_RAG_PROMPT_VERSION,
  TENDER_RAG_RETRIEVAL_VERSION,
} from "@/server/ai/rag/config";
import {
  buildAskAiCacheKey,
  chunkCachedAnswer,
  computeEvidenceHashes,
  isCacheableAskAiAction,
  lookupAskAiCache,
  storeAskAiCache,
} from "@/server/ai/rag/answer-cache";
import {
  createAskAiRequestId,
  insertAiUsageLog,
  logAskAiEvent,
} from "@/server/ai/rag/usage-log";
import { estimateTotalCostUsd } from "@/server/ai/rag/cost";
import { sanitizeAskAiSources } from "@/server/ai/rag/source-url-safety";
import { getEmbeddingModel } from "@/server/ai/rag/types";
import {
  ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
  ensureOnDemandTenderIndexing,
} from "@/server/ai/rag/on-demand-tender-index";

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  code: "RETRIEVAL_TIMEOUT" | "MODEL_TIMEOUT",
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  const timer = setTimeout(() => {
    controller.abort();
    Object.assign(controller.signal, { __askAiTimeout: code });
  }, timeoutMs);

  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function extractStreamUsage(event: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
} | null {
  if (!event || typeof event !== "object") return null;
  const record = event as {
    type?: string;
    response?: { usage?: Record<string, unknown> };
    usage?: Record<string, unknown>;
  };
  const usage = record.response?.usage || record.usage;
  if (!usage || typeof usage !== "object") return null;
  const input =
    typeof usage.input_tokens === "number"
      ? usage.input_tokens
      : typeof usage.prompt_tokens === "number"
        ? usage.prompt_tokens
        : undefined;
  const output =
    typeof usage.output_tokens === "number"
      ? usage.output_tokens
      : typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : undefined;
  const cached =
    typeof usage.input_tokens_details === "object" &&
    usage.input_tokens_details &&
    typeof (usage.input_tokens_details as { cached_tokens?: unknown })
      .cached_tokens === "number"
      ? ((usage.input_tokens_details as { cached_tokens: number }).cached_tokens)
      : undefined;
  const total =
    typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
  if (input == null && output == null && total == null) return null;
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    totalTokens: total,
  };
}

/**
 * Async generator of Ask AI SSE events over the Phase 4 RAG pipeline.
 */
export async function* streamTenderRagAnswer(options: {
  tenderId: string;
  companyId: string;
  message: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  action?: string | null;
  signal?: AbortSignal;
  userId?: string | null;
  requestId?: string;
  sessionToken?: string | null;
}): AsyncGenerator<AskAiStreamEvent> {
  const requestId = options.requestId || createAskAiRequestId();
  const startedAt = Date.now();
  let prepared: PreparedTenderRag | null = null;
  let emittedDelta = false;
  let cacheHit = false;
  let tokenUsage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    embeddingTokens?: number;
    totalTokens?: number;
  } = {};

  const resolvedAction = resolveAskAiAction(options.message, options.action);
  const timeouts = getAskAiTimeouts();

  const finishUsage = async (opts: {
    status: "success" | "cache_hit" | "error" | "cancelled";
    errorCode?: string | null;
    meta?: AskAiRetrievalMeta | null;
  }) => {
    const estimated =
      tokenUsage.inputTokens != null ||
      tokenUsage.outputTokens != null ||
      tokenUsage.embeddingTokens != null
        ? estimateTotalCostUsd(tokenUsage)
        : undefined;
    await insertAiUsageLog({
      requestId,
      companyId: options.companyId,
      userId: options.userId,
      tenderId: options.tenderId,
      action: resolvedAction,
      model: prepared?.model,
      embeddingModel: getEmbeddingModel(),
      usage: tokenUsage,
      cacheHit,
      tenderChunks: opts.meta?.tenderChunks ?? prepared?.tenderChunks,
      companyChunks: opts.meta?.companyChunks ?? prepared?.companyChunks,
      contextTokens: opts.meta?.contextTokensApprox ?? prepared?.contextTokensApprox,
      retrievalMs: opts.meta?.retrievalTotalMs ?? prepared?.timings.retrievalTotalMs,
      firstTokenMs: opts.meta?.llmFirstTokenMs,
      llmTotalMs: opts.meta?.llmMs,
      totalMs: opts.meta?.totalMs ?? Date.now() - startedAt,
      status: opts.status,
      errorCode: opts.errorCode,
      metadata: {
        promptVersion: TENDER_RAG_PROMPT_VERSION,
        retrievalVersion: TENDER_RAG_RETRIEVAL_VERSION,
        estimatedCostUsd: estimated,
      },
    });
  };

  try {
    yield {
      type: "status",
      stage: "retrieving",
      message: actionStatusText(resolvedAction),
    };

    // Cache lookup for quick actions (before expensive retrieval/LLM).
    if (isCacheableAskAiAction(resolvedAction)) {
      try {
        const hashes = await computeEvidenceHashes({
          companyId: options.companyId,
          tenderId: options.tenderId,
        });
        const cacheKey = buildAskAiCacheKey({
          companyId: options.companyId,
          tenderId: options.tenderId,
          action: resolvedAction,
          normalizedQuestion: normalizeAskAiQuery(options.message),
          tenderEvidenceHash: hashes.tenderEvidenceHash,
          companyEvidenceHash: hashes.companyEvidenceHash,
        });
        const cached = await lookupAskAiCache(cacheKey);
        if (cached) {
          cacheHit = true;
          yield {
            type: "status",
            stage: "generating",
            message: "Preparing grounded answer...",
          };
          for (const chunk of chunkCachedAnswer(cached.answer)) {
            throwIfAborted(options.signal);
            emittedDelta = true;
            yield { type: "delta", text: chunk };
          }
          const sources = sanitizeAskAiSources(cached.sources);
          yield {
            type: "sources",
            sources,
            warnings: cached.warnings,
          };
          const retrievalMeta: AskAiRetrievalMeta = {
            action: resolvedAction,
            queryEmbeddingMs: 0,
            tenderVectorMs: 0,
            tenderFtsMs: 0,
            companyVectorMs: 0,
            companyFtsMs: 0,
            retrievalTotalMs: 0,
            promptBuildMs: 0,
            llmMs: 0,
            totalMs: Date.now() - startedAt,
            tenderChunks: Number(cached.metadata.tenderChunks || 0),
            companyChunks: Number(cached.metadata.companyChunks || 0),
            contextTokensApprox: Number(cached.metadata.contextTokens || 0),
            indexStatus: "ready",
            llmFirstTokenMs: 0,
            streamed: true,
            cacheHit: true,
            promptVersion: TENDER_RAG_PROMPT_VERSION,
            retrievalVersion: TENDER_RAG_RETRIEVAL_VERSION,
          };
          if (isAskAiDevMetaEnabled()) {
            retrievalMeta.requestId = requestId;
          }
          logAskAiEvent({
            requestId,
            companyId: options.companyId,
            tenderId: options.tenderId,
            action: resolvedAction,
            cacheHit: true,
            totalMs: retrievalMeta.totalMs,
            status: "cache_hit",
          });
          await finishUsage({ status: "cache_hit", meta: retrievalMeta });
          yield { type: "done", retrievalMeta };
          return;
        }
      } catch (error) {
        console.warn("[AskAI] cache_lookup_failed", {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const retrievalGuard = withTimeout(
      options.signal,
      timeouts.retrievalMs,
      "RETRIEVAL_TIMEOUT",
    );
    try {
      prepared = await prepareTenderRagRequest({
        tenderId: options.tenderId,
        companyId: options.companyId,
        message: options.message,
        conversation: options.conversation,
        action: options.action,
        signal: retrievalGuard.signal,
      });
      tokenUsage.embeddingTokens = prepared.embeddingTokens;
    } catch (error) {
      if (isAbortError(error) && !options.signal?.aborted) {
        yield {
          type: "error",
          code: "RETRIEVAL_TIMEOUT",
          message: "Searching indexed evidence timed out. Please try again.",
          retryable: true,
        };
        await finishUsage({
          status: "error",
          errorCode: "RETRIEVAL_TIMEOUT",
        });
        return;
      }
      throw error;
    } finally {
      retrievalGuard.clear();
    }

    throwIfAborted(options.signal);

    // Zero indexed tender chunks → start Phase 3 on-demand indexing (deduped),
    // notify client, and return quickly so the UI can poll + auto-retry.
    if (prepared.indexStatus === "none") {
      const start = await ensureOnDemandTenderIndexing({
        tenderId: options.tenderId,
        companyId: options.companyId,
        sessionToken: options.sessionToken,
      });

      if (start.outcome === "no_sources") {
        yield {
          type: "error",
          code: "INDEX_FAILED",
          message: start.message,
          retryable: true,
        };
        await finishUsage({
          status: "error",
          errorCode: "INDEX_FAILED",
          meta: buildRetrievalMeta(prepared, {
            llmMs: 0,
            llmFirstTokenMs: 0,
            streamed: true,
          }),
        });
        yield {
          type: "done",
          retrievalMeta: {
            ...buildRetrievalMeta(prepared, {
              llmMs: 0,
              llmFirstTokenMs: 0,
              streamed: true,
            }),
            indexStatus: "failed",
          },
        };
        return;
      }

      yield {
        type: "status",
        stage: "indexing",
        message: ASK_AI_PREPARING_KNOWLEDGE_MESSAGE,
      };
      const retrievalMeta = buildRetrievalMeta(prepared, {
        llmMs: 0,
        llmFirstTokenMs: 0,
        streamed: true,
      });
      retrievalMeta.indexStatus = "indexing";
      if (isAskAiDevMetaEnabled()) retrievalMeta.requestId = requestId;
      logAskAiEvent({
        requestId,
        companyId: options.companyId,
        tenderId: options.tenderId,
        action: resolvedAction,
        cacheHit: false,
        totalMs: retrievalMeta.totalMs,
        status: "indexing",
        tenderChunks: 0,
        companyChunks: 0,
      });
      await finishUsage({
        status: "success",
        errorCode: "INDEXING",
        meta: retrievalMeta,
      });
      yield { type: "done", retrievalMeta };
      return;
    }

    if (prepared.earlyAnswer) {
      yield {
        type: "status",
        stage: "generating",
        message: "Preparing grounded answer...",
      };
      yield { type: "delta", text: prepared.earlyAnswer };
      emittedDelta = true;
      yield {
        type: "sources",
        sources: [],
        warnings: prepared.warnings,
      };
      const retrievalMeta = buildRetrievalMeta(prepared, {
        llmMs: 0,
        llmFirstTokenMs: 0,
        streamed: true,
      });
      if (isAskAiDevMetaEnabled()) retrievalMeta.requestId = requestId;
      logAskAiEvent({
        requestId,
        companyId: options.companyId,
        tenderId: options.tenderId,
        action: resolvedAction,
        cacheHit: false,
        totalMs: retrievalMeta.totalMs,
        status: "success",
        tenderChunks: 0,
        companyChunks: 0,
      });
      await finishUsage({
        status: "success",
        meta: retrievalMeta,
      });
      yield { type: "done", retrievalMeta };
      return;
    }

    yield {
      type: "status",
      stage: "generating",
      message: "Preparing grounded answer...",
    };

    const client = getOpenAiClient();
    if (!client) {
      yield {
        type: "error",
        code: "MODEL_ERROR",
        message: "Ask AI is not configured.",
        retryable: false,
      };
      await finishUsage({ status: "error", errorCode: "MODEL_ERROR" });
      return;
    }

    const modelGuard = withTimeout(
      options.signal,
      timeouts.modelMs,
      "MODEL_TIMEOUT",
    );
    const llmStarted = Date.now();
    let firstTokenMs: number | undefined;
    let answer = "";
    const maxOutputTokens = getActionMaxOutputTokens(prepared.action);

    try {
      let stream;
      const createStream = () =>
        client.responses.create(
          {
            model: prepared!.model,
            stream: true,
            max_output_tokens: maxOutputTokens,
            input: [
              { role: "system", content: prepared!.systemPrompt },
              { role: "user", content: prepared!.userPrompt },
            ],
          },
          { signal: modelGuard.signal },
        );

      try {
        stream = await createStream();
      } catch (error) {
        // One safe retry before first token for transient failures.
        if (isAbortError(error)) throw error;
        const classified = classifyAskAiError(error);
        if (!classified.retryable) throw error;
        const backoff = 400 + Math.floor(Math.random() * 200);
        await new Promise((r) => setTimeout(r, backoff));
        stream = await createStream();
      }

      for await (const event of stream) {
        throwIfAborted(options.signal);
        const usage = extractStreamUsage(event);
        if (usage) {
          tokenUsage = { ...tokenUsage, ...usage };
        }
        if (
          event &&
          typeof event === "object" &&
          "type" in event &&
          event.type === "response.output_text.delta" &&
          "delta" in event &&
          typeof (event as { delta?: unknown }).delta === "string"
        ) {
          const text = (event as { delta: string }).delta;
          if (!text) continue;
          if (firstTokenMs == null) {
            firstTokenMs = Date.now() - llmStarted;
          }
          answer += text;
          emittedDelta = true;
          yield { type: "delta", text };
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        if (options.signal?.aborted) {
          yield {
            type: "error",
            code: "REQUEST_CANCELLED",
            message: "Request cancelled.",
            retryable: false,
          };
          await finishUsage({
            status: "cancelled",
            errorCode: "REQUEST_CANCELLED",
          });
          return;
        }
        yield {
          type: "error",
          code: "MODEL_TIMEOUT",
          message: "Ask AI timed out. Please try again.",
          retryable: !emittedDelta,
        };
        await finishUsage({ status: "error", errorCode: "MODEL_TIMEOUT" });
        return;
      }

      const classified = classifyAskAiError(error);
      yield {
        type: "error",
        code: classified.code,
        message: emittedDelta ? "Response interrupted." : classified.message,
        retryable: !emittedDelta && classified.retryable,
      };
      await finishUsage({ status: "error", errorCode: classified.code });
      return;
    } finally {
      modelGuard.clear();
    }

    const llmMs = Date.now() - llmStarted;
    if (!answer.trim()) {
      yield {
        type: "error",
        code: "MODEL_ERROR",
        message: "Ask AI couldn't complete this request.",
        retryable: true,
      };
      await finishUsage({ status: "error", errorCode: "MODEL_ERROR" });
      return;
    }

    const warnings = [...prepared.warnings];
    const cited = parseCitations({
      answer,
      evidence: prepared.evidence,
    });
    warnings.push(...cited.warnings);
    const sources = sanitizeAskAiSources(cited.sources);

    yield {
      type: "sources",
      sources,
      warnings,
    };

    // Store cache for quick actions (fire-and-forget safe).
    if (isCacheableAskAiAction(prepared.action)) {
      try {
        const hashes = await computeEvidenceHashes({
          companyId: options.companyId,
          tenderId: options.tenderId,
        });
        const cacheKey = buildAskAiCacheKey({
          companyId: options.companyId,
          tenderId: options.tenderId,
          action: prepared.action,
          normalizedQuestion: prepared.normalizedQuestion,
          tenderEvidenceHash: hashes.tenderEvidenceHash,
          companyEvidenceHash: hashes.companyEvidenceHash,
          model: prepared.model,
        });
        await storeAskAiCache({
          companyId: options.companyId,
          tenderId: options.tenderId,
          action: prepared.action,
          cacheKey,
          answer,
          sources,
          warnings,
          tenderEvidenceHash: hashes.tenderEvidenceHash,
          companyEvidenceHash: hashes.companyEvidenceHash,
          metadata: {
            tenderChunks: prepared.tenderChunks,
            companyChunks: prepared.companyChunks,
            contextTokens: prepared.contextTokensApprox,
          },
        });
      } catch {
        // non-fatal
      }
    }

    const retrievalMeta = buildRetrievalMeta(prepared, {
      llmMs,
      llmFirstTokenMs: firstTokenMs,
      streamed: true,
    });
    retrievalMeta.cacheHit = false;
    retrievalMeta.promptVersion = TENDER_RAG_PROMPT_VERSION;
    retrievalMeta.retrievalVersion = TENDER_RAG_RETRIEVAL_VERSION;
    if (tokenUsage.inputTokens != null) {
      retrievalMeta.inputTokens = tokenUsage.inputTokens;
    }
    if (tokenUsage.outputTokens != null) {
      retrievalMeta.outputTokens = tokenUsage.outputTokens;
    }
    if (
      tokenUsage.inputTokens != null ||
      tokenUsage.outputTokens != null ||
      tokenUsage.embeddingTokens != null
    ) {
      retrievalMeta.estimatedCostUsd = estimateTotalCostUsd(tokenUsage);
    }
    if (isAskAiDevMetaEnabled()) retrievalMeta.requestId = requestId;

    logAskAiEvent({
      requestId,
      companyId: options.companyId,
      tenderId: options.tenderId,
      action: prepared.action,
      cacheHit: false,
      retrievalMs: retrievalMeta.retrievalTotalMs,
      firstTokenMs: firstTokenMs ?? null,
      llmTotalMs: llmMs,
      totalMs: retrievalMeta.totalMs,
      tenderChunks: retrievalMeta.tenderChunks,
      companyChunks: retrievalMeta.companyChunks,
      contextTokens: retrievalMeta.contextTokensApprox,
      inputTokens: tokenUsage.inputTokens ?? null,
      outputTokens: tokenUsage.outputTokens ?? null,
      estimatedCostUsd: retrievalMeta.estimatedCostUsd ?? null,
      status: "success",
    });

    await finishUsage({ status: "success", meta: retrievalMeta });
    yield { type: "done", retrievalMeta };
  } catch (error) {
    if (isAbortError(error)) {
      yield {
        type: "error",
        code: "REQUEST_CANCELLED",
        message: "Request cancelled.",
        retryable: false,
      };
      await finishUsage({
        status: "cancelled",
        errorCode: "REQUEST_CANCELLED",
      });
      return;
    }
    const classified = classifyAskAiError(error);
    yield {
      type: "error",
      code: classified.code,
      message: emittedDelta ? "Response interrupted." : classified.message,
      retryable: !emittedDelta && classified.retryable,
    };
    await finishUsage({ status: "error", errorCode: classified.code });
  }
}

/** Build an SSE Response from the Ask AI stream generator. */
export function createAskAiSseResponse(
  generator: AsyncGenerator<AskAiStreamEvent>,
  options?: { abort?: AbortController },
): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: AskAiStreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeSseEvent(event)));
      };

      try {
        for await (const event of generator) {
          if (options?.abort?.signal.aborted) {
            push({
              type: "error",
              code: "REQUEST_CANCELLED",
              message: "Request cancelled.",
              retryable: false,
            });
            break;
          }
          push(event);
        }
      } catch (error) {
        if (!closed) {
          const classified = classifyAskAiError(error);
          push({
            type: "error",
            code: classified.code,
            message: classified.message,
            retryable: classified.retryable,
          });
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      closed = true;
      try {
        options?.abort?.abort();
      } catch {
        // ignore
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

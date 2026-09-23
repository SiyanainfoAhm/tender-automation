/**
 * Phase 8 usage logging (no question/answer/prompt content).
 */
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getServerSupabase } from "@/lib/db/server";
import { getEmbeddingModel } from "@/server/ai/rag/types";
import { estimateTotalCostUsd, type TokenUsageSnapshot } from "@/server/ai/rag/cost";

export type AskAiUsageStatus =
  | "success"
  | "cache_hit"
  | "error"
  | "cancelled"
  | "rate_limited"
  | "concurrent";

export type AskAiUsageLogInput = {
  requestId: string;
  companyId?: string | null;
  userId?: string | null;
  tenderId?: string | null;
  action?: string | null;
  model?: string | null;
  embeddingModel?: string | null;
  usage?: TokenUsageSnapshot;
  cacheHit?: boolean;
  tenderChunks?: number | null;
  companyChunks?: number | null;
  contextTokens?: number | null;
  retrievalMs?: number | null;
  firstTokenMs?: number | null;
  llmTotalMs?: number | null;
  totalMs?: number | null;
  status: AskAiUsageStatus;
  errorCode?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  chunkCount?: number | null;
  metadata?: Record<string, unknown>;
};

export function createAskAiRequestId(): string {
  return randomUUID();
}

export async function insertAiUsageLog(
  input: AskAiUsageLogInput,
): Promise<void> {
  try {
    const supabase = getServerSupabase();
    const usage = input.usage || {};
    const inputTokens = usage.inputTokens ?? null;
    const outputTokens = usage.outputTokens ?? null;
    const cachedInputTokens = usage.cachedInputTokens ?? null;
    const embeddingTokens = usage.embeddingTokens ?? null;
    const totalTokens =
      usage.totalTokens ??
      (inputTokens != null || outputTokens != null || embeddingTokens != null
        ? Number(inputTokens || 0) +
          Number(outputTokens || 0) +
          Number(embeddingTokens || 0)
        : null);

    const estimated =
      inputTokens != null ||
      outputTokens != null ||
      embeddingTokens != null
        ? estimateTotalCostUsd(usage)
        : null;

    const { error } = await supabase.from("agenttender_ai_usage_logs").insert({
      request_id: input.requestId,
      company_id: input.companyId || null,
      user_id: input.userId || null,
      tender_id: input.tenderId || null,
      action: input.action || null,
      model: input.model || null,
      embedding_model: input.embeddingModel || getEmbeddingModel(),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_input_tokens: cachedInputTokens,
      embedding_tokens: embeddingTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimated,
      cache_hit: Boolean(input.cacheHit),
      tender_chunks: input.tenderChunks ?? null,
      company_chunks: input.companyChunks ?? null,
      context_tokens: input.contextTokens ?? null,
      retrieval_ms: input.retrievalMs ?? null,
      first_token_ms: input.firstTokenMs ?? null,
      llm_total_ms: input.llmTotalMs ?? null,
      total_ms: input.totalMs ?? null,
      status: input.status,
      error_code: input.errorCode || null,
      source_type: input.sourceType || null,
      source_id: input.sourceId || null,
      chunk_count: input.chunkCount ?? null,
      metadata: input.metadata || {},
    });
    if (error) {
      console.warn("[AskAI] usage_log_failed", {
        requestId: input.requestId,
        error: error.message,
      });
    }
  } catch (error) {
    console.warn("[AskAI] usage_log_failed", {
      requestId: input.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function logAskAiEvent(
  payload: Record<string, unknown>,
): void {
  // Never log question/answer/evidence/API keys.
  const safe = { ...payload };
  for (const key of [
    "question",
    "answer",
    "message",
    "prompt",
    "evidence",
    "apiKey",
    "embedding",
    "embeddings",
  ]) {
    delete safe[key];
  }
  console.info("[AskAI]", safe);
}

/** Deterministic sha256 hex of sorted content hashes. */
export function hashEvidenceVersions(contentHashes: string[]): string {
  const normalized = contentHashes
    .map((h) => String(h || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return createHash("sha256")
    .update(normalized.join("|") || "empty")
    .digest("hex");
}

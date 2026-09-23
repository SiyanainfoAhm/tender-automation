/**
 * Phase 8 cost estimation helpers (USD, approximate).
 */
import "server-only";

import { getAskAiPricing } from "@/server/ai/rag/config";

export type TokenUsageSnapshot = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  embeddingTokens?: number | null;
  totalTokens?: number | null;
};

export function estimateChatCostUsd(usage: TokenUsageSnapshot): number {
  const pricing = getAskAiPricing();
  const input = Math.max(0, Number(usage.inputTokens || 0));
  const output = Math.max(0, Number(usage.outputTokens || 0));
  // Cached input billed at a reduced rate if present; treat as 50% of input when unknown.
  const cached = Math.max(0, Number(usage.cachedInputTokens || 0));
  const billableInput = Math.max(0, input - cached) + cached * 0.5;
  return (
    (billableInput / 1_000_000) * pricing.chatInputPerMillion +
    (output / 1_000_000) * pricing.chatOutputPerMillion
  );
}

export function estimateEmbeddingCostUsd(embeddingTokens: number): number {
  const pricing = getAskAiPricing();
  return (Math.max(0, embeddingTokens) / 1_000_000) * pricing.embeddingPerMillion;
}

export function estimateTotalCostUsd(usage: TokenUsageSnapshot): number {
  return (
    estimateChatCostUsd(usage) +
    estimateEmbeddingCostUsd(Number(usage.embeddingTokens || 0))
  );
}

/** Rough token estimate when provider omits usage (tiktoken-like fallback ~4 chars/token). */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

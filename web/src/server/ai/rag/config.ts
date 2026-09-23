/**
 * Phase 8 Ask AI configuration (env-driven, safe defaults).
 */
import "server-only";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Prompt / retrieval versions — bump when behavior materially changes. */
export const TENDER_RAG_PROMPT_VERSION = "v1";
export const TENDER_RAG_RETRIEVAL_VERSION = "v1";

export function getAskAiRateLimitConfig() {
  return {
    userRequests: intEnv("AI_RATE_LIMIT_USER_REQUESTS", 20),
    userWindowSeconds: intEnv("AI_RATE_LIMIT_USER_WINDOW_SECONDS", 300),
    companyRequests: intEnv("AI_RATE_LIMIT_COMPANY_REQUESTS", 100),
    companyWindowSeconds: intEnv("AI_RATE_LIMIT_COMPANY_WINDOW_SECONDS", 300),
    maxConcurrentPerUser: intEnv("AI_MAX_CONCURRENT_PER_USER", 1),
  };
}

export function getAskAiCacheTtlSeconds(): number {
  return intEnv("AI_QUICK_ACTION_CACHE_TTL_SECONDS", 21_600);
}

export function getAskAiTimeouts() {
  return {
    retrievalMs: intEnv("AI_RETRIEVAL_TIMEOUT_MS", 20_000),
    modelMs: intEnv("AI_MODEL_TIMEOUT_MS", 90_000),
  };
}

export function getAskAiInputLimits() {
  return {
    maxQuestionChars: intEnv("AI_MAX_QUESTION_CHARS", 4_000),
    maxHistoryMessages: intEnv("AI_MAX_HISTORY_MESSAGES", 8),
    maxHistoryTokens: intEnv("AI_MAX_HISTORY_TOKENS", 2_000),
    maxContextTokens: intEnv("AI_MAX_CONTEXT_TOKENS", 5_000),
    maxOutputTokens: intEnv("AI_MAX_OUTPUT_TOKENS", 2_500),
  };
}

/** Approximate USD pricing per 1M tokens (estimated; configurable). */
export function getAskAiPricing() {
  return {
    chatInputPerMillion: floatEnv("AI_CHAT_INPUT_COST_PER_MILLION", 0.25),
    chatOutputPerMillion: floatEnv("AI_CHAT_OUTPUT_COST_PER_MILLION", 2.0),
    embeddingPerMillion: floatEnv("AI_EMBEDDING_COST_PER_MILLION", 0.02),
  };
}

/** Optional company monthly budget (USD). 0 / unset = disabled. */
export function getCompanyMonthlyBudgetUsd(): number {
  return floatEnv("AI_COMPANY_MONTHLY_BUDGET_USD", 0);
}

export function isAskAiDevMetaEnabled(): boolean {
  const value = process.env.AI_ASK_DEV_META?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/** Max output tokens by action (capped by AI_MAX_OUTPUT_TOKENS). */
export function getActionMaxOutputTokens(action: string): number {
  const hardCap = getAskAiInputLimits().maxOutputTokens;
  const byAction: Record<string, number> = {
    CHECK_TURNOVER: 900,
    CHECK_EMD_MSME: 1_100,
    CHECK_GOVERNMENT_EXPERIENCE: 1_000,
    CHECK_SIMILAR_EXPERIENCE: 1_200,
    CHECK_ELIGIBILITY: 1_400,
    CHECK_REQUIRED_DOCUMENTS: 1_400,
    IDENTIFY_RISKS: 1_500,
    SUMMARIZE_TENDER: 1_400,
    ASSESS_TENDER: 2_000,
    GENERAL: 1_200,
  };
  return Math.min(byAction[action] ?? 1_200, hardCap);
}

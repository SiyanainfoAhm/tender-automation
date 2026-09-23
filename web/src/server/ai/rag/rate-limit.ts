/**
 * Phase 8 rate limiting + concurrency control.
 *
 * Rate limits: Postgres count of recent Ask AI usage_logs (cross-instance).
 * Concurrency: in-process Map (document limitation: per Node isolate only).
 */
import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import {
  getAskAiRateLimitConfig,
  getCompanyMonthlyBudgetUsd,
} from "@/server/ai/rag/config";
import { insertAiUsageLog } from "@/server/ai/rag/usage-log";

export type RateLimitDecision =
  | { ok: true }
  | {
      ok: false;
      code: "RATE_LIMITED" | "CONCURRENT_REQUEST" | "BUDGET_EXCEEDED";
      message: string;
    };

const activeByUser = new Map<string, number>();

function concurrencyKey(companyId: string, userId: string): string {
  return `${companyId}:${userId}`;
}

export function acquireAskAiConcurrency(options: {
  companyId: string;
  userId: string;
}): RateLimitDecision {
  const config = getAskAiRateLimitConfig();
  const key = concurrencyKey(options.companyId, options.userId);
  const current = activeByUser.get(key) || 0;
  if (current >= config.maxConcurrentPerUser) {
    return {
      ok: false,
      code: "CONCURRENT_REQUEST",
      message:
        "Another Ask AI request is already in progress. Please wait for it to finish.",
    };
  }
  activeByUser.set(key, current + 1);
  return { ok: true };
}

export function releaseAskAiConcurrency(options: {
  companyId: string;
  userId: string;
}): void {
  const key = concurrencyKey(options.companyId, options.userId);
  const current = activeByUser.get(key) || 0;
  if (current <= 1) activeByUser.delete(key);
  else activeByUser.set(key, current - 1);
}

/** Test helper — clears in-process concurrency map. */
export function __resetAskAiConcurrencyForTests(): void {
  activeByUser.clear();
}

export function __getAskAiConcurrencyForTests(
  companyId: string,
  userId: string,
): number {
  return activeByUser.get(concurrencyKey(companyId, userId)) || 0;
}

async function countRecent(options: {
  companyId: string;
  userId: string;
  windowSeconds: number;
  scope: "user" | "company";
}): Promise<number> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase.rpc(
    "agenttender_ai_count_recent_requests",
    {
      p_company_id: options.companyId,
      p_user_id: options.userId,
      p_window_seconds: options.windowSeconds,
      p_scope: options.scope,
    },
  );
  if (error) {
    console.warn("[AskAI] rate_limit_count_failed", { error: error.message });
    // Fail open on counter errors to avoid blocking all Ask AI.
    return 0;
  }
  return Number(data || 0);
}

export async function checkAskAiRateLimits(options: {
  companyId: string;
  userId: string;
  requestId: string;
  tenderId?: string | null;
}): Promise<RateLimitDecision> {
  const config = getAskAiRateLimitConfig();

  const [userCount, companyCount] = await Promise.all([
    countRecent({
      companyId: options.companyId,
      userId: options.userId,
      windowSeconds: config.userWindowSeconds,
      scope: "user",
    }),
    countRecent({
      companyId: options.companyId,
      userId: options.userId,
      windowSeconds: config.companyWindowSeconds,
      scope: "company",
    }),
  ]);

  if (userCount >= config.userRequests) {
    await insertAiUsageLog({
      requestId: options.requestId,
      companyId: options.companyId,
      userId: options.userId,
      tenderId: options.tenderId,
      action: "GENERAL",
      status: "rate_limited",
      errorCode: "RATE_LIMITED",
      metadata: { scope: "user", count: userCount },
    });
    return {
      ok: false,
      code: "RATE_LIMITED",
      message:
        "You have reached the Ask AI request limit. Please wait a few minutes and try again.",
    };
  }

  if (companyCount >= config.companyRequests) {
    await insertAiUsageLog({
      requestId: options.requestId,
      companyId: options.companyId,
      userId: options.userId,
      tenderId: options.tenderId,
      action: "GENERAL",
      status: "rate_limited",
      errorCode: "RATE_LIMITED",
      metadata: { scope: "company", count: companyCount },
    });
    return {
      ok: false,
      code: "RATE_LIMITED",
      message:
        "Your company has reached the Ask AI request limit. Please wait a few minutes and try again.",
    };
  }

  const budget = getCompanyMonthlyBudgetUsd();
  if (budget > 0) {
    const monthly = await getCompanyMonthlyEstimatedCostUsd(options.companyId);
    if (monthly >= budget) {
      await insertAiUsageLog({
        requestId: options.requestId,
        companyId: options.companyId,
        userId: options.userId,
        tenderId: options.tenderId,
        action: "GENERAL",
        status: "rate_limited",
        errorCode: "BUDGET_EXCEEDED",
        metadata: { monthly, budget },
      });
      return {
        ok: false,
        code: "BUDGET_EXCEEDED",
        message:
          "Your company AI usage budget for this month has been reached. Contact an admin.",
      };
    }
  }

  return { ok: true };
}

export async function getCompanyMonthlyEstimatedCostUsd(
  companyId: string,
): Promise<number> {
  try {
    const supabase = getServerSupabase();
    const since = new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from("agenttender_ai_usage_logs")
      .select("estimated_cost_usd")
      .eq("company_id", companyId)
      .gte("created_at", since.toISOString());
    if (error) return 0;
    return (data || []).reduce(
      (sum, row) => sum + Number(row.estimated_cost_usd || 0),
      0,
    );
  } catch {
    return 0;
  }
}

/**
 * Phase 8 server-side usage aggregation helpers (no UI dashboard yet).
 */
import "server-only";

import { getServerSupabase } from "@/lib/db/server";

export type AskAiUsageSummary = {
  requestCount: number;
  cacheHits: number;
  cacheHitRate: number;
  estimatedCostUsd: number;
  avgTotalMs: number | null;
  p95TotalMs: number | null;
  byAction: Array<{ action: string; count: number; estimatedCostUsd: number }>;
};

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx] ?? null;
}

export async function getAskAiUsageSummary(options: {
  companyId: string;
  sinceIso: string;
  untilIso?: string;
}): Promise<AskAiUsageSummary> {
  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_ai_usage_logs")
    .select(
      "action, cache_hit, estimated_cost_usd, total_ms, status",
    )
    .eq("company_id", options.companyId)
    .gte("created_at", options.sinceIso)
    .not("action", "is", null);

  if (options.untilIso) {
    query = query.lt("created_at", options.untilIso);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data || [];
  const requestCount = rows.length;
  const cacheHits = rows.filter((r) => r.cache_hit).length;
  const estimatedCostUsd = rows.reduce(
    (sum, r) => sum + Number(r.estimated_cost_usd || 0),
    0,
  );
  const latencies = rows
    .map((r) => Number(r.total_ms))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const avgTotalMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;

  const byActionMap = new Map<
    string,
    { count: number; estimatedCostUsd: number }
  >();
  for (const row of rows) {
    const action = String(row.action || "GENERAL");
    const existing = byActionMap.get(action) || {
      count: 0,
      estimatedCostUsd: 0,
    };
    existing.count += 1;
    existing.estimatedCostUsd += Number(row.estimated_cost_usd || 0);
    byActionMap.set(action, existing);
  }

  return {
    requestCount,
    cacheHits,
    cacheHitRate: requestCount ? cacheHits / requestCount : 0,
    estimatedCostUsd,
    avgTotalMs,
    p95TotalMs: percentile(latencies, 95),
    byAction: Array.from(byActionMap.entries())
      .map(([action, stats]) => ({ action, ...stats }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function getAskAiDailyUsage(companyId: string) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  return getAskAiUsageSummary({
    companyId,
    sinceIso: since.toISOString(),
  });
}

export async function getAskAiMonthlyUsage(companyId: string) {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  return getAskAiUsageSummary({
    companyId,
    sinceIso: since.toISOString(),
  });
}

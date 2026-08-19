import "server-only";

import { differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";

import {
  mapToDashboardPipelineStage,
} from "@/lib/dashboard/pipeline";
import { getServerSupabase } from "@/lib/db/server";
import { resolveAnalyticsCategory } from "@/lib/analytics/category-display";
import {
  financialYearBounds,
  financialYearLabel,
  financialYearMonths,
  isInFinancialYear,
  type FinancialYearKey,
} from "@/lib/reports/financial-year";
import { computeFunnelConversions, winRate } from "@/lib/reports/funnel";
import type {
  AgeingBucket,
  CategoryPerformance,
  ClientPerformance,
  MonthlyPerformance,
  PipelineStageRow,
  PortalPerformance,
  ReportsAnalytics,
} from "@/lib/reports/types";

type TenderRow = {
  id: string;
  title: string | null;
  source_portal: string | null;
  organization: string | null;
  authority: string | null;
  project_category: string | null;
  category: string | null;
  closing_date: string | null;
  tender_value: number | string | null;
  effective_qualification_status: string | null;
  first_seen_at: string | null;
  crawled_at: string | null;
  qualified_at: string | null;
  updated_at: string | null;
};

const PORTAL_LABELS: Record<string, string> = {
  TENDER247: "Tender247",
  BIDASSIST: "BidAssist",
  GEM: "GeM",
  CPPP: "CPPP",
  EPROCURE: "eProcure",
};

const CATEGORY_COLORS = [
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#f43f5e",
  "#14b8a6",
  "#94a3b8",
];

const PIPELINE_META: Array<{
  key: "new" | "screening" | "mayBid" | "willBid" | "submitted" | "won";
  label: string;
  color: string;
  barClass: string;
}> = [
  { key: "new", label: "New", color: "#94a3b8", barClass: "bg-slate-300" },
  { key: "screening", label: "Screening", color: "#64748b", barClass: "bg-slate-400" },
  { key: "mayBid", label: "Partnership", color: "#7c3aed", barClass: "bg-violet-500" },
  { key: "willBid", label: "Will Bid", color: "#10b981", barClass: "bg-emerald-500" },
  { key: "submitted", label: "Submitted", color: "#3b82f6", barClass: "bg-blue-500" },
  { key: "won", label: "Won", color: "#16a34a", barClass: "bg-green-600" },
];

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = parseISO(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventTime(row: TenderRow): Date | null {
  return parseDate(row.first_seen_at || row.crawled_at || row.updated_at);
}

function monthKeyOf(date: Date): string {
  return format(date, "yyyy-MM");
}

function exclusiveFunnelKey(options: {
  qualificationStatus: string | null;
  submitted: boolean;
  won: boolean;
}): "new" | "screening" | "mayBid" | "willBid" | "submitted" | "won" {
  if (options.won) return "won";
  if (options.submitted) return "submitted";
  const mapped = mapToDashboardPipelineStage({
    qualificationStatus: options.qualificationStatus,
    submitted: false,
    won: false,
  });
  if (mapped === "will_bid") return "willBid";
  if (mapped === "partnership") return "mayBid";
  if (mapped === "screening") {
    if (!options.qualificationStatus) return "new";
    return "screening";
  }
  return "new";
}

async function loadSubmittedMap(
  companyId: string | null,
): Promise<Map<string, Date | null>> {
  const out = new Map<string, Date | null>();
  if (!companyId) return out;
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_workspaces")
    .select("tender_id, submitted_at")
    .eq("company_id", companyId)
    .eq("submission_status", "submitted");
  if (error) {
    console.error("[reports] submitted workspaces failed", error.message);
    return out;
  }
  for (const row of data || []) {
    out.set(String(row.tender_id), parseDate(row.submitted_at as string | null));
  }
  return out;
}

function emptyMonths(fy: FinancialYearKey): MonthlyPerformance[] {
  return financialYearMonths(fy).map((m) => ({
    monthKey: m.key,
    month: m.label,
    tendersBid: 0,
    tendersWon: 0,
    revenueWon: 0,
    profit: null,
  }));
}

/**
 * Reports analytics for one Indian financial year.
 *
 * Semantics (production fields):
 * - FY window: first_seen_at | crawled_at | submitted_at
 * - Tenders Bid: company bid workspaces submitted in FY
 * - Tenders Won / Revenue Won: award outcomes are not stored yet → 0 / —
 * - Lost: not stored; win rate uses won/(won+lost) → null when decided=0
 * - Profit / margin: cost data unavailable → null (never fabricated)
 * - Pipeline stages: FY-imported tenders, exclusive buckets via shared mapper
 * - Conversions: sequential FY-cohort shares (cannot exceed 100%)
 */
export async function getReportsAnalytics(options: {
  companyId: string | null;
  financialYear: FinancialYearKey;
}): Promise<ReportsAnalytics> {
  const bounds = financialYearBounds(options.financialYear);
  const supabase = getServerSupabase();

  const [listRes, submittedMap] = await Promise.all([
    supabase
      .from("agenttender_web_tender_list")
      .select(
        "id, title, source_portal, organization, authority, project_category, category, closing_date, tender_value, effective_qualification_status, first_seen_at, crawled_at, qualified_at, updated_at",
      )
      .limit(8000),
    loadSubmittedMap(options.companyId),
  ]);

  if (listRes.error) {
    throw new Error(listRes.error.message);
  }

  const allRows = (listRes.data || []) as TenderRow[];
  const fyRows = allRows.filter((row) => {
    const imported = eventTime(row);
    const submittedAt = submittedMap.get(row.id) ?? null;
    return (
      isInFinancialYear(imported, bounds) ||
      isInFinancialYear(submittedAt, bounds)
    );
  });

  const submittedIds = new Set(submittedMap.keys());
  const fySubmitted = [...submittedMap.entries()].filter(([, at]) =>
    isInFinancialYear(at, bounds),
  );
  const fySubmittedIds = new Set(fySubmitted.map(([id]) => id));

  const tendersBid = fySubmittedIds.size;
  const tendersWon = 0;
  const revenueWon = 0;

  const funnel = {
    new: 0,
    screening: 0,
    mayBid: 0,
    willBid: 0,
    submitted: 0,
    won: 0,
  };
  const funnelValue: Record<keyof typeof funnel, number> = {
    new: 0,
    screening: 0,
    mayBid: 0,
    willBid: 0,
    submitted: 0,
    won: 0,
  };

  for (const row of fyRows) {
    const key = exclusiveFunnelKey({
      qualificationStatus: row.effective_qualification_status,
      submitted: submittedIds.has(row.id),
      won: false,
    });
    funnel[key] += 1;
    funnelValue[key] += toNumber(row.tender_value);
  }

  const pipeline: PipelineStageRow[] = PIPELINE_META.map((meta) => ({
    key: meta.key,
    label: meta.label,
    count: funnel[meta.key],
    value: funnelValue[meta.key],
    color: meta.color,
    barClass: meta.barClass,
  }));

  const pipelineValue = pipeline
    .filter((s) => s.key !== "new")
    .reduce((sum, s) => sum + s.value, 0);
  const activeTenders =
    funnel.screening + funnel.mayBid + funnel.willBid + funnel.submitted;
  const submittedCount = funnel.submitted + funnel.won;

  const monthly = emptyMonths(options.financialYear);
  const monthIndex = new Map(monthly.map((m) => [m.monthKey, m]));
  for (const [tenderId, submittedAt] of fySubmitted) {
    if (!submittedAt) continue;
    const bucket = monthIndex.get(monthKeyOf(submittedAt));
    if (bucket) bucket.tendersBid += 1;
    void tenderId;
  }

  const portalMap = new Map<string, PortalPerformance>();
  for (const id of fySubmittedIds) {
    const row = allRows.find((r) => r.id === id);
    const key = String(row?.source_portal || "UNKNOWN");
    const existing = portalMap.get(key) || {
      portal: PORTAL_LABELS[key] || key,
      portalKey: key,
      total: 0,
      won: 0,
      lost: 0,
      pending: 0,
      winRate: null,
    };
    existing.total += 1;
    existing.pending += 1;
    portalMap.set(key, existing);
  }
  const portals = [...portalMap.values()].map((p) => ({
    ...p,
    winRate: winRate(p.won, p.lost),
  }));

  const today = startOfDay(new Date());
  const ageingSource = fyRows.filter((row) => {
    const key = exclusiveFunnelKey({
      qualificationStatus: row.effective_qualification_status,
      submitted: submittedIds.has(row.id),
      won: false,
    });
    return key !== "won" && row.effective_qualification_status !== "NO_GO";
  });
  const ageingCounts = { overdue: 0, lt7: 0, d7_14: 0, d14_30: 0 };
  for (const row of ageingSource) {
    const closing = parseDate(row.closing_date);
    if (!closing) continue;
    const days = differenceInCalendarDays(startOfDay(closing), today);
    if (days < 0) ageingCounts.overdue += 1;
    else if (days < 7) ageingCounts.lt7 += 1;
    else if (days <= 14) ageingCounts.d7_14 += 1;
    else if (days <= 30) ageingCounts.d14_30 += 1;
  }
  const ageingTotal =
    ageingCounts.overdue +
    ageingCounts.lt7 +
    ageingCounts.d7_14 +
    ageingCounts.d14_30;
  const ageingPct = (n: number) =>
    ageingTotal > 0 ? Math.round((n / ageingTotal) * 100) : 0;
  const ageing: AgeingBucket[] = [
    {
      key: "overdue",
      label: "Overdue",
      description: "Deadline passed, no decision",
      count: ageingCounts.overdue,
      percent: ageingPct(ageingCounts.overdue),
      tone: "rose",
    },
    {
      key: "lt7",
      label: "< 7 Days",
      description: "Urgent — closing soon",
      count: ageingCounts.lt7,
      percent: ageingPct(ageingCounts.lt7),
      tone: "amber",
    },
    {
      key: "d7_14",
      label: "7-14 Days",
      description: "Need immediate action",
      count: ageingCounts.d7_14,
      percent: ageingPct(ageingCounts.d7_14),
      tone: "sky",
    },
    {
      key: "d14_30",
      label: "14-30 Days",
      description: "Active preparation",
      count: ageingCounts.d14_30,
      percent: ageingPct(ageingCounts.d14_30),
      tone: "emerald",
    },
  ];

  const categoryMap = new Map<string, CategoryPerformance & { bidValue: number }>();
  for (const id of fySubmittedIds) {
    const row = allRows.find((r) => r.id === id);
    const category = resolveAnalyticsCategory({
      source_portal: row?.source_portal,
      project_category: row?.project_category,
      category: row?.category,
      title: row?.title,
    });
    const existing = categoryMap.get(category) || {
      category,
      bid: 0,
      won: 0,
      lost: 0,
      winRate: null,
      avgValue: null,
      totalRevenue: 0,
      bidValue: 0,
      color: CATEGORY_COLORS[categoryMap.size % CATEGORY_COLORS.length]!,
    };
    existing.bid += 1;
    existing.bidValue += toNumber(row?.tender_value);
    categoryMap.set(category, existing);
  }
  const categories = [...categoryMap.values()]
    .map((c, index) => ({
      category: c.category,
      bid: c.bid,
      won: c.won,
      lost: c.lost,
      winRate: winRate(c.won, c.lost),
      // Avg bid value of submitted tenders — not recognized revenue.
      avgValue: c.bid > 0 ? c.bidValue / c.bid : null,
      // Won contract value only; award outcomes are not stored yet.
      totalRevenue: c.totalRevenue,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length]!,
    }))
    .sort((a, b) => b.bid - a.bid);

  const clientMap = new Map<
    string,
    { bid: number; won: number; revenue: number; categoryRev: Map<string, number> }
  >();
  for (const id of fySubmittedIds) {
    const row = allRows.find((r) => r.id === id);
    const client =
      (row?.organization || row?.authority || "").trim() || "Unknown client";
    const category = resolveAnalyticsCategory({
      source_portal: row?.source_portal,
      project_category: row?.project_category,
      category: row?.category,
      title: row?.title,
    });
    const existing = clientMap.get(client) || {
      bid: 0,
      won: 0,
      revenue: 0,
      categoryRev: new Map<string, number>(),
    };
    existing.bid += 1;
    existing.categoryRev.set(
      category,
      (existing.categoryRev.get(category) || 0) + toNumber(row?.tender_value),
    );
    clientMap.set(client, existing);
  }
  const clients: ClientPerformance[] = [...clientMap.entries()]
    .map(([client, stats]) => {
      const dominant =
        [...stats.categoryRev.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
        null;
      return {
        client,
        category: dominant,
        tendersWon: stats.won,
        tendersBid: stats.bid,
        revenue: stats.revenue,
      };
    })
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      return b.tendersBid - a.tendersBid;
    })
    .slice(0, 8);

  return {
    financialYear: options.financialYear,
    financialYearLabel: financialYearLabel(options.financialYear),
    summary: {
      tendersBid,
      tendersWon,
      winRate: winRate(tendersWon, 0),
      revenueWon,
      pipelineValue,
      avgDealSize: tendersWon > 0 ? revenueWon / tendersWon : null,
      profitMargin: null,
      activeTenders,
      submittedCount,
    },
    monthlyTrend: monthly,
    pipeline,
    pipelineConversions: computeFunnelConversions(funnel),
    portals,
    ageing,
    monthlyFinancial: monthly,
    categories,
    clients,
    costDataAvailable: false,
  };
}

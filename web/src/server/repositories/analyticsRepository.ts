import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import {
  aggregateSourceCounts,
  aggregateStatusCounts,
} from "@/lib/analytics/aggregates";
import {
  buildTopCategories,
  resolveAnalyticsCategory,
} from "@/lib/analytics/category-display";
import {
  ACTIONABLE_STATUSES,
  MANUAL_REVIEW_STATUSES,
  QUALIFIED_STATUSES,
  getTenderUiStatus,
  qualificationStatusesForFilter,
} from "@/lib/tender-status";
import { isProjectCategory } from "@/lib/project-category";
import { AppError } from "@/lib/errors/app-error";
import { assertSupabaseOk, runQuery, type QueryResult } from "@/lib/errors/db-query";
import { startOfDay, subDays, formatISO, addDays } from "date-fns";

export type DashboardMetrics = {
  totalTenders: number;
  newToday: number;
  closingWithin3Days: number;
  goOpportunities: number;
  pendingVerification: number;
  manualReview: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  freshnessAt: string | null;
};

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const supabase = getServerSupabase();
  const todayStart = formatISO(startOfDay(new Date()));
  const in3 = formatISO(addDays(startOfDay(new Date()), 3), {
    representation: "date",
  });
  const todayDate = formatISO(startOfDay(new Date()), {
    representation: "date",
  });

  const [
    totalRes,
    newTodayRes,
    closingRes,
    statusRes,
    sourceRes,
    freshRes,
    goRes,
    verifyRes,
    manualRes,
  ] = await Promise.all([
    supabase
      .from("agenttender_tenders")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("agenttender_tenders")
      .select("id", { count: "exact", head: true })
      .gte("first_seen_at", todayStart),
    supabase
      .from("agenttender_tenders")
      .select("id", { count: "exact", head: true })
      .gte("closing_date", todayDate)
      .lte("closing_date", in3),
    supabase
      .from("agenttender_web_tender_list")
      .select("effective_qualification_status"),
    supabase.from("agenttender_tenders").select("source_portal"),
    supabase
      .from("agenttender_tenders")
      .select("crawled_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .eq("effective_qualification_status", QUALIFIED_STATUSES[0]),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .eq("effective_qualification_status", "VERIFY"),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .eq("manual_review_required", true),
  ]);

  const checks = [
    { name: "dashboard.totalTenders", res: totalRes },
    { name: "dashboard.newToday", res: newTodayRes },
    { name: "dashboard.closingSoon", res: closingRes },
    { name: "dashboard.statusBreakdown", res: statusRes },
    { name: "dashboard.sourceBreakdown", res: sourceRes },
    { name: "dashboard.freshness", res: freshRes },
    { name: "dashboard.goOpportunities", res: goRes },
    { name: "dashboard.pendingVerification", res: verifyRes },
    { name: "dashboard.manualReview", res: manualRes },
  ];

  for (const check of checks) {
    if (check.res.error) {
      assertSupabaseOk(check.res, {
        queryName: check.name,
        selectedColumns: check.name,
      });
    }
  }

  const byStatus = aggregateStatusCounts(statusRes.data || []);

  const bySource = aggregateSourceCounts(sourceRes.data || []);

  return {
    totalTenders: totalRes.count ?? 0,
    newToday: newTodayRes.count ?? 0,
    closingWithin3Days: closingRes.count ?? 0,
    goOpportunities: goRes.count ?? 0,
    pendingVerification: verifyRes.count ?? 0,
    manualReview: manualRes.count ?? 0,
    byStatus,
    bySource,
    freshnessAt:
      freshRes.data?.crawled_at || freshRes.data?.updated_at || null,
  };
}

/** Statuses counted in Active Pipeline / Pipeline Value (excludes NO_GO). */
const PIPELINE_KPI_STATUSES = [
  ...ACTIONABLE_STATUSES,
  ...MANUAL_REVIEW_STATUSES,
] as const;

export type TenderManagementKpis = {
  totalTenders: number;
  activePipeline: number;
  willBid: number;
  closingSoon: number;
  pipelineValue: number;
};

export async function getTenderManagementKpis(): Promise<TenderManagementKpis> {
  const metrics = await getDashboardMetrics();
  const supabase = getServerSupabase();
  const valueRes = await supabase
    .from("agenttender_web_tender_list")
    .select("tender_value")
    .in("effective_qualification_status", [...PIPELINE_KPI_STATUSES]);

  if (valueRes.error) {
    assertSupabaseOk(valueRes, {
      queryName: "tenderManagement.pipelineValue",
      selectedColumns: "tender_value",
    });
  }

  const pipelineValue = (valueRes.data || []).reduce((sum, row) => {
    const amount = Number(row.tender_value);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);

  return {
    totalTenders: metrics.totalTenders,
    activePipeline:
      metrics.goOpportunities +
      metrics.pendingVerification +
      (metrics.byStatus.CONDITIONAL_GO || 0) +
      (metrics.byStatus.PARTNER_BID || 0),
    willBid: metrics.goOpportunities,
    closingSoon: metrics.closingWithin3Days,
    pipelineValue,
  };
}

/** Status summary cards for Tender Management list page. */
export type TenderListStatusCounts = {
  totalTenders: number;
  verify: number;
  underEvaluation: number;
  willBid: number;
  mayBid: number;
  noBid: number;
  partnership: number;
  submitted: number;
  closingSoon: number;
  won: number;
};

export async function getTenderListStatusCounts(): Promise<TenderListStatusCounts> {
  const supabase = getServerSupabase();
  const todayDate = formatISO(startOfDay(new Date()), {
    representation: "date",
  });
  const in3 = formatISO(addDays(startOfDay(new Date()), 3), {
    representation: "date",
  });

  // Parallel exact counts — never fetch row bodies (PostgREST 1000-row cap).
  const [
    totalRes,
    verifyRes,
    underEvalRes,
    willBidRes,
    mayBidRes,
    noBidRes,
    partnershipRes,
    wonRes,
    closingRes,
    submittedRes,
  ] = await Promise.all([
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .eq("effective_qualification_status", "VERIFY"),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .is("effective_qualification_status", null),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .eq("effective_qualification_status", "GO"),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .eq("effective_qualification_status", "CONDITIONAL_GO"),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .eq("effective_qualification_status", "NO_GO"),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .eq("effective_qualification_status", "PARTNER_BID"),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .eq("effective_qualification_status", "WON"),
    supabase
      .from("agenttender_web_tender_list")
      .select("id", { count: "exact", head: true })
      .gte("closing_date", todayDate)
      .lte("closing_date", in3),
    supabase
      .from("agenttender_bid_workspaces")
      .select("tender_id", { count: "exact", head: true })
      .eq("submission_status", "submitted"),
  ]);

  const results = [
    ["total", totalRes],
    ["verify", verifyRes],
    ["underEvaluation", underEvalRes],
    ["willBid", willBidRes],
    ["mayBid", mayBidRes],
    ["noBid", noBidRes],
    ["partnership", partnershipRes],
    ["won", wonRes],
    ["closingSoon", closingRes],
    ["submitted", submittedRes],
  ] as const;

  for (const [name, res] of results) {
    if (res.error) {
      assertSupabaseOk(res, {
        queryName: `tenderListStatusCounts.${name}`,
        selectedColumns: "id (count exact head)",
      });
    }
  }

  const totalTenders = totalRes.count ?? 0;
  const verify = verifyRes.count ?? 0;
  const underEvaluation = underEvalRes.count ?? 0;
  const willBid = willBidRes.count ?? 0;
  const mayBid = mayBidRes.count ?? 0;
  const noBid = noBidRes.count ?? 0;
  const partnership = partnershipRes.count ?? 0;
  const won = wonRes.count ?? 0;

  const mappedSum =
    verify + underEvaluation + willBid + mayBid + noBid + partnership + won;
  if (mappedSum < totalTenders) {
    console.warn(
      "[tenderListStatusCounts] unmapped/legacy statuses present",
      {
        totalTenders,
        mappedSum,
        unmapped: totalTenders - mappedSum,
      },
    );
  }

  return {
    totalTenders,
    verify,
    underEvaluation,
    willBid,
    mayBid,
    noBid,
    partnership,
    submitted: submittedRes.count ?? 0,
    closingSoon: closingRes.count ?? 0,
    won,
  };
}

export type OperationalListKey =
  | "closingSoon"
  | "recentlyQualified"
  | "recentlyActionable"
  | "manualReview"
  | "highValue"
  | "recentlyCrawled";

export type OperationalLists = Record<OperationalListKey, Record<string, unknown>[]>;

export type OperationalListResult = QueryResult<Record<string, unknown>[]>;

async function runListQuery(
  queryName: string,
  queryFn: () => Promise<{
    data: Record<string, unknown>[] | null;
    error: import("@supabase/supabase-js").PostgrestError | null;
  }>,
  selectedColumns: string,
): Promise<OperationalListResult> {
  const result = await runQuery(queryName, queryFn, { selectedColumns });
  if (!result.ok) return result;
  return { ok: true, data: result.data ?? [] };
}

export async function getOperationalList(
  key: OperationalListKey,
): Promise<OperationalListResult> {
  const supabase = getServerSupabase();
  const today = formatISO(startOfDay(new Date()), { representation: "date" });
  const in7 = formatISO(addDays(startOfDay(new Date()), 7), {
    representation: "date",
  });

  switch (key) {
    case "closingSoon":
      return runListQuery(
        "operationalLists.closingSoon",
        async () =>
          await supabase
            .from("agenttender_web_tender_list")
            .select(
              "id, title, source_portal, source_tender_id, closing_date, tender_value, effective_qualification_status, organization",
            )
            .gte("closing_date", today)
            .lte("closing_date", in7)
            .order("closing_date", { ascending: true })
            .limit(8),
        "id, title, source_portal, closing_date, tender_value, effective_qualification_status, organization",
      );
    case "recentlyQualified":
      return runListQuery(
        "operationalLists.recentlyQualified",
        async () =>
          await supabase
            .from("agenttender_web_tender_list")
            .select(
              "id, title, source_portal, source_tender_id, qualified_at, effective_qualification_status, confidence, organization, authority",
            )
            .eq("effective_qualification_status", QUALIFIED_STATUSES[0])
            .not("qualified_at", "is", null)
            .order("qualified_at", { ascending: false })
            .limit(8),
        "id, title, source_portal, qualified_at, effective_qualification_status, confidence",
      );
    case "recentlyActionable":
      return runListQuery(
        "operationalLists.recentlyActionable",
        async () =>
          await supabase
            .from("agenttender_web_tender_list")
            .select(
              "id, title, source_portal, source_tender_id, qualified_at, effective_qualification_status, confidence, organization, authority",
            )
            .in("effective_qualification_status", [...ACTIONABLE_STATUSES])
            .not("qualified_at", "is", null)
            .order("qualified_at", { ascending: false })
            .limit(8),
        "id, title, source_portal, qualified_at, effective_qualification_status, confidence",
      );
    case "manualReview":
      return runListQuery(
        "operationalLists.manualReview",
        async () =>
          await supabase
            .from("agenttender_web_tender_list")
            .select(
              "id, title, source_portal, source_tender_id, effective_qualification_status, reason",
            )
            .eq("manual_review_required", true)
            .order("updated_at", { ascending: false })
            .limit(8),
        "id, title, source_portal, effective_qualification_status, reason",
      );
    case "highValue":
      return runListQuery(
        "operationalLists.highValue",
        async () =>
          await supabase
            .from("agenttender_web_tender_list")
            .select(
              "id, title, source_portal, source_tender_id, tender_value, effective_qualification_status, organization",
            )
            .not("tender_value", "is", null)
            .in("effective_qualification_status", [...ACTIONABLE_STATUSES])
            .order("tender_value", { ascending: false })
            .limit(8),
        "id, title, source_portal, tender_value, effective_qualification_status, organization",
      );
    case "recentlyCrawled":
      return runListQuery(
        "operationalLists.recentlyCrawled",
        async () =>
          await supabase
            .from("agenttender_web_tender_list")
            .select(
              "id, title, source_portal, source_tender_id, crawled_at, download_status",
            )
            .not("crawled_at", "is", null)
            .order("crawled_at", { ascending: false })
            .limit(8),
        "id, title, source_portal, crawled_at, download_status",
      );
    default:
      return {
        ok: false,
        error: new AppError({
          code: "UNKNOWN",
          publicMessage: "Unknown operational list",
          internalMessage: `Unknown list key: ${String(key)}`,
        }),
      };
  }
}

/** @deprecated Use getOperationalList for isolated error handling */
export async function getOperationalLists(): Promise<OperationalLists> {
  const keys: OperationalListKey[] = [
    "closingSoon",
    "recentlyQualified",
    "recentlyActionable",
    "manualReview",
    "highValue",
    "recentlyCrawled",
  ];
  const results = await Promise.all(keys.map((key) => getOperationalList(key)));
  const out = {} as OperationalLists;
  keys.forEach((key, index) => {
    const result = results[index]!;
    out[key] = result.ok ? result.data : [];
  });
  return out;
}

export async function getAnalytics(options: {
  from?: string;
  to?: string;
  source?: string;
  status?: string;
  category?: string;
}): Promise<{
  totals: {
    count: number;
    disclosedValueSum: number;
    disclosedValueCount: number;
    disclosedEmdSum: number;
    disclosedEmdCount: number;
    qualifiedCount: number;
    manualReviewCount: number;
  };
  byDay: { date: string; TENDER247: number; BIDASSIST: number }[];
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
  byCategory: { name: string; fullName?: string; count: number }[];
  byState: { name: string; count: number }[];
  byOrganization: { name: string; count: number }[];
  valueBands: { band: string; count: number }[];
}> {
  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_web_tender_list")
    .select(
      "id, source_portal, effective_qualification_status, category, project_category, state, organization, tender_value, emd_amount, crawled_at, first_seen_at, manual_review_required, closing_date, title",
    )
    .limit(5000);

  if (options.source && options.source !== "ALL") {
    query = query.eq("source_portal", options.source);
  }
  if (options.status && options.status !== "ALL") {
    const statusFilter = qualificationStatusesForFilter(options.status);
    if (statusFilter.kind === "null") {
      query = query.is("effective_qualification_status", null);
    } else if (statusFilter.kind === "in") {
      query = query.in("effective_qualification_status", statusFilter.values);
    }
  }
  if (options.category && isProjectCategory(options.category)) {
    query = query.eq("project_category", options.category);
  }
  if (options.from) {
    query = query.gte("crawled_at", options.from);
  }
  if (options.to) {
    query = query.lte("crawled_at", options.to);
  }

  const rows = assertSupabaseOk(await query, {
    queryName: "getAnalytics",
    selectedColumns:
      "id, source_portal, effective_qualification_status, category, project_category, state, organization, tender_value, emd_amount, crawled_at, first_seen_at, manual_review_required, closing_date, title",
    filters: options,
  });

  let disclosedValueSum = 0;
  let disclosedValueCount = 0;
  let disclosedEmdSum = 0;
  let disclosedEmdCount = 0;
  let qualifiedCount = 0;
  let manualReviewCount = 0;

  const statusMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  const categoryMap = new Map<string, number>();
  const stateMap = new Map<string, number>();
  const orgMap = new Map<string, number>();
  const dayMap = new Map<string, { TENDER247: number; BIDASSIST: number }>();
  const bands = {
    "< ₹10L": 0,
    "₹10L–1Cr": 0,
    "₹1–10Cr": 0,
    "> ₹10Cr": 0,
    Undisclosed: 0,
  };

  for (const row of rows || []) {
    if (row.tender_value != null) {
      disclosedValueSum += Number(row.tender_value);
      disclosedValueCount += 1;
      const v = Number(row.tender_value);
      if (v < 1_000_000) bands["< ₹10L"] += 1;
      else if (v < 10_000_000) bands["₹10L–1Cr"] += 1;
      else if (v < 100_000_000) bands["₹1–10Cr"] += 1;
      else bands["> ₹10Cr"] += 1;
    } else {
      bands.Undisclosed += 1;
    }
    if (row.emd_amount != null) {
      disclosedEmdSum += Number(row.emd_amount);
      disclosedEmdCount += 1;
    }
    if (row.effective_qualification_status === "GO") qualifiedCount += 1;
    if (row.manual_review_required) manualReviewCount += 1;

    const st = getTenderUiStatus(row.effective_qualification_status);
    statusMap.set(st, (statusMap.get(st) || 0) + 1);
    sourceMap.set(
      row.source_portal,
      (sourceMap.get(row.source_portal) || 0) + 1,
    );

    const categoryLabel = resolveAnalyticsCategory({
      source_portal: row.source_portal,
      project_category: row.project_category,
      category: row.category,
      title: row.title,
    });
    categoryMap.set(
      categoryLabel,
      (categoryMap.get(categoryLabel) || 0) + 1,
    );

    if (row.state) {
      stateMap.set(row.state, (stateMap.get(row.state) || 0) + 1);
    }
    if (row.organization) {
      orgMap.set(row.organization, (orgMap.get(row.organization) || 0) + 1);
    }

    const dayKey = (row.crawled_at || row.first_seen_at || "").slice(0, 10);
    if (dayKey) {
      const entry = dayMap.get(dayKey) || { TENDER247: 0, BIDASSIST: 0 };
      if (row.source_portal === "TENDER247") entry.TENDER247 += 1;
      else entry.BIDASSIST += 1;
      dayMap.set(dayKey, entry);
    }
  }

  const top = (map: Map<string, number>, n = 8) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));

  return {
    totals: {
      count: (rows || []).length,
      disclosedValueSum,
      disclosedValueCount,
      disclosedEmdSum,
      disclosedEmdCount,
      qualifiedCount,
      manualReviewCount,
    },
    byDay: [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-30)
      .map(([date, v]) => ({ date, ...v })),
    byStatus: [...statusMap.entries()]
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({
        status,
        count,
      })),
    bySource: [...sourceMap.entries()].map(([source, count]) => ({
      source,
      count,
    })),
    byCategory: buildTopCategories(categoryMap, 6),
    byState: top(stateMap),
    byOrganization: top(orgMap),
    valueBands: Object.entries(bands).map(([band, count]) => ({
      band,
      count,
    })),
  };
}

export function lastNDaysIso(days: number): string {
  return formatISO(startOfDay(subDays(new Date(), days)));
}


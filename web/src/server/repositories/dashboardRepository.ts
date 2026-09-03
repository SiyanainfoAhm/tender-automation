import "server-only";

import {
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  subMonths,
} from "date-fns";

import {
  buildFinancialExposureFromBidFees,
  getEmdCommitted,
} from "@/lib/dashboard/financial-metrics";
import {
  DASHBOARD_PIPELINE_META,
  DASHBOARD_PIPELINE_STAGES,
  isLiveDashboardPipelineStage,
  isWonQualificationStatus,
  mapToDashboardPipelineStage,
  type DashboardPipelineStage,
} from "@/lib/dashboard/pipeline";
import type {
  DashboardDateBasis,
  DashboardPeriod,
} from "@/lib/dashboard/time-range";
import type {
  DashboardCategoryRow,
  DashboardDeadlineItem,
  DashboardExpiringDocument,
  DashboardOverview,
  DashboardPipelineStageRow,
  DashboardSourcePill,
  DashboardVolumePoint,
  DashboardWonPortfolio,
} from "@/lib/dashboard/types";
import {
  filterRowsForDashboardPeriod,
  tenderBasisDate,
} from "@/lib/dashboard/period-filter";
import { fetchAllSupabaseRows } from "@/lib/db/fetchAllRows";
import { getServerSupabase } from "@/lib/db/server";
import { formatIndianCurrency } from "@/lib/format";
import {
  getTenderUiStatus,
  TENDER_UI_STATUS_LABELS,
} from "@/lib/tender-status";
import { listExpiringDocuments } from "@/server/repositories/documentRepository";
import { listCompanyExperience } from "@/server/repositories/experienceRepository";
import { listBidFees } from "@/server/repositories/bidFeeRepository";

type TenderRow = {
  id: string;
  title: string | null;
  source_tender_id: string | null;
  source_portal: string | null;
  closing_date: string | null;
  tender_value: number | string | null;
  emd_amount: number | string | null;
  project_category: string | null;
  category: string | null;
  effective_qualification_status: string | null;
  manual_review_required: boolean | null;
  first_seen_at: string | null;
  crawled_at: string | null;
  created_at: string | null;
  scraped_date: string | null;
  qualified_at: string | null;
  updated_at: string | null;
};

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function moneyLabel(value: number): string {
  if (value <= 0) return "₹0";
  return formatIndianCurrency(value);
}

function sourceLabel(portal: string | null): string {
  const key = String(portal || "").toUpperCase();
  if (key === "TENDER247") return "Tender247";
  if (key === "BIDASSIST") return "BidAssist";
  if (key === "GEM") return "GeM";
  if (key === "CPPP") return "CPPP";
  return portal || "Other";
}

function categoryLabel(row: TenderRow): string {
  const raw = String(row.project_category || row.category || "Other").trim();
  return raw || "Other";
}

async function loadExpiringDocuments(
  companyId: string | null,
): Promise<DashboardExpiringDocument[]> {
  if (!companyId) return [];
  try {
    const docs = await listExpiringDocuments({ companyId });
    const today = startOfDay(new Date());
    return docs
      .map((d) => {
        const expiry = d.expiryDate
          ? startOfDay(parseISO(d.expiryDate))
          : null;
        const daysLeft = expiry
          ? differenceInCalendarDays(expiry, today)
          : 0;
        const severity: DashboardExpiringDocument["severity"] =
          daysLeft < 0
            ? "expired"
            : daysLeft <= 7
              ? "critical"
              : "warning";
        return {
          id: d.id,
          name: d.certificateType || d.name,
          daysLeft,
          severity,
        };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function loadSubmittedWorkspaces(
  companyId: string | null,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!companyId) return out;
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_workspaces")
    .select("tender_id")
    .eq("company_id", companyId)
    .eq("submission_status", "submitted");
  if (error) {
    console.error("[dashboard] submitted workspaces failed", error.message);
    return out;
  }
  for (const row of data || []) {
    out.add(String(row.tender_id));
  }
  return out;
}

function buildPipeline(
  rows: TenderRow[],
  submittedIds: Set<string>,
): {
  stages: DashboardPipelineStageRow[];
  total: number;
  liveTotal: number;
  valueTotal: number;
  liveValueTotal: number;
} {
  const aggregates = new Map<
    DashboardPipelineStage,
    { count: number; value: number }
  >();
  for (const key of DASHBOARD_PIPELINE_STAGES) {
    aggregates.set(key, { count: 0, value: 0 });
  }

  for (const row of rows) {
    const stage = mapToDashboardPipelineStage({
      qualificationStatus: row.effective_qualification_status,
      submitted: submittedIds.has(row.id),
      won: isWonQualificationStatus(row.effective_qualification_status),
    });
    const bucket = aggregates.get(stage);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.value += toNumber(row.tender_value);
  }

  const valueTotal = [...aggregates.values()].reduce(
    (sum, b) => sum + b.value,
    0,
  );
  const valueDenom = Math.max(valueTotal, 1);

  const stages: DashboardPipelineStageRow[] = DASHBOARD_PIPELINE_STAGES.map(
    (key, index) => {
      const meta = DASHBOARD_PIPELINE_META[key];
      const bucket = aggregates.get(key)!;
      return {
        key,
        label: meta.label,
        number: index + 1,
        count: bucket.count,
        totalValue: bucket.value,
        valueLabel: moneyLabel(bucket.value),
        progress: Math.round((bucket.value / valueDenom) * 100),
        color: meta.color,
        barClass: meta.barClass,
        iconBg: meta.iconBg,
        iconText: meta.iconText,
      };
    },
  );

  const liveStages = stages.filter((stage) =>
    isLiveDashboardPipelineStage(stage.key),
  );
  const total = stages.reduce((sum, s) => sum + s.count, 0);
  const liveTotal = liveStages.reduce((sum, s) => sum + s.count, 0);
  const liveValueTotal = liveStages.reduce((sum, s) => sum + s.totalValue, 0);
  return { stages, total, liveTotal, valueTotal, liveValueTotal };
}

function buildVolumeTrend(
  rows: TenderRow[],
  basis: DashboardDateBasis,
  now: Date,
): DashboardVolumePoint[] {
  const points: DashboardVolumePoint[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const monthStart = startOfMonth(subMonths(now, i));
    const key = format(monthStart, "yyyy-MM");
    points.push({
      key,
      label: format(monthStart, "MMM"),
      count: 0,
      value: 0,
    });
  }
  const index = new Map(points.map((p) => [p.key, p]));
  for (const row of rows) {
    const d = tenderBasisDate(row, basis);
    if (!d) continue;
    const key = format(startOfMonth(d), "yyyy-MM");
    const bucket = index.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.value += toNumber(row.tender_value);
  }
  return points;
}

function buildCategories(rows: TenderRow[]): {
  categories: DashboardCategoryRow[];
  total: number;
  sources: DashboardSourcePill[];
} {
  const catMap = new Map<string, { count: number; value: number }>();
  const sourceMap = new Map<string, number>();
  for (const row of rows) {
    const cat = categoryLabel(row);
    const existing = catMap.get(cat) || { count: 0, value: 0 };
    existing.count += 1;
    existing.value += toNumber(row.tender_value);
    catMap.set(cat, existing);

    const src = sourceLabel(row.source_portal);
    sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
  }
  const maxValue = Math.max(
    1,
    ...[...catMap.values()].map((c) => c.value),
  );
  const categories = [...catMap.entries()]
    .map(([label, stats]) => ({
      key: label.toLowerCase().replace(/\s+/g, "_"),
      label,
      count: stats.count,
      totalValue: stats.value,
      valueLabel: moneyLabel(stats.value),
      progress: Math.round((stats.value / maxValue) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const sources = [...sourceMap.entries()]
    .map(([label, count]) => ({
      key: label.toLowerCase(),
      label,
      count,
    }))
    .sort((a, b) => b.count - a.count);
  const total = rows.length;
  return { categories, total, sources };
}

function buildWonPortfolio(
  rows: TenderRow[],
  experiences: Awaited<ReturnType<typeof listCompanyExperience>>,
): DashboardWonPortfolio {
  const wonRows = rows.filter((row) =>
    isWonQualificationStatus(row.effective_qualification_status),
  );
  const wonValue = wonRows.reduce(
    (sum, row) => sum + toNumber(row.tender_value),
    0,
  );

  const ongoing = experiences.filter((e) => e.projectStatus === "ongoing");
  const completed = experiences.filter((e) => e.projectStatus === "completed");
  const experienceValue = experiences.reduce(
    (sum, e) => sum + (Number(e.projectValueInr) || 0),
    0,
  );
  const inExecutionValue = ongoing.reduce(
    (sum, e) => sum + (Number(e.projectValueInr) || 0),
    0,
  );

  const statusBuckets = [
    {
      key: "won",
      label: "Won",
      count: wonRows.length,
      totalValue: wonValue,
      color: "#16a34a",
    },
    {
      key: "awarded",
      label: "Past experience",
      count: experiences.length,
      totalValue: experienceValue,
      color: "#059669",
    },
    {
      key: "in_execution",
      label: "In Execution",
      count: ongoing.length,
      totalValue: inExecutionValue,
      color: "#0ea5e9",
    },
    {
      key: "completed",
      label: "Completed",
      count: completed.length,
      totalValue: completed.reduce(
        (sum, e) => sum + (Number(e.projectValueInr) || 0),
        0,
      ),
      color: "#64748b",
    },
    {
      key: "terminated",
      label: "Terminated",
      count: 0,
      totalValue: 0,
      color: "#dc2626",
    },
  ];
  const maxValue = Math.max(1, ...statusBuckets.map((b) => b.totalValue));

  return {
    activeProjects: ongoing.length,
    inExecutionValue,
    inExecutionValueLabel: moneyLabel(inExecutionValue || wonValue),
    completed: completed.length,
    milestonesDone: completed.length,
    milestonesTotal: Math.max(experiences.length, wonRows.length),
    byStatus: statusBuckets.map((b) => ({
      ...b,
      valueLabel: moneyLabel(b.totalValue),
      progress: Math.round((b.totalValue / maxValue) * 100),
    })),
  };
}

function buildUpcomingDeadlines(
  rows: TenderRow[],
  submittedIds: Set<string>,
): DashboardDeadlineItem[] {
  const today = startOfDay(new Date());
  return rows
    .filter((row) => {
      if (!row.closing_date) return false;
      if (isWonQualificationStatus(row.effective_qualification_status)) {
        return false;
      }
      if (
        row.effective_qualification_status === "NO_GO" ||
        row.effective_qualification_status === "CANCELLED" ||
        row.effective_qualification_status === "LOST" ||
        row.effective_qualification_status === "DISQUALIFIED"
      ) {
        return false;
      }
      return true;
    })
    .map((row) => {
      const closing = startOfDay(parseISO(String(row.closing_date)));
      const daysLeft = differenceInCalendarDays(closing, today);
      let urgency: DashboardDeadlineItem["urgency"] = "ok";
      if (daysLeft < 0) urgency = "overdue";
      else if (daysLeft <= 3) urgency = "urgent";
      else if (daysLeft <= 7) urgency = "soon";
      return { row, closing, daysLeft, urgency };
    })
    .filter((item) => item.daysLeft <= 45)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 8)
    .map(({ row, closing, daysLeft, urgency }) => ({
      id: row.id,
      title: row.title || "Untitled tender",
      reference: row.source_tender_id
        ? String(row.source_tender_id)
        : row.id.slice(0, 8),
      closingDate: String(row.closing_date),
      monthLabel: format(closing, "MMM").toUpperCase(),
      dayLabel: format(closing, "d"),
      status: row.effective_qualification_status,
      statusLabel:
        TENDER_UI_STATUS_LABELS[
          getTenderUiStatus(row.effective_qualification_status)
        ],
      daysLeft,
      urgency,
      valueLabel: moneyLabel(toNumber(row.tender_value)),
      href: `/tenders/${row.id}`,
    }));
}

/**
 * Executive dashboard aggregate.
 *
 * Date fields:
 * - scraped → scraped_date (fallback first_seen_at / crawled_at / created_at)
 * - created → created_at (fallback first_seen_at / crawled_at / scraped_date)
 *
 * Won Projects KPI: tenders with qualification_status WON/AWARDED only.
 * Execution portfolio separately shows company past experience
 * (agenttender_company_experience) — that must not inflate the Won KPI.
 * Financial exposure: persisted Add Bid Fee records only (agenttender_bid_fees).
 */
export async function getDashboardOverview(options: {
  period: DashboardPeriod;
  dateBasis: DashboardDateBasis;
  companyId: string | null;
  /** @deprecated */
  range?: DashboardPeriod;
}): Promise<DashboardOverview> {
  const period = options.period || options.range || "month";
  const dateBasis = options.dateBasis || "scraped";
  const supabase = getServerSupabase();
  const now = new Date();

  const tenderListSelect =
    "id, title, source_tender_id, source_portal, closing_date, tender_value, emd_amount, project_category, category, effective_qualification_status, manual_review_required, first_seen_at, crawled_at, created_at, scraped_date, qualified_at, updated_at";

  const [
    allRows,
    submittedIds,
    expiringDocuments,
    experiences,
    bidFees,
  ] = await Promise.all([
    fetchAllSupabaseRows<TenderRow>(supabase, {
      table: "agenttender_web_tender_list",
      select: tenderListSelect,
      order: { column: "scraped_date", ascending: false, nullsFirst: false },
    }),
    loadSubmittedWorkspaces(options.companyId),
    loadExpiringDocuments(options.companyId),
    options.companyId
      ? listCompanyExperience(options.companyId).catch(() => [])
      : Promise.resolve([]),
    options.companyId
      ? listBidFees({ companyId: options.companyId }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const periodRows = filterRowsForDashboardPeriod(allRows, {
    period,
    dateBasis,
    now,
  });
  /** Period filter applies to intake, pipeline, and category views. */
  const scopedRows = periodRows;

  const imported = periodRows.length;
  const declined = periodRows.filter(
    (row) =>
      row.effective_qualification_status === "NO_GO" ||
      row.effective_qualification_status === "NO_BID",
  ).length;
  const wonInPeriod = periodRows.filter((row) =>
    isWonQualificationStatus(row.effective_qualification_status),
  );
  const contractsAwarded = wonInPeriod.length;
  const contractsAwardedValue = wonInPeriod.reduce(
    (sum, row) => sum + toNumber(row.tender_value),
    0,
  );

  const {
    stages: pipeline,
    total: pipelineTotal,
    liveTotal,
    valueTotal: pipelineValueTotal,
    liveValueTotal,
  } = buildPipeline(scopedRows, submittedIds);

  const submittedCount = scopedRows.filter((row) => {
    const status = String(row.effective_qualification_status || "")
      .trim()
      .toUpperCase();
    return status === "SUBMITTED" || submittedIds.has(row.id);
  }).length;
  const wonAll = scopedRows.filter((row) =>
    isWonQualificationStatus(row.effective_qualification_status),
  );
  const decided = submittedCount + wonAll.length;
  const winRate =
    decided > 0 ? (wonAll.length / Math.max(decided, 1)) * 100 : null;

  const emdCommitted = getEmdCommitted(bidFees);

  const financialExposure = buildFinancialExposureFromBidFees(bidFees);
  const wonPortfolio = buildWonPortfolio(scopedRows, experiences);
  const { categories, total: categoryTotal, sources } =
    buildCategories(scopedRows);
  const volumeTrend = buildVolumeTrend(allRows, dateBasis, now);
  const upcomingDeadlines = buildUpcomingDeadlines(allRows, submittedIds);

  const periodPhrase =
    period === "today"
      ? "today"
      : period === "week"
        ? "this week"
        : period === "quarter"
          ? "this quarter"
          : "this month";

  return {
    period,
    dateBasis,
    range: period,
    summaryStats: [
      {
        key: "imported",
        label: `Tenders imported ${periodPhrase}`,
        value: imported.toLocaleString("en-IN"),
        supporting: `Based on ${dateBasis === "scraped" ? "scraped" : "created"} date`,
      },
      {
        key: "declined",
        label: `Bids declined ${periodPhrase}`,
        value: declined.toLocaleString("en-IN"),
        supporting: "No Bid outcomes in period",
      },
      {
        key: "awarded",
        label: `Contracts awarded ${periodPhrase}`,
        value: contractsAwarded.toLocaleString("en-IN"),
        supporting:
          contractsAwarded > 0
            ? moneyLabel(contractsAwardedValue)
            : "No award outcomes recorded yet",
      },
    ],
    kpiCards: [
      {
        key: "pipelineTenders",
        label: "Pipeline Tenders",
        value: liveTotal.toLocaleString("en-IN"),
        supporting: `worth ${moneyLabel(liveValueTotal)}`,
        tone: "blue",
      },
      {
        key: "pipelineValue",
        label: "Pipeline Value",
        value: moneyLabel(liveValueTotal),
        supporting: `${liveTotal} live opportunities`,
        tone: "green",
      },
      {
        key: "winRate",
        label: "Win Rate",
        value: winRate == null ? "—" : `${winRate.toFixed(1)}%`,
        supporting:
          decided > 0
            ? `${wonAll.length} won / ${decided} decided`
            : "No decided bids yet",
        tone: "violet",
      },
      {
        key: "wonProjects",
        label: "Won Projects",
        value: wonAll.length.toLocaleString("en-IN"),
        supporting:
          wonAll.length > 0
            ? wonPortfolio.inExecutionValueLabel
            : experiences.length > 0
              ? `${experiences.length} past experience on file (not tender wins)`
              : "No won tenders yet",
        tone: "green",
      },
      {
        key: "emdCommitted",
        label: "EMD Committed",
        value: moneyLabel(emdCommitted),
        supporting:
          emdCommitted > 0
            ? "From recorded bid fees"
            : "No EMD committed",
        tone: "orange",
      },
      {
        key: "activePbg",
        label: "Active PBG",
        value: financialExposure.activePbgLabel,
        supporting:
          financialExposure.pbgExpiringCount > 0
            ? `${financialExposure.pbgExpiringCount} expiring ≤ 90d`
            : financialExposure.activePbg > 0
              ? "Active performance guarantees"
              : "No active guarantees",
        tone: "orange",
      },
    ],
    expiringDocuments,
    pipeline,
    pipelineTotal,
    pipelineValueTotal,
    pipelineValueLabel: moneyLabel(pipelineValueTotal),
    volumeTrend,
    volumeSubtitle: `12-month intake trend (${periodPhrase} filter applies to totals below)`,
    categories,
    categoryTotal,
    sources,
    financialExposure,
    wonPortfolio,
    upcomingDeadlines,
  };
}

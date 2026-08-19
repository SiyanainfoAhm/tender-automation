import "server-only";

import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  format,
  formatISO,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";

import {
  DASHBOARD_PIPELINE_META,
  DASHBOARD_PIPELINE_STAGES,
  isActionableQualificationStatus,
  isActiveBidStatus,
  isPendingReviewStatus,
  mapToDashboardPipelineStage,
  type DashboardPipelineStage,
} from "@/lib/dashboard/pipeline";
import {
  formatActiveBidsComparison,
  formatPendingReviewComparison,
  formatPeriodCountComparison,
  formatWinRateComparison,
  formatWinRateValue,
  type DashboardKpiMetric,
} from "@/lib/dashboard/kpi-format";
import {
  dashboardRangeDays,
  dashboardTrendGranularity,
  type DashboardTimeRange,
} from "@/lib/dashboard/time-range";
import type {
  DashboardActivityItem,
  DashboardDeadlineItem,
  DashboardExpiringDocument,
  DashboardOverview,
  DashboardPipelineStageRow,
  DashboardStatusSlice,
  DashboardVolumePoint,
} from "@/lib/dashboard/types";
import { getServerSupabase } from "@/lib/db/server";
import { formatIndianCurrency, formatRelativeTime } from "@/lib/format";
import { getTenderUiStatus, TENDER_UI_STATUS_COLORS, TENDER_UI_STATUS_LABELS, type TenderUiStatus } from "@/lib/tender-status";
import { listExpiringDocuments } from "@/server/repositories/documentRepository";

type TenderRow = {
  id: string;
  title: string | null;
  source_tender_id: string | null;
  source_portal: string | null;
  closing_date: string | null;
  tender_value: number | string | null;
  effective_qualification_status: string | null;
  manual_review_required: boolean | null;
  first_seen_at: string | null;
  crawled_at: string | null;
  qualified_at: string | null;
  updated_at: string | null;
};

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function eventTime(row: TenderRow): Date | null {
  const raw = row.first_seen_at || row.crawled_at || row.updated_at;
  if (!raw) return null;
  const d = parseISO(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inRange(date: Date | null, from: Date, to: Date): boolean {
  if (!date) return false;
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = parseISO(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatPipelineValueLabel(value: number): string {
  if (value <= 0) return "—";
  return formatIndianCurrency(value).replace(/^₹/, "");
}

function bucketKey(
  date: Date,
  granularity: "day" | "week" | "month",
): { key: string; label: string } {
  if (granularity === "day") {
    return {
      key: format(date, "yyyy-MM-dd"),
      label: format(date, "dd MMM"),
    };
  }
  if (granularity === "week") {
    const start = startOfWeek(date, { weekStartsOn: 1 });
    return {
      key: format(start, "yyyy-MM-dd"),
      label: format(start, "dd MMM"),
    };
  }
  const start = startOfMonth(date);
  return {
    key: format(start, "yyyy-MM"),
    label: format(start, "MMM yyyy"),
  };
}

function buildVolumeTrend(
  rows: TenderRow[],
  from: Date,
  to: Date,
  range: DashboardTimeRange,
): DashboardVolumePoint[] {
  const granularity = dashboardTrendGranularity(range);
  const buckets = new Map<string, { label: string; count: number }>();

  // Seed empty buckets so the chart has a continuous axis.
  if (granularity === "day") {
    let cursor = startOfDay(from);
    const end = startOfDay(to);
    while (cursor.getTime() <= end.getTime()) {
      const { key, label } = bucketKey(cursor, "day");
      buckets.set(key, { label, count: 0 });
      cursor = addDays(cursor, 1);
    }
  } else if (granularity === "week") {
    let cursor = startOfWeek(from, { weekStartsOn: 1 });
    const end = endOfWeek(to, { weekStartsOn: 1 });
    while (cursor.getTime() <= end.getTime()) {
      const { key, label } = bucketKey(cursor, "week");
      buckets.set(key, { label, count: 0 });
      cursor = addDays(cursor, 7);
    }
  } else {
    let cursor = startOfMonth(from);
    while (cursor.getTime() <= to.getTime()) {
      const { key, label } = bucketKey(cursor, "month");
      buckets.set(key, { label, count: 0 });
      cursor = startOfMonth(addDays(cursor, 32));
    }
  }

  for (const row of rows) {
    const t = eventTime(row);
    if (!inRange(t, from, to) || !t) continue;
    const { key, label } = bucketKey(t, granularity);
    const existing = buckets.get(key) || { label, count: 0 };
    existing.count += 1;
    buckets.set(key, existing);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => ({ label: v.label, count: v.count }));
}

function volumeSubtitle(range: DashboardTimeRange): string {
  const g = dashboardTrendGranularity(range);
  if (g === "day") return "Daily imports in selected range";
  if (g === "week") return "Weekly imports & decisions";
  return "Monthly imports & decisions";
}

function statusLabel(status: string | null): string {
  return TENDER_UI_STATUS_LABELS[getTenderUiStatus(status)];
}

function buildStatusDistribution(
  rows: TenderRow[],
): DashboardStatusSlice[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = getTenderUiStatus(row.effective_qualification_status);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      key,
      label: TENDER_UI_STATUS_LABELS[key as TenderUiStatus],
      count,
      color: TENDER_UI_STATUS_COLORS[key as TenderUiStatus] ?? "#94a3b8",
    }));
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
): Promise<Map<string, { submittedAt: Date | null }>> {
  const out = new Map<string, { submittedAt: Date | null }>();
  if (!companyId) return out;
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_workspaces")
    .select("tender_id, submitted_at")
    .eq("company_id", companyId)
    .eq("submission_status", "submitted");
  if (error) {
    console.error("[dashboard] submitted workspaces failed", error.message);
    return out;
  }
  for (const row of data || []) {
    out.set(String(row.tender_id), {
      submittedAt: parseDate(row.submitted_at as string | null),
    });
  }
  return out;
}

async function loadRecentActivity(
  from: Date,
): Promise<DashboardActivityItem[]> {
  const supabase = getServerSupabase();
  const fromIso = formatISO(from);

  const { data: activityRows, error: activityError } = await supabase
    .from("agenttender_tender_activity")
    .select(
      "id, event_type, summary, created_at, actor_user_id, tender_id",
    )
    .gte("created_at", fromIso)
    .order("created_at", { ascending: false })
    .limit(12);

  if (activityError) {
    console.error("[dashboard] activity failed", activityError.message);
  }

  const rows = activityRows || [];
  const tenderIds = [...new Set(rows.map((r) => String(r.tender_id)))];
  const actorIds = [
    ...new Set(
      rows
        .map((r) => r.actor_user_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const tenderMap = new Map<
    string,
    { title: string; ref: string }
  >();
  const actorMap = new Map<string, string>();

  if (tenderIds.length > 0) {
    const { data: tenders } = await supabase
      .from("agenttender_tenders")
      .select("id, title, source_tender_id")
      .in("id", tenderIds);
    for (const t of tenders || []) {
      tenderMap.set(String(t.id), {
        title: String(t.title || "Tender"),
        ref: String(t.source_tender_id || ""),
      });
    }
  }

  if (actorIds.length > 0) {
    const { data: users } = await supabase
      .from("agenttender_users")
      .select("id, full_name, email")
      .in("id", actorIds);
    for (const u of users || []) {
      actorMap.set(
        String(u.id),
        String(u.full_name || u.email || "Team member"),
      );
    }
  }

  const items: DashboardActivityItem[] = rows.map((row) => {
    const tender = tenderMap.get(String(row.tender_id));
    const actor = row.actor_user_id
      ? actorMap.get(String(row.actor_user_id)) || "Team member"
      : "AI Assistant";
    const ref = tender?.ref ? ` Tender #${tender.ref}` : "";
    const eventType = String(row.event_type);
    let kind: DashboardActivityItem["kind"] = "other";
    let sentence = `${actor} ${String(row.summary || "updated a tender")}${ref}`;

    if (eventType.includes("import") || eventType === "tender_imported") {
      kind = "imported";
      sentence = `${actor} imported${ref || " a tender"}`;
    } else if (
      eventType.includes("qualif") ||
      eventType === "ai_evaluation_completed"
    ) {
      kind = "qualification";
      sentence = `${actor} completed qualification analysis${ref}`;
    } else if (eventType.includes("document") || eventType.includes("upload")) {
      kind = "document";
      sentence = `${actor} uploaded a document${ref}`;
    } else if (
      eventType.includes("status") ||
      eventType.includes("classif") ||
      eventType.includes("decision")
    ) {
      kind = "status";
      sentence = `${actor} ${String(row.summary || "updated status")}${ref}`;
    }

    const occurredAt = String(row.created_at);
    return {
      id: String(row.id),
      kind,
      sentence,
      occurredAt,
      relativeTime: formatRelativeTime(occurredAt),
    };
  });

  // Fallback: derive from recent tender imports / qualifications when activity table is sparse.
  if (items.length < 4) {
    const { data: recent } = await supabase
      .from("agenttender_web_tender_list")
      .select(
        "id, title, source_tender_id, first_seen_at, crawled_at, qualified_at, effective_qualification_status",
      )
      .gte("first_seen_at", fromIso)
      .order("first_seen_at", { ascending: false })
      .limit(8);

    for (const row of recent || []) {
      const ref = row.source_tender_id
        ? ` Tender #${row.source_tender_id}`
        : "";
      const importedAt = String(row.first_seen_at || row.crawled_at || "");
      if (importedAt) {
        items.push({
          id: `imported:${row.id}`,
          kind: "imported",
          sentence: `System imported${ref}`,
          occurredAt: importedAt,
          relativeTime: formatRelativeTime(importedAt),
        });
      }
      if (row.qualified_at) {
        const status = row.effective_qualification_status
          ? statusLabel(String(row.effective_qualification_status))
          : "qualification";
        items.push({
          id: `qualified:${row.id}`,
          kind: "qualification",
          sentence: `AI Assistant completed ${status} analysis${ref}`,
          occurredAt: String(row.qualified_at),
          relativeTime: formatRelativeTime(String(row.qualified_at)),
        });
      }
    }
  }

  const seen = new Set<string>();
  return items
    .sort(
      (a, b) =>
        parseISO(b.occurredAt).getTime() - parseISO(a.occurredAt).getTime(),
    )
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 8);
}

function buildUpcomingDeadlines(
  rows: TenderRow[],
): DashboardDeadlineItem[] {
  const today = startOfDay(new Date());
  return rows
    .filter((row) => row.closing_date)
    .map((row) => {
      const closing = startOfDay(parseISO(String(row.closing_date)));
      const daysLeft = differenceInCalendarDays(closing, today);
      return { row, closing, daysLeft };
    })
    .filter((item) => item.daysLeft >= 0 && item.daysLeft <= 45)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 6)
    .map(({ row, closing, daysLeft }) => ({
      id: row.id,
      title: row.title || "Untitled tender",
      reference: row.source_tender_id
        ? String(row.source_tender_id)
        : row.id.slice(0, 8),
      closingDate: String(row.closing_date),
      monthLabel: format(closing, "MMM").toUpperCase(),
      dayLabel: format(closing, "d"),
      status: row.effective_qualification_status,
      statusLabel: statusLabel(row.effective_qualification_status),
      daysLeft,
      href: `/tenders/${row.id}`,
    }));
}

function buildPipeline(
  rows: TenderRow[],
  submittedIds: Set<string>,
): { stages: DashboardPipelineStageRow[]; total: number } {
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
      won: false,
    });
    if (!stage) continue;
    const bucket = aggregates.get(stage)!;
    bucket.count += 1;
    bucket.value += toNumber(row.tender_value);
  }

  const maxCount = Math.max(
    1,
    ...[...aggregates.values()].map((b) => b.count),
  );

  const stages: DashboardPipelineStageRow[] = DASHBOARD_PIPELINE_STAGES.map(
    (key) => {
      const meta = DASHBOARD_PIPELINE_META[key];
      const bucket = aggregates.get(key)!;
      return {
        key,
        label: meta.label,
        number: meta.number,
        count: bucket.count,
        totalValue: bucket.value,
        valueLabel: formatPipelineValueLabel(bucket.value),
        progress: Math.round((bucket.count / maxCount) * 100),
        color: meta.color,
        barClass: meta.barClass,
        iconBg: meta.iconBg,
        iconText: meta.iconText,
      };
    },
  ).filter((stage) => stage.key !== "partnership" || stage.count > 0)
    .map((stage, index) => ({ ...stage, number: index + 1 }));

  const total = stages.reduce((sum, s) => sum + s.count, 0);
  return { stages, total };
}

/**
 * Count tenders that entered the active bid path during [from, to].
 * Uses qualified_at for actionable qualifications and submitted_at for submissions.
 * This is an event count for comparison — not a reconstructed historical snapshot.
 */
function countEnteredActiveInPeriod(
  rows: TenderRow[],
  submittedMap: Map<string, { submittedAt: Date | null }>,
  from: Date,
  to: Date,
): number {
  const ids = new Set<string>();
  for (const row of rows) {
    const qualifiedAt = parseDate(row.qualified_at);
    if (
      inRange(qualifiedAt, from, to) &&
      isActionableQualificationStatus(row.effective_qualification_status)
    ) {
      ids.add(row.id);
    }
    const submitted = submittedMap.get(row.id);
    if (submitted && inRange(submitted.submittedAt, from, to)) {
      ids.add(row.id);
    }
  }
  return ids.size;
}

function buildKpiCards(options: {
  range: DashboardTimeRange;
  totalCurrent: number;
  totalPrevious: number;
  activeSnapshot: number;
  enteredActiveCurrent: number;
  enteredActivePrevious: number;
  pendingSnapshot: number;
  pendingOverdue: number;
  winRateCurrent: number | null;
  winRatePrevious: number | null;
  decidedCurrent: number;
  decidedPrevious: number;
}): DashboardKpiMetric[] {
  const totalDelta = options.totalCurrent - options.totalPrevious;
  const enteredDelta =
    options.enteredActiveCurrent - options.enteredActivePrevious;

  return [
    {
      key: "totalTenders",
      label: "Total Tenders",
      value: options.totalCurrent.toLocaleString("en-IN"),
      comparison: formatPeriodCountComparison({
        delta: totalDelta,
        range: options.range,
        emptyCurrent: options.totalCurrent === 0,
        emptyLabel: "No tenders in this period",
      }),
    },
    {
      key: "activeBids",
      label: "Active Bids",
      value: options.activeSnapshot.toLocaleString("en-IN"),
      comparison: formatActiveBidsComparison({
        snapshotValue: options.activeSnapshot,
        enteredDelta,
        range: options.range,
      }),
    },
    {
      key: "winRate",
      label: "Win Rate",
      value: formatWinRateValue(options.winRateCurrent),
      comparison: formatWinRateComparison({
        currentRate: options.winRateCurrent,
        previousRate: options.winRatePrevious,
        decidedCount: options.decidedCurrent,
        previousDecidedCount: options.decidedPrevious,
      }),
    },
    {
      key: "pendingReview",
      label: "Pending Review",
      value: options.pendingSnapshot.toLocaleString("en-IN"),
      comparison: formatPendingReviewComparison({
        pendingCount: options.pendingSnapshot,
        overdueCount: options.pendingOverdue,
      }),
    },
  ];
}

/**
 * Aggregated dashboard payload for the overview UI.
 *
 * Field audit (production columns):
 * - Imported/seen: first_seen_at | crawled_at on agenttender_web_tender_list
 * - Qualification: effective_qualification_status, qualified_at, manual_review_required
 * - Submitted: agenttender_bid_workspaces.submission_status / submitted_at (company-scoped)
 * - Won/lost: not tracked yet (no award outcome column) → Win Rate stays "—" until decided
 * - Tender value: tender_value
 * - Deadline: closing_date
 * - Document expiry: agenttender_company_documents.expiry_date (via listExpiringDocuments)
 *
 * Time-range behavior:
 * - Total Tenders: imported in selected window; comparison vs preceding equal window
 * - Active Bids: live snapshot; comparison = net entered-active events in window vs prior
 * - Win Rate: Won/decided when award data exists; else "—" / Small sample / No decided bids
 * - Pending Review: live VERIFY snapshot; comparison = overdue by closing_date < today
 * - Pipeline / deadlines / expiry banner: live (range-independent)
 * - Volume / status / activity: range-filtered
 */
export async function getDashboardOverview(options: {
  range: DashboardTimeRange;
  companyId: string | null;
}): Promise<DashboardOverview> {
  const supabase = getServerSupabase();
  const now = new Date();
  const today = startOfDay(now);
  const days = dashboardRangeDays(options.range);
  const rangeTo = now;
  const rangeFrom = startOfDay(subDays(now, days - 1));
  const priorTo = subDays(rangeFrom, 1);
  const priorFrom = startOfDay(subDays(priorTo, days - 1));

  const [
    listRes,
    submittedMap,
    expiringDocuments,
    recentActivity,
  ] = await Promise.all([
    supabase
      .from("agenttender_web_tender_list")
      .select(
        "id, title, source_tender_id, source_portal, closing_date, tender_value, effective_qualification_status, manual_review_required, first_seen_at, crawled_at, qualified_at, updated_at",
      )
      .limit(8000),
    loadSubmittedWorkspaces(options.companyId),
    loadExpiringDocuments(options.companyId),
    loadRecentActivity(rangeFrom),
  ]);

  if (listRes.error) {
    throw new Error(listRes.error.message);
  }

  const allRows = (listRes.data || []) as TenderRow[];
  const submittedIds = new Set(submittedMap.keys());

  const currentRows = allRows.filter((row) =>
    inRange(eventTime(row), rangeFrom, rangeTo),
  );
  const priorRows = allRows.filter((row) =>
    inRange(eventTime(row), priorFrom, priorTo),
  );

  // Active Bids: live snapshot across all tenders (not limited to imports in range).
  const activeSnapshot = allRows.filter((row) => {
    const stage = mapToDashboardPipelineStage({
      qualificationStatus: row.effective_qualification_status,
      submitted: submittedIds.has(row.id),
    });
    return isActiveBidStatus(stage);
  }).length;

  const enteredActiveCurrent = countEnteredActiveInPeriod(
    allRows,
    submittedMap,
    rangeFrom,
    rangeTo,
  );
  const enteredActivePrevious = countEnteredActiveInPeriod(
    allRows,
    submittedMap,
    priorFrom,
    priorTo,
  );

  // Pending Review: live VERIFY snapshot (+ non-GO manual review flags).
  const pendingRows = allRows.filter((row) =>
    isPendingReviewStatus(
      row.effective_qualification_status,
      row.manual_review_required,
    ),
  );
  const pendingSnapshot = pendingRows.length;
  const pendingOverdue = pendingRows.filter((row) => {
    const closing = parseDate(row.closing_date);
    if (!closing) return false;
    return startOfDay(closing).getTime() < today.getTime();
  }).length;

  /*
   * Win rate: award outcomes are not stored yet
   * (bid workspace only has not_submitted | submitted).
   * Formula reserved: won / (won + lost) among decided bids in the period.
   * Until award fields exist, decidedCount = 0 → "—" / "No decided bids".
   */
  const winRateCurrent: number | null = null;
  const winRatePrevious: number | null = null;
  const decidedCurrent = 0;
  const decidedPrevious = 0;

  const kpiCards = buildKpiCards({
    range: options.range,
    totalCurrent: currentRows.length,
    totalPrevious: priorRows.length,
    activeSnapshot,
    enteredActiveCurrent,
    enteredActivePrevious,
    pendingSnapshot,
    pendingOverdue,
    winRateCurrent,
    winRatePrevious,
    decidedCurrent,
    decidedPrevious,
  });

  const { stages: pipeline, total: pipelineTotal } = buildPipeline(
    allRows,
    submittedIds,
  );

  return {
    range: options.range,
    kpiCards,
    expiringDocuments,
    pipeline,
    pipelineTotal,
    tenderVolumeTrend: buildVolumeTrend(
      allRows,
      rangeFrom,
      rangeTo,
      options.range,
    ),
    volumeSubtitle: volumeSubtitle(options.range),
    tenderStatusDistribution: buildStatusDistribution(currentRows),
    recentActivity,
    upcomingDeadlines: buildUpcomingDeadlines(allRows),
  };
}

/**
 * Dashboard status stages — mirrors tender status dropdown / list filters.
 * Live bid funnel KPIs use DASHBOARD_LIVE_PIPELINE_STAGES only.
 */
export const DASHBOARD_PIPELINE_STAGES = [
  "verify",
  "under_evaluation",
  "may_bid",
  "will_bid",
  "partnership",
  "submitted",
  "won",
  "lost",
  "disqualified",
  "no_bid",
  "duplicate",
  "cancelled",
] as const;

export type DashboardPipelineStage = (typeof DASHBOARD_PIPELINE_STAGES)[number];

/** Active opportunities counted in pipeline KPIs (excludes terminal statuses). */
export const DASHBOARD_LIVE_PIPELINE_STAGES = [
  "verify",
  "under_evaluation",
  "may_bid",
  "will_bid",
  "partnership",
  "submitted",
] as const;

export type DashboardLivePipelineStage =
  (typeof DASHBOARD_LIVE_PIPELINE_STAGES)[number];

const LIVE_PIPELINE_STAGE_SET = new Set<string>(DASHBOARD_LIVE_PIPELINE_STAGES);

export function isLiveDashboardPipelineStage(
  stage: DashboardPipelineStage | null | undefined,
): stage is DashboardLivePipelineStage {
  return Boolean(stage && LIVE_PIPELINE_STAGE_SET.has(stage));
}

export const DASHBOARD_PIPELINE_META: Record<
  DashboardPipelineStage,
  {
    label: string;
    number: number;
    barClass: string;
    iconBg: string;
    iconText: string;
    color: string;
  }
> = {
  verify: {
    label: "Verify",
    number: 1,
    barClass: "bg-sky-500",
    iconBg: "bg-sky-50",
    iconText: "text-sky-600",
    color: "#0ea5e9",
  },
  under_evaluation: {
    label: "Under Evaluation",
    number: 2,
    barClass: "bg-slate-400",
    iconBg: "bg-slate-100",
    iconText: "text-slate-600",
    color: "#64748b",
  },
  may_bid: {
    label: "May Bid",
    number: 3,
    barClass: "bg-amber-500",
    iconBg: "bg-amber-50",
    iconText: "text-amber-600",
    color: "#f59e0b",
  },
  will_bid: {
    label: "Will Bid",
    number: 4,
    barClass: "bg-emerald-500",
    iconBg: "bg-emerald-50",
    iconText: "text-emerald-600",
    color: "#10b981",
  },
  partnership: {
    label: "Partnership",
    number: 5,
    barClass: "bg-violet-500",
    iconBg: "bg-violet-50",
    iconText: "text-violet-600",
    color: "#7c3aed",
  },
  submitted: {
    label: "Submitted",
    number: 6,
    barClass: "bg-blue-500",
    iconBg: "bg-blue-50",
    iconText: "text-blue-600",
    color: "#3b82f6",
  },
  won: {
    label: "Won",
    number: 7,
    barClass: "bg-emerald-600",
    iconBg: "bg-emerald-50",
    iconText: "text-emerald-800",
    color: "#16a34a",
  },
  lost: {
    label: "Lost",
    number: 8,
    barClass: "bg-rose-700",
    iconBg: "bg-rose-50",
    iconText: "text-rose-800",
    color: "#b91c1c",
  },
  disqualified: {
    label: "Disqualified",
    number: 9,
    barClass: "bg-red-600",
    iconBg: "bg-red-50",
    iconText: "text-red-800",
    color: "#9f1239",
  },
  no_bid: {
    label: "No Bid",
    number: 10,
    barClass: "bg-rose-500",
    iconBg: "bg-rose-50",
    iconText: "text-rose-700",
    color: "#dc2626",
  },
  duplicate: {
    label: "Duplicate",
    number: 11,
    barClass: "bg-slate-500",
    iconBg: "bg-slate-50",
    iconText: "text-slate-700",
    color: "#6b7280",
  },
  cancelled: {
    label: "Tender cancelled",
    number: 12,
    barClass: "bg-stone-500",
    iconBg: "bg-stone-50",
    iconText: "text-stone-700",
    color: "#78716c",
  },
};

/**
 * Map qualification + workspace flags into a dashboard status stage.
 * Matches tender dropdown / list filter buckets.
 */
export function mapToDashboardPipelineStage(options: {
  qualificationStatus: string | null | undefined;
  submitted: boolean;
  won?: boolean;
}): DashboardPipelineStage {
  if (options.won) return "won";
  const raw = String(options.qualificationStatus || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (raw === "WON" || raw === "AWARDED") return "won";
  if (raw === "LOST") return "lost";
  if (raw === "DISQUALIFIED") return "disqualified";
  if (raw === "NO_GO" || raw === "NO_BID") return "no_bid";
  if (raw === "DUPLICATE") return "duplicate";
  if (raw === "CANCELLED" || raw === "CANCELED") return "cancelled";
  // qualification_status SUBMITTED (manual import / bid lock) counts as submitted
  // even when bid_workspace.submission_status is missing.
  if (raw === "SUBMITTED" || options.submitted) return "submitted";
  if (raw === "GO" || raw === "WILL_BID") return "will_bid";
  if (raw === "PARTNER_BID" || raw === "PARTNERSHIP") return "partnership";
  if (raw === "CONDITIONAL_GO" || raw === "MAY_BID") return "may_bid";
  if (raw === "VERIFY") return "verify";
  return "under_evaluation";
}

export function isPendingReviewStatus(
  status: string | null | undefined,
  manualReviewRequired?: boolean | null,
): boolean {
  if (status === "VERIFY") return true;
  if (manualReviewRequired && status !== "NO_GO" && status !== "GO") {
    return true;
  }
  return false;
}

export function isActiveBidStatus(
  stage: DashboardPipelineStage | null,
): boolean {
  return (
    stage === "may_bid" ||
    stage === "will_bid" ||
    stage === "partnership" ||
    stage === "submitted"
  );
}

export function isActionableQualificationStatus(
  status: string | null | undefined,
): boolean {
  return (
    status === "GO" ||
    status === "CONDITIONAL_GO" ||
    status === "PARTNER_BID"
  );
}

export function isWonQualificationStatus(
  status: string | null | undefined,
): boolean {
  const raw = String(status || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return raw === "WON" || raw === "AWARDED";
}

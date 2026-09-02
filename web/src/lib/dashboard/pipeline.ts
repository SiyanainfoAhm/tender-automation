/**
 * Executive Dashboard bid-pipeline stages (UI buckets).
 * CONDITIONAL_GO → May Bid here (list UI may still label it Screening).
 */
export const DASHBOARD_PIPELINE_STAGES = [
  "verify",
  "under_evaluation",
  "may_bid",
  "will_bid",
  "partnership",
  "submitted",
] as const;

export type DashboardPipelineStage = (typeof DASHBOARD_PIPELINE_STAGES)[number];

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
    label: "Under evaluation",
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
};

/**
 * Map qualification + workspace flags into an active bid-pipeline stage.
 * Won / No Bid are excluded from the live funnel.
 */
export function mapToDashboardPipelineStage(options: {
  qualificationStatus: string | null | undefined;
  submitted: boolean;
  won?: boolean;
}): DashboardPipelineStage | null {
  if (options.won) return null;
  const raw = String(options.qualificationStatus || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (raw === "WON" || raw === "AWARDED") return null;
  if (raw === "NO_GO" || raw === "NO_BID") return null;
  if (options.submitted) return "submitted";

  const status = String(options.qualificationStatus || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (status === "GO" || status === "WILL_BID") return "will_bid";
  if (status === "PARTNER_BID" || status === "PARTNERSHIP") return "partnership";
  if (status === "CONDITIONAL_GO" || status === "MAY_BID") return "may_bid";
  if (status === "VERIFY") return "verify";
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

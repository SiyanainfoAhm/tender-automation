import type { TenderStatus } from "@/lib/tender-status";

/**
 * Dashboard Active Bid Pipeline stages (UI buckets).
 * Maps DB qualification + bid-workspace submission into visible stages.
 * CONDITIONAL_GO is Screening (not a separate May Bid stage).
 */
export const DASHBOARD_PIPELINE_STAGES = [
  "screening",
  "partnership",
  "will_bid",
  "submitted",
  "won",
] as const;

export type DashboardPipelineStage = (typeof DASHBOARD_PIPELINE_STAGES)[number];

export const DASHBOARD_PIPELINE_META: Record<
  DashboardPipelineStage,
  {
    label: string;
    number: number;
    /** Tailwind / hex accents matching reference */
    barClass: string;
    iconBg: string;
    iconText: string;
    color: string;
  }
> = {
  screening: {
    label: "Screening",
    number: 1,
    barClass: "bg-slate-400",
    iconBg: "bg-slate-100",
    iconText: "text-slate-600",
    color: "#64748b",
  },
  partnership: {
    label: "Partnership",
    number: 2,
    barClass: "bg-violet-500",
    iconBg: "bg-violet-50",
    iconText: "text-violet-600",
    color: "#7c3aed",
  },
  will_bid: {
    label: "Will Bid",
    number: 3,
    barClass: "bg-emerald-500",
    iconBg: "bg-emerald-50",
    iconText: "text-emerald-600",
    color: "#10b981",
  },
  submitted: {
    label: "Submitted",
    number: 4,
    barClass: "bg-blue-500",
    iconBg: "bg-blue-50",
    iconText: "text-blue-600",
    color: "#3b82f6",
  },
  won: {
    label: "Won",
    number: 5,
    barClass: "bg-green-600",
    iconBg: "bg-green-50",
    iconText: "text-green-700",
    color: "#16a34a",
  },
};

/**
 * Map qualification status (+ optional submitted flag) into a pipeline stage.
 *
 * - Submitted bid workspace → Submitted (never inferred from GO alone)
 * - GO → Will Bid
 * - PARTNER_BID → Partnership
 * - VERIFY / CONDITIONAL_GO / null / unknown → Screening
 * - NO_GO is excluded from the active pipeline
 * - Won is reserved for explicit award outcomes (none tracked yet → never returned)
 */
export function mapToDashboardPipelineStage(options: {
  qualificationStatus: string | null | undefined;
  submitted: boolean;
  won?: boolean;
}): DashboardPipelineStage | null {
  if (options.won) return "won";
  if (options.submitted) return "submitted";

  const status = options.qualificationStatus as TenderStatus | null | undefined;
  if (status === "NO_GO") return null;
  if (status === "GO") return "will_bid";
  if (status === "PARTNER_BID") return "partnership";
  return "screening";
}

/**
 * Pending Review KPI uses VERIFY (and manual_review_required flags).
 */
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

/**
 * Active Bids = Partnership / Will Bid / Submitted.
 * Screening (VERIFY / CONDITIONAL_GO / unevaluated) is not an active bid.
 */
export function isActiveBidStatus(
  stage: DashboardPipelineStage | null,
): boolean {
  return (
    stage === "partnership" || stage === "will_bid" || stage === "submitted"
  );
}

/** Qualification statuses that mean the tender has entered the active bid path. */
export function isActionableQualificationStatus(
  status: string | null | undefined,
): boolean {
  return (
    status === "GO" ||
    status === "CONDITIONAL_GO" ||
    status === "PARTNER_BID"
  );
}

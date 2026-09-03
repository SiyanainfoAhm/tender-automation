import { STATUS_DISPLAY_LABELS, TENDER_STATUSES, type TenderStatus } from "@/lib/tender-status";

export const CLASSIFICATION_ACTIONS = [
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
  "NO_GO",
] as const;

export type ClassificationAction = (typeof CLASSIFICATION_ACTIONS)[number];

export type PipelineStage = "new" | "screening" | "will_bid" | "submitted";

export const PIPELINE_STAGES: Array<{ key: PipelineStage; label: string }> = [
  { key: "new", label: "New" },
  { key: "screening", label: "Screening" },
  { key: "will_bid", label: "Will Bid" },
  { key: "submitted", label: "Submitted" },
];

export const CLASSIFICATION_ACTION_META: Record<
  ClassificationAction,
  {
    label: string;
    toast: string;
    activeClass: string;
    idleClass: string;
  }
> = {
  GO: {
    label: "Will Bid",
    toast: "Tender marked Will Bid.",
    activeClass: "bg-emerald-50 border-emerald-500 text-emerald-700",
    idleClass: "bg-white border-border text-foreground-600 hover:border-emerald-300",
  },
  CONDITIONAL_GO: {
    label: "May Bid",
    toast: "Tender marked May Bid.",
    activeClass: "bg-amber-50 border-amber-500 text-amber-700",
    idleClass: "bg-white border-border text-foreground-600 hover:border-amber-300",
  },
  PARTNER_BID: {
    label: "Partnership",
    toast: "Tender moved to Partnership.",
    activeClass: "bg-indigo-50 border-indigo-500 text-indigo-700",
    idleClass: "bg-white border-border text-foreground-600 hover:border-indigo-300",
  },
  NO_GO: {
    label: "No Bid",
    toast: "Tender marked No Bid.",
    activeClass: "bg-rose-50 border-rose-500 text-rose-700",
    idleClass: "bg-white border-border text-foreground-600 hover:border-rose-300",
  },
};

export const CLASSIFICATION_DECISION_LABELS: Record<TenderStatus, string> = {
  GO: "GO",
  CONDITIONAL_GO: "CONDITIONAL GO",
  PARTNER_BID: "PARTNER BID",
  VERIFY: "VERIFY",
  NO_GO: "NO-GO",
  DUPLICATE: "DUPLICATE",
  WON: "WON",
  LOST: "LOST",
  DISQUALIFIED: "DISQUALIFIED",
  SUBMITTED: "SUBMITTED",
  CANCELLED: "CANCELLED",
};

export const CLASSIFICATION_REQUIRED_ACTIONS: Record<TenderStatus, string> = {
  GO: "Start bid preparation and lock the responsible owner and timeline.",
  CONDITIONAL_GO:
    "Proceed only while all listed conditions remain achievable before bid lock.",
  PARTNER_BID:
    "Obtain approval, partner evidence and the required agreement before bid lock.",
  VERIFY: "Hold the decision and obtain the missing source or clarification.",
  NO_GO: "Record the exact reason and close the tender.",
  DUPLICATE:
    "This tender matches another record — open the linked tender to see why it was marked duplicate.",
  WON: "Record award details and move into project handover.",
  LOST: "Record the lost reason and close the opportunity.",
  DISQUALIFIED: "Record the disqualification reason and archive the tender.",
  SUBMITTED: "Track submission confirmation and await evaluation results.",
  CANCELLED: "Record that the buyer cancelled or withdrew this tender.",
};

export function isTenderStatus(value: string | null | undefined): value is TenderStatus {
  return Boolean(value && (TENDER_STATUSES as readonly string[]).includes(value));
}

export function isClassificationAction(
  value: string | null | undefined,
): value is ClassificationAction {
  return Boolean(value && (CLASSIFICATION_ACTIONS as readonly string[]).includes(value));
}

export function classificationLabel(status: TenderStatus | null | undefined): string {
  if (!isTenderStatus(status)) return "Not evaluated";
  return STATUS_DISPLAY_LABELS[status];
}

/**
 * Visual pipeline only. Submitted is never inferred from GO.
 * VERIFY / CONDITIONAL_GO / Partnership / No Bid stay on Screening.
 */
export function derivePipelineStage(options: {
  qualificationStatus: TenderStatus | null;
  submitted: boolean;
}): PipelineStage {
  if (
    options.submitted ||
    options.qualificationStatus === "SUBMITTED"
  ) {
    return "submitted";
  }
  if (options.qualificationStatus === "GO") return "will_bid";
  if (options.qualificationStatus) return "screening";
  return "new";
}

export function pipelineStageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.findIndex((item) => item.key === stage);
}

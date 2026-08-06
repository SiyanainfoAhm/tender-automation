export const TENDER_DECISION_STATUSES = [
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
  "VERIFY",
  "NO_GO",
] as const;

export type TenderDecisionStatus =
  (typeof TENDER_DECISION_STATUSES)[number];

export const TENDER_DECISION_LABELS: Record<TenderDecisionStatus, string> = {
  GO: "GO",
  CONDITIONAL_GO: "CONDITIONAL GO",
  PARTNER_BID: "PARTNER BID",
  VERIFY: "VERIFY",
  NO_GO: "NO-GO",
};

export const TENDER_DECISION_REQUIRED_ACTIONS: Record<
  TenderDecisionStatus,
  string
> = {
  GO: "Start bid preparation and lock the responsible owner and timeline.",
  CONDITIONAL_GO:
    "Proceed only while all listed conditions remain achievable before bid lock.",
  PARTNER_BID:
    "Obtain approval, partner evidence and the required agreement before bid lock.",
  VERIFY: "Hold the decision and obtain the missing source or clarification.",
  NO_GO: "Record the exact reason and close the tender.",
};

/** @deprecated Use TENDER_DECISION_STATUSES */
export const ALLOWED_QUALIFICATION_STATUSES = TENDER_DECISION_STATUSES;

/** @deprecated Use TenderDecisionStatus */
export type QualificationStatus = TenderDecisionStatus;

export interface QualificationCondition {
  condition: string;
  action: string;
  owner: string;
  dueDate: string;
}

export interface QualificationResult {
  sourcePortal?: "TENDER247" | "BIDASSIST";
  sourceTenderId?: string;
  t247Id: string;
  bidassistId?: string;
  company: string;
  status: TenderDecisionStatus;
  decisionLabel: string;
  /** Optional free-text verdict from the model before normalization */
  verdict: string;
  reason: string;
  requiredAction: string;
  confidence: number | string;
  matchedCriteria: string[];
  failedCriteria: string[];
  unclearCriteria: string[];
  missingDocuments: string[];
  conditions: QualificationCondition[];
  partnershipRequiredFor: string[];
  partnershipModeAllowed: string[];
  manualReviewRequired: boolean;
  /** Phase 2 flag: VERIFY due to insufficient AI Summary detail */
  requiresDetailedTenderReview?: boolean;
  evidenceFiles?: string[];
  /** Preserved when migrating from old status enums */
  legacyStatus?: string;
}

export interface GptReadinessReport {
  expected: number;
  ready: number;
  missingTenderIds: string[];
  readyTenderIds: string[];
  readyForQualification: boolean;
  date: string;
  checkedAt: string;
}

export interface TenderFileBundle {
  t247Id: string;
  tenderFolder: string;
  metadataPath: string | null;
  aiSummaryPath: string | null;
  allDocumentsArchivePath: string | null;
  uploadFiles: string[];
  skippedDuplicates: number;
}

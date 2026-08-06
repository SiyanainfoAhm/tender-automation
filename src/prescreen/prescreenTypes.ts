export type PrescreenSourcePortal = "TENDER247" | "BIDASSIST";

export type PrescreenStatus =
  | "PASSED"
  | "REJECTED"
  | "MANUAL_REVIEW"
  | "ERROR";

export type PrescreenTenderStatus =
  | "NOT_RUN"
  | PrescreenStatus;

export type PrescreenEffectiveStatus = "NO_GO" | "VERIFY" | null;

export type PrescreenReasonCode =
  | "MISSING_REQUIRED_SUMMARY"
  | "CLOSING_DATE_EXPIRED"
  | "CLOSING_DATE_TODAY"
  | "INSUFFICIENT_LEAD_TIME"
  | "EMD_ABOVE_LIMIT"
  | "TENDER_VALUE_ABOVE_LIMIT"
  | "NON_IT_SCOPE"
  | "AMBIGUOUS_SCOPE"
  | "PASSED_BASIC_SCREENING"
  | "PRESCREEN_DISABLED"
  | "PRESCREEN_ERROR";

export type ItRelevance = "RELEVANT" | "NON_IT" | "AMBIGUOUS";

export type DecisionSource = "PRESCREEN" | "CHATGPT" | "MANUAL";

export interface PrescreenThresholds {
  tenderValueMaxInr: number;
  emdMaxInr: number;
  minimumLeadDays: number;
}

export interface PrescreenFacts {
  title: string;
  category: string;
  closingDate: string;
  closingDateUnavailable: boolean;
  daysUntilClosing: number | null;
  tenderValue: number | null;
  tenderValueText: string;
  tenderValueUnavailable: boolean;
  emdAmount: number | null;
  emdText: string;
  emdRuleApplied: boolean;
  itRelevanceRuleApplied: boolean;
  itRelevance: ItRelevance | null;
  missingFields: string[];
  thresholds: PrescreenThresholds;
  categoryGateAssumed?: string;
}

export interface PrescreenInput {
  sourcePortal: PrescreenSourcePortal;
  sourceTenderId: string;
  title: string;
  category?: string | null;
  description?: string | null;
  closingDate?: string | null;
  tenderValue?: number | null;
  tenderValueText?: string | null;
  emdAmount?: number | null;
  emdText?: string | null;
  documentArchiveAvailable: boolean;
  /** True when a normalized/enriched Supabase metadata row exists */
  hasNormalizedMetadata: boolean;
}

export interface PrescreenDecision {
  status: PrescreenStatus;
  effectiveStatus: PrescreenEffectiveStatus;
  chatgptEligible: boolean;
  reasonCode: PrescreenReasonCode;
  reason: string;
  facts: PrescreenFacts;
  rulesVersion: string;
}

export interface PersistPrescreenOptions {
  tenderId: string;
  decision: PrescreenDecision;
  sourcePortal: PrescreenSourcePortal;
  sourceTenderId: string;
  metadataHash?: string | null;
}

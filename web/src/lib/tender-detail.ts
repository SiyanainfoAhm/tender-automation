import type { TenderSource } from "@/components/tenders/tender-status-styles";
import type { TenderStatus } from "@/lib/tender-status";

export type QualificationCondition = {
  condition?: string;
  action?: string;
  owner?: string;
  dueDate?: string;
};

export type ExtractedRequirement = {
  id: string;
  name: string;
  description: string;
  group: "matched" | "failed" | "unclear" | "missing";
  matched: boolean | null;
};

export type TenderActivityEvent = {
  id: string;
  eventType: string;
  summary: string;
  createdAt: string;
  actorName: string | null;
};

export type TenderArchiveDocument = {
  name: string;
  kind: string;
  sizeLabel: string | null;
  downloadable: boolean;
  /** Public Azure Blob URL when available. */
  url?: string | null;
};

export type TenderQualificationDTO = {
  id: string;
  status: TenderStatus;
  decisionLabel: string | null;
  verdict: string | null;
  reason: string | null;
  requiredAction: string | null;
  confidence: number | null;
  qualifiedAt: string | null;
  modelName: string | null;
  promptVersion: string | null;
  chatUrl: string | null;
  manualReviewRequired: boolean;
  matchedCriteria: unknown[];
  failedCriteria: unknown[];
  unclearCriteria: unknown[];
  missingDocuments: unknown[];
  conditions: unknown[];
  partnershipRequiredFor: unknown[];
  partnershipModeAllowed: unknown[];
  evidenceFiles: unknown[];
  rawResult: unknown;
};

export type TenderDetailDTO = {
  id: string;
  title: string;
  organization: string | null;
  authority: string | null;
  department: string | null;
  sourcePortal: TenderSource;
  sourceTenderId: string;
  folderId: string | null;
  sourceUrl: string | null;
  projectCategory: string | null;
  sourceCategory: string | null;
  tenderType: string | null;
  qualificationStatus: TenderStatus | null;
  description: string | null;
  scopeText: string | null;
  location: string | null;
  state: string | null;
  city: string | null;
  tenderValue: number | null;
  tenderValueText: string | null;
  emdAmount: number | null;
  emdText: string | null;
  publishedDate: string | null;
  closingDate: string | null;
  openingDate: string | null;
  bidSubmissionDate: string | null;
  documentArchiveAvailable: boolean;
  aiSummaryAvailable: boolean;
  downloadStatus: string | null;
  firstSeenAt: string | null;
  crawledAt: string | null;
  scrapedDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  prescreenStatus: string | null;
  prescreenReason: string | null;
  prescreenReasonCode: string | null;
  chatgptEligible: boolean | null;
  decisionSource: string | null;
  prescreenRulesVersion: string | null;
  prescreenedAt: string | null;
  submitted: boolean;
  workspaceId: string | null;
  qualification: TenderQualificationDTO | null;
  archiveDocuments: TenderArchiveDocument[];
  activity: TenderActivityEvent[];
  extractedRequirements: ExtractedRequirement[];
  /** Manual / extended fields from raw_metadata */
  tenderEstCost: number | null;
  tenderFee: number | null;
  processingFee: number | null;
  finalCost: number | null;
  msmeExemption: boolean;
  startupExemption: boolean;
  exemptionTypes: string[];
  contacts: Array<{ name: string; mobile: string; email?: string | null }>;
  notes: string | null;
  decisionReason: string | null;
  lostReason: string | null;
  disqualificationReason: string | null;
  duplicateOfSourceTenderId: string | null;
  duplicateOfTenderId: string | null;
  duplicateMatchKind: string | null;
};

export function displayDash(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : "—";
}

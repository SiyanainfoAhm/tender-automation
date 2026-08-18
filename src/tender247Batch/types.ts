export type TenderBatchStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partial"
  | "failed"
  | "dropped_non_it"
  | "ambiguous_manual_review";

export type ArtifactStepStatus =
  | "missing"
  | "partial"
  | "complete"
  | "unavailable"
  | "failed";

export interface DiscoveredTender {
  t247Id: string;
  position: number;
  securityCode?: string;
  title?: string | null;
  organisation?: string | null;
  submissionEndDate?: string | null;
  listRaw?: unknown;
}

export interface SessionContext {
  userId: number;
  userEmailServiceQueryId: number;
  mailDate: string;
}

export interface ApiEnvelope<T> {
  Success?: boolean;
  Message?: string;
  TotalRecord?: number;
  IsAuthFailure?: boolean;
  Data?: T;
  StatusCode?: number;
}

export interface SearchTenderRow {
  tender_id: number;
  requirement_workbrief?: string;
  organization_name?: string;
  security_code?: string;
  submission_enddate?: string;
  estimatedcost?: number;
  earnest_money_deposite?: number;
  tender_number?: string;
  doc_uploaded?: boolean;
  ai_summary?: boolean;
  [key: string]: unknown;
}

export interface DocumentListRow {
  tender_id: number;
  document_id: number;
  document_type_id: number;
  document_type_name: string;
  file_extension: string;
  corrigendum_published_date?: string;
  corrigendum_type?: string;
  doc_path: string;
  created_date?: string;
}

export interface ManifestTenderEntry {
  status: TenderBatchStatus;
  zipPath: string | null;
  zipSize?: number;
  documentsDownloaded: number;
  corrigendaDownloaded: number;
  aiSummaryDownloaded?: boolean;
  allDocumentsDownloaded?: boolean;
  securityCodeCaptured?: boolean;
  metadataStatus?: ArtifactStepStatus;
  aiSummaryStatus?: ArtifactStepStatus;
  allDocumentsStatus?: ArtifactStepStatus;
  metadataPath?: string | null;
  aiSummaryPath?: string | null;
  allDocumentsPath?: string | null;
  lastCompletedStep?: string | null;
    error: string | null;
    pendingReason?: string | null;
    artifactComplete?: boolean;
    chatgptSkipped?: boolean;
    updatedAt: string;
  failedDocuments?: Array<{ name: string; error: string }>;
}

export interface CrawlManifest {
  date: string;
  expectedCount: number;
  discoveredCount: number;
  processedCount: number;
  successCount: number;
  partialCount: number;
  failedCount: number;
  tenders: Record<string, ManifestTenderEntry>;
}

export interface ProcessTenderResult {
  t247Id: string;
  status: TenderBatchStatus;
  zipPath: string | null;
  zipSize?: number;
  documentsDownloaded: number;
  corrigendaDownloaded: number;
  aiSummaryDownloaded?: boolean;
  allDocumentsDownloaded?: boolean;
  securityCodeCaptured?: boolean;
  metadataStatus?: ArtifactStepStatus;
  aiSummaryStatus?: ArtifactStepStatus;
  allDocumentsStatus?: ArtifactStepStatus;
  metadataPath?: string | null;
  aiSummaryPath?: string | null;
  allDocumentsPath?: string | null;
  lastCompletedStep?: string | null;
  error: string | null;
  failedDocuments: Array<{ name: string; error: string }>;
  /** Pre-persistence IT relevance gate (Tender247 only) */
  itRelevance?: "IT_RELEVANT" | "NON_IT" | "AMBIGUOUS" | null;
  itRelevanceReasonCode?: string | null;
  itRelevanceMatchedTerms?: string[];
  itRelevanceNegativeTerms?: string[];
  itRelevanceEvidenceFields?: string[];
  itRelevanceExplanation?: string | null;
  titleForAudit?: string | null;
  supabaseWriteSkipped?: boolean;
  documentDownloadSkipped?: boolean;
  pendingReason?: string | null;
  artifactComplete?: boolean;
  chatgptSkipped?: boolean;
}

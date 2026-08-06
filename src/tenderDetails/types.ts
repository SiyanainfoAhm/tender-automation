/** Types for Tender247 per-tender detail crawl / document download. */

export interface TenderListItem {
  t247Id: string;
  detailUrl: string;
  listTitle: string | null;
  listClosingDate: string | null;
}

export type ExtractionStatus =
  | "success"
  | "partial"
  | "failed"
  | "skipped";

export type DownloadStatus =
  | "success"
  | "partial"
  | "failed"
  | "none"
  | "skipped";

export interface DownloadedFileRecord {
  kind: "document" | "corrigendum" | "ai_summary";
  linkText: string;
  originalFilename: string | null;
  finalFilename: string;
  relativePath: string;
  sizeBytes: number;
  status: "success" | "failed" | "skipped";
  error?: string;
  publishedDate?: string | null;
  corrigendumType?: string | null;
}

export interface TenderExtractedFields {
  t247Id: string | null;
  referenceNumber: string | null;
  tenderName: string | null;
  brief: string | null;
  description: string | null;
  organisation: string | null;
  department: string | null;
  location: string | null;
  submissionDate: string | null;
  openingDate: string | null;
  estimatedCost: string | null;
  emd: string | null;
  documentFees: string | null;
  category: string | null;
  completionPeriod: string | null;
  advisoryBank: string | null;
  emdInstrumentType: string | null;
  preBidMeeting: string | null;
  clarificationDate: string | null;
  detailUrl: string | null;
  /** Extra label/value pairs that did not map to known fields */
  extraFields: Record<string, string>;
}

export interface AiSummaryFields {
  documentRequiredFromSeller: string | null;
  eligibilityCriteria: string | null;
  minimumTurnover: string | null;
  pastExperience: string | null;
  similarCategory: string | null;
  contractPeriod: string | null;
  extraFields: Record<string, string>;
  available: boolean;
}

export interface TenderMetadata {
  crawlStartedAt: string;
  crawlCompletedAt: string | null;
  source: "tender247";
  sourceUrl: string;
  t247Id: string;
  listTitle: string | null;
  listClosingDate: string | null;
  extracted: TenderExtractedFields;
  aiSummary: AiSummaryFields;
  documents: DownloadedFileRecord[];
  corrigenda: DownloadedFileRecord[];
  aiSummaryPdf: DownloadedFileRecord | null;
  warnings: string[];
  extractionStatus: ExtractionStatus;
  downloadStatus: DownloadStatus;
  error?: string;
}

export interface TenderProcessResult {
  t247Id: string;
  detailUrl: string;
  folderPath: string;
  status: "success" | "partial" | "failed";
  documentsDownloaded: number;
  corrigendaDownloaded: number;
  bytesDownloaded: number;
  error?: string;
  metadataPath?: string;
  durationMs: number;
}

export interface CrawlReport {
  source: "tender247";
  dateIso: string;
  startTime: string;
  completionTime: string;
  durationMs: number;
  tendersDiscovered: number;
  tendersProcessed: number;
  successfulTenders: number;
  partiallySuccessfulTenders: number;
  failedTenders: number;
  totalDocumentsDownloaded: number;
  totalCorrigendaDownloaded: number;
  totalBytesDownloaded: number;
  discoveredListPath: string;
  results: TenderProcessResult[];
}

export interface CrawlOptions {
  onlyT247Id?: string;
  maxTenders?: number;
}

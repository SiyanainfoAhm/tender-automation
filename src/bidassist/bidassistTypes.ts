export type BidassistDownloadStatus =
  | "discovered"
  | "downloading"
  | "downloaded"
  | "extracted"
  | "completed"
  | "failed";

export interface BidassistDocumentMeta {
  originalName: string;
  storedName: string;
  extension: string;
  size: number;
  sha256: string;
}

export interface BidassistMetadata {
  sourcePortal: "BidAssist";
  sourcePrefix: "BA";
  bidassistId: string;
  folderId: string;
  title: string;
  authority: string;
  description: string;
  category: string;
  sourceTenderPortal: string;
  city: string;
  state: string;
  closingDate: string;
  openingDateFilterFrom: string;
  openingDateFilterTo: string | null;
  tenderAmountText: string;
  tenderDetailUrl: string;
  downloadedAt: string;
  originalZipFile: string;
  documents: BidassistDocumentMeta[];
  /** Enriched from extracted HTML/PDF (optional). */
  tenderValue?: number | null;
  tenderValueText?: string | null;
  emdAmount?: number | null;
  emdText?: string | null;
  organization?: string | null;
  department?: string | null;
  publishedDate?: string | null;
  openingDate?: string | null;
  bidSubmissionDate?: string | null;
  locationText?: string | null;
  sourceUrl?: string | null;
  listingMetadata?: Record<string, unknown>;
  documentExtraction?: Record<string, unknown>;
  normalized?: Record<string, unknown>;
}

export interface BidassistDownloadState {
  folderId: string;
  bidassistId: string;
  status: BidassistDownloadStatus;
  title?: string;
  tenderDetailUrl?: string | null;
  originalZipFile?: string | null;
  error?: string | null;
  updatedAt: string;
  discoveredAt?: string;
  completedAt?: string | null;
}

export interface BidassistCardInfo {
  title: string;
  authority: string;
  description: string;
  category: string;
  sourceTenderPortal: string;
  city: string;
  state: string;
  closingDate: string;
  tenderAmountText: string;
  tenderDetailUrl: string;
  cardIndex: number;
}

export interface BidassistCrawlSummary {
  discovered: number;
  selected: number;
  completed: number;
  skippedExisting: number;
  duplicateSkipped: number;
  failed: number;
  notDownloaded: number;
  pagesVisited: number;
  lastPageVisited: number;
}

import "server-only";

/** RAG source types matching Phase 2 DB check constraints. */
export type AiSourceType =
  | "TENDER_DOCUMENT"
  | "COMPANY_DOCUMENT"
  | "COMPANY_PROFILE";

export type AiIndexStatusValue =
  | "NOT_INDEXED"
  | "INDEXING"
  | "INDEXED"
  | "INDEX_FAILED"
  | "NEEDS_REINDEX";

export type AiChunkDraft = {
  companyId: string | null;
  tenderId: string | null;
  sourceType: AiSourceType;
  sourceId: string;
  documentName: string | null;
  documentUrl: string | null;
  documentType: string | null;
  pageNumber: number | null;
  section: string | null;
  chunkIndex: number;
  content: string;
  contentHash: string;
  embedding: number[];
  metadata: Record<string, unknown>;
};

export type ExtractedSourceText = {
  /** Stable logical source id for this text unit (may be a ZIP member). */
  sourceId: string;
  documentName: string;
  documentUrl: string | null;
  documentType: string | null;
  section: string | null;
  /** Whole-document page count when known; per-chunk pages often unavailable. */
  pageCount: number | null;
  text: string;
  metadata: Record<string, unknown>;
};

export type IndexSourceResult = {
  sourceType: AiSourceType;
  sourceId: string;
  status: AiIndexStatusValue | "SKIPPED_UNCHANGED" | "SKIPPED_DISABLED";
  chunkCount: number;
  contentHash: string | null;
  skipped: boolean;
  timings: {
    fetchMs: number;
    extractMs: number;
    chunkMs: number;
    embeddingMs: number;
    dbWriteMs: number;
    totalMs: number;
  };
  errorMessage?: string;
};

export type IndexableSourceDescriptor = {
  sourceType: AiSourceType;
  sourceId: string;
  companyId: string | null;
  tenderId: string | null;
  documentName: string;
  documentUrl: string | null;
  documentType: string | null;
  section: string | null;
  /** How to load bytes for this source. */
  fetch:
    | { kind: "company_document"; documentId: string; companyId: string }
    | { kind: "sharepoint_url"; url: string; fileName: string; tenderId?: string }
    | { kind: "profile_text"; text: string };
  metadata?: Record<string, unknown>;
};

export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export function getEmbeddingModel(): string {
  return (
    process.env.AI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL
  );
}

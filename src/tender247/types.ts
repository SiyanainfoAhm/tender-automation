/**
 * Normalized tender / document shapes for future Supabase persistence.
 *
 * These are application-level contracts only — they do NOT map to concrete
 * Tender App table/column names yet. Wire column mapping after inspecting the
 * live app schema.
 */

export const TENDER247_SOURCE = "tender247" as const;

export const TENDER247_STORAGE_PREFIX = "tender-documents/tender247" as const;

/** Build storage folder for a Tender247 tender: tender-documents/tender247/{T247_ID}/ */
export function tender247StorageFolder(t247Id: string): string {
  const id = t247Id.replace(/\D/g, "");
  return `${TENDER247_STORAGE_PREFIX}/${id}`;
}

/**
 * Normalized tender record intended for Supabase + Tender App import.
 * Column names in the live DB may differ — map later, do not guess.
 */
export interface NormalizedTenderRecord {
  source: typeof TENDER247_SOURCE | string;
  sourceTenderId: string;
  tenderReferenceId: string | null;
  tenderName: string | null;
  organisation: string | null;
  department: string | null;
  location: string | null;
  tenderValue: string | null;
  emdAmount: string | null;
  tenderFee: string | null;
  openingDate: string | null;
  closingDate: string | null;
  category: string | null;
  completionPeriod: string | null;
  brief: string | null;
  description: string | null;
  portalUrl: string | null;
  msmeExempted: boolean | null;
  startupExempted: boolean | null;
  /** Opaque source payload for audit / re-processing */
  rawSourceData: unknown;
  importedAt: string;
}

/**
 * Normalized document record for Supabase Storage + metadata table.
 * Column names in the live DB may differ — map later, do not guess.
 */
export interface NormalizedTenderDocumentRecord {
  /** App/DB tender FK once known — leave unset until schema is confirmed */
  tenderId?: string;
  source: typeof TENDER247_SOURCE | string;
  sourceTenderId: string;
  documentType: string | null;
  documentName: string;
  storagePath: string;
  originalUrl: string | null;
  fileSize: number | null;
  contentType: string | null;
  downloadedAt: string;
}

/**
 * Placeholder module map for the post-discovery API implementation.
 * Endpoints must come from network discovery — do not invent URLs.
 *
 * Planned files (not implemented yet):
 * - fetchTodayTenders.ts
 * - fetchTenderDetail.ts
 * - fetchTenderDocuments.ts
 * - downloadTenderDocuments.ts
 * - saveTenderToSupabase.ts
 */
export interface Tender247ApiEndpoints {
  /** Discovered list / today tenders endpoint — unknown until discovery */
  todayTendersUrl?: string;
  /** Discovered detail endpoint template — unknown until discovery */
  tenderDetailUrlTemplate?: string;
  /** Discovered document-list endpoint — unknown until discovery */
  documentListUrl?: string;
  /** Discovered download endpoint pattern — unknown until discovery */
  documentDownloadUrlPattern?: string;
}

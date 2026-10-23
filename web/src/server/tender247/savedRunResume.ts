import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient, createTender247MirrorSupabaseClient } from "@/lib/db/adminClient";
import {
  TENDER247_DOCUMENT_MIRROR_TABLE,
  TENDER247_TENDER_MIRROR_TABLE,
  TENDER_TARGET_TABLE,
  mapTender,
  mirrorTenderPayload,
  parseTender247ManifestToken,
  responseTenders,
  tender247Manifest,
  uploadTender247Document,
  upstreamResponseCanBeProcessed,
  type Tender247ManifestDocument,
} from "@/server/tender247/sync";

type Json = Record<string, unknown>;
type Db = SupabaseClient;

export type SavedRunFailure = {
  canonicalTenderId: string | null;
  tender247TenderId: string | null;
  canonicalDocumentId: string | null;
  tender247DocumentId: string | null;
  documentName: string | null;
  downloadUrl: string | null;
  error: string;
  attemptCount: number;
  candidateCanonicalTenderIds?: string[];
};

export type SavedRunDocumentRecoveryCounts = {
  totalCanonicalTender247Documents: number;
  complete: number;
  storageUrlNull: number;
  sharepointDriveItemIdNull: number;
  eitherIncomplete: number;
  bothIncomplete: number;
};

export type SavedRunResumeSummary = {
  runId: string;
  scrapedDate: string;
  savedSourceRecords: number;
  canonicalTendersProcessed: number;
  canonicalTenderUniqueMatches: number;
  canonicalTenderMissingMatches: number;
  canonicalTenderDuplicateMatches: number;
  canonicalTenderAmbiguousMatches: number;
  documentsDiscovered: number;
  documentsAlreadyComplete: number;
  documentsSelectedForRecovery: number;
  documentsRecovered: number;
  documentsReconciledFromExistingSharePointItems: number;
  /** Source bodies were conclusively unavailable/invalid; not app failures. */
  documentsSourceBlocked: number;
  documentsRetryPending: number;
  documentsUploadFailed: number;
  documentsInternalFailed: number;
  documentsFailed: number;
  mirrorUpsertsSucceeded: number;
  mirrorUpsertsFailed: number;
  tender247FeedApiCalls: 0;
  tender247ManifestDetailApiCalls: number;
  existingCanonicalTender247Documents: number;
  existingCompleteDocuments: number;
  existingIncompleteDocumentsSelected: number;
  documentsDownloaded: number;
  newCanonicalDocumentRowsCreated: 0;
  remainingIncompleteCanonicalDocuments: number;
  documentRecoveryCounts: SavedRunDocumentRecoveryCounts;
  failures: SavedRunFailure[];
};

export type Tender247DocumentOutcome = "COMPLETED" | "RECONCILED" | "SOURCE_EMPTY" | "SOURCE_INVALID" | "SOURCE_UNAVAILABLE" | "RETRY_PENDING" | "UPLOAD_FAILED" | "INTERNAL_FAILED";

/** Only evidence produced after bounded gateway validation is source-blocking.
 * Unknown historical errors deliberately remain application/internal failures. */
export function classifyTender247DocumentFailure(error: unknown): Tender247DocumentOutcome {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/DOCUMENT_STAGE_EMPTY/.test(message)) return "SOURCE_EMPTY";
  if (/DOCUMENT_(?:PDF|ZIP)_[A-Z_]+|SOURCE_DIGEST_MISMATCH/.test(message)) return "SOURCE_INVALID";
  if (/SOURCE_STATUS_INVALID: HTTP (?:404|410)/.test(message)) return "SOURCE_UNAVAILABLE";
  if (/SharePoint|Graph|upload session|chunk upload/i.test(message)) return "UPLOAD_FAILED";
  if (/UPSTREAM_|SOURCE_STREAM_INTERRUPTED|ECONNRESET|timeout/i.test(message)) return "RETRY_PENDING";
  return "INTERNAL_FAILED";
}

export function applyTender247Outcome(summary: Pick<SavedRunResumeSummary, "documentsSourceBlocked" | "documentsRetryPending" | "documentsUploadFailed" | "documentsInternalFailed">, outcome: Tender247DocumentOutcome): void {
  if (outcome === "SOURCE_EMPTY" || outcome === "SOURCE_INVALID" || outcome === "SOURCE_UNAVAILABLE") summary.documentsSourceBlocked += 1;
  else if (outcome === "RETRY_PENDING") summary.documentsRetryPending += 1;
  else if (outcome === "UPLOAD_FAILED") summary.documentsUploadFailed += 1;
  else if (outcome === "INTERNAL_FAILED") summary.documentsInternalFailed += 1;
}

type SavedRun = { id: string; company_id: string; run_date: string; summary: unknown };
type CanonicalTender = {
  id: string;
  qualification_status?: string | null;
  source_portal: string;
  source_region: string;
  source_tender_id: string;
  scraped_date: string | null;
  raw_metadata: unknown;
};
type CanonicalDocument = {
  id: string;
  tender_id: string;
  external_document_id: string | null;
  file_name: string | null;
  mime_type: string | null;
  storage_url: string | null;
  sharepoint_drive_item_id: string | null;
  storage_status: string | null;
  completed_at: string | null;
  file_size_bytes?: number | null;
};

function asRecord(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Keep a CLI/operator informed while a bounded gateway or Edge request runs.
 * It reports no credentials, URLs, tokens, or response bodies. */
async function withHeartbeat<T>(label: string, onProgress: ((message: string) => void) | undefined, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const timer = setInterval(() => onProgress?.(`${label} still running elapsedMs=${Date.now() - startedAt}`), 30_000);
  try { return await operation(); }
  finally { clearInterval(timer); onProgress?.(`${label} finished elapsedMs=${Date.now() - startedAt}`); }
}

function tender247Id(tender: Json): string | null {
  const value = tender.tenderid ?? tender.tenderId;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : asText(value);
}

/** This is intentionally separate from the run summary: a failed manifest
 * remains pending work even if every canonical document currently looks
 * complete. The RPC increments attempts atomically. */
export async function recordManifestRecoveryWork(
  db: Db, runId: string, canonicalTenderId: string, tender247TenderId: string,
  status: "PENDING" | "COMPLETED", lastError: string | null,
): Promise<void> {
  const { error } = await db.rpc("agenttender_record_tender247_manifest_recovery_work", {
    p_run_id: runId,
    p_canonical_tender_id: canonicalTenderId,
    p_tender247_tender_id: tender247TenderId,
    p_status: status,
    p_last_error: lastError,
  });
  if (error) throw new Error(`RECOVERY_WORK_ITEM_PERSIST_FAILED: ${error.message}`);
}

function retryEligibleAt(outcome: Tender247DocumentOutcome): string | null {
  const minutes = outcome === "RETRY_PENDING" ? Number(process.env.TENDER247_RETRY_PENDING_MINUTES || 15)
    : outcome === "SOURCE_EMPTY" ? Number(process.env.TENDER247_SOURCE_EMPTY_RECHECK_MINUTES || 24 * 60)
      : outcome === "SOURCE_UNAVAILABLE" ? Number(process.env.TENDER247_SOURCE_UNAVAILABLE_RECHECK_MINUTES || 24 * 60)
        : outcome === "SOURCE_INVALID" ? Number(process.env.TENDER247_SOURCE_INVALID_RECHECK_MINUTES || 7 * 24 * 60) : null;
  return minutes && Number.isFinite(minutes) && minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
}

export async function recordDocumentRecoveryOutcome(db: Db, runId: string, canonicalTenderId: string, tender247TenderId: string, document: Tender247ManifestDocument, outcome: Tender247DocumentOutcome, error: unknown = null, completed?: CanonicalDocument): Promise<void> {
  const message = error instanceof Error ? error.message : String(error || "");
  const nextRetry = retryEligibleAt(outcome);
  const { error: rpcError } = await db.rpc("agenttender_record_tender247_document_recovery_outcome", {
    p_run_id: runId, p_canonical_tender_id: canonicalTenderId, p_tender247_tender_id: tender247TenderId,
    p_external_document_id: document.documentid, p_display_filename: document.filename,
    p_status: outcome, p_last_error: message.slice(0, 1000) || null, p_retry_eligible_at: nextRetry,
    p_evidence: { classification: outcome },
    p_sharepoint_drive_item_id: completed?.sharepoint_drive_item_id || null,
    p_sharepoint_storage_url: completed?.storage_url || null,
  });
  if (rpcError) throw new Error(`RECOVERY_DOCUMENT_OUTCOME_PERSIST_FAILED: ${rpcError.message}`);
}

export function directDocuments(tender: Json): Tender247ManifestDocument[] {
  const documents = Array.isArray(tender.documents) ? tender.documents : [];
  const seen = new Set<string>();
  return documents.flatMap((value) => {
    const document = asRecord(value);
    const documentid = asText(document.documentid) || asText(document.documentId) || asText(document.id)
      || (typeof document.documentid === "number" ? String(document.documentid) : null);
    const filename = asText(document.name) || asText(document.filename) || asText(document.fileName);
    const downloadUrl = asText(document.downloadLink) || asText(document.downloadlink) || asText(document.url);
    const token = parseTender247ManifestToken(downloadUrl);
    if (!documentid || !filename || !downloadUrl || !token || seen.has(documentid)) return [];
    seen.add(documentid);
    const rawSize = document.size ?? document.fileSize ?? document.filesize;
    const parsedSize = rawSize == null ? null : Number(rawSize);
    return [{
      documentid,
      filename,
      contentType: asText(document.contentType) || asText(document.content_type) || "application/octet-stream",
      token,
      size: typeof parsedSize === "number" && Number.isSafeInteger(parsedSize) && parsedSize > 0 ? parsedSize : null,
    }];
  });
}

export function savedRawResponse(run: SavedRun): Json {
  const summary = asRecord(run.summary);
  const raw = summary.rawResponse;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Saved run rawResponse is unavailable or malformed; refusing any Tender247 API fallback.");
  }
  const response = raw as Json;
  if (!upstreamResponseCanBeProcessed(response)) {
    throw new Error("Saved Tender247 response was unsuccessful or rate-limited; no records were changed.");
  }
  return response;
}

export function isComplete(document: Pick<CanonicalDocument, "storage_url" | "sharepoint_drive_item_id">): boolean {
  return Boolean(document.storage_url && document.sharepoint_drive_item_id);
}

async function mirrorTender(db: Db, payload: Json): Promise<string> {
  const table = db.from(TENDER247_TENDER_MIRROR_TABLE);
  const existing = await table.select("id").eq("source_region", payload.source_region).eq("tender247_tender_id", payload.tender247_tender_id).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const updated = await db.from(TENDER247_TENDER_MIRROR_TABLE).update(payload).eq("id", existing.data.id).select("id").single();
    if (updated.error || !updated.data) throw new Error(updated.error?.message || "Unable to update mirror tender");
    return String(updated.data.id);
  }
  const inserted = await db.from(TENDER247_TENDER_MIRROR_TABLE).insert(payload).select("id").single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Unable to create mirror tender");
  return String(inserted.data.id);
}

async function mirrorDocument(db: Db, mirrorTenderId: string, canonicalTenderId: string, externalDocumentId: string, document: CanonicalDocument): Promise<void> {
  // Never propagate a partial/empty physical-storage result into the mirror.
  if (!document.storage_url || !document.sharepoint_drive_item_id) throw new Error("Canonical document is still missing SharePoint metadata");
  const payload = {
    tender247_tender_row_id: mirrorTenderId, canonical_tender_id: canonicalTenderId,
    canonical_document_id: document.id, external_document_id: externalDocumentId,
    filename: document.file_name, mime_type: document.mime_type, storage_status: document.storage_status || "COMPLETED",
    storage_url: document.storage_url, sharepoint_drive_item_id: document.sharepoint_drive_item_id,
    completed_at: document.completed_at,
  };
  const existing = await db.from(TENDER247_DOCUMENT_MIRROR_TABLE).select("id")
    .eq("tender247_tender_row_id", mirrorTenderId).eq("external_document_id", externalDocumentId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const write = existing.data
    ? db.from(TENDER247_DOCUMENT_MIRROR_TABLE).update(payload).eq("id", existing.data.id)
    : db.from(TENDER247_DOCUMENT_MIRROR_TABLE).insert(payload);
  const { error } = await write;
  if (error) throw new Error(error.message);
}

/** Recovery creates canonical rows from the immutable saved feed. Mirror that
 * completed result too; the previous implementation only mirrored the older
 * incomplete-row pass, which explains a zero-mirror result when recovery work
 * was predominantly newly-created documents. A mirror failure never changes a
 * completed canonical/SharePoint result and remains separately counted. */
async function mirrorRecoveredDocument(mirrorDb: Db | undefined, canonicalTenderId: string, externalDocumentId: string, document: CanonicalDocument): Promise<Db> {
  const db = mirrorDb || createTender247MirrorSupabaseClient();
  const mirrorTenderId = await existingMirrorTenderId(db, canonicalTenderId);
  if (!mirrorTenderId) throw new Error("MISSING_EXISTING_MIRROR_TENDER");
  await mirrorDocument(db, mirrorTenderId, canonicalTenderId, externalDocumentId, document);
  return db;
}

async function canonicalDocuments(db: Db, tenderId: string): Promise<CanonicalDocument[]> {
  const { data, error } = await db.from("agenttender_tender_documents")
    .select("id,tender_id,external_document_id,file_name,mime_type,storage_url,sharepoint_drive_item_id,storage_status,completed_at")
    .eq("tender_id", tenderId).eq("external_source", "TENDER247");
  if (error) throw new Error(error.message);
  return (data || []) as CanonicalDocument[];
}

async function reloadDocument(db: Db, id: string): Promise<CanonicalDocument | null> {
  const { data, error } = await db.from("agenttender_tender_documents")
    .select("id,tender_id,external_document_id,file_name,mime_type,storage_url,sharepoint_drive_item_id,storage_status,completed_at")
    .eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as CanonicalDocument;
}

async function incompleteCanonicalDocuments(db: Db, scrapedDate: string): Promise<CanonicalDocument[]> {
  const documents: CanonicalDocument[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db.from("agenttender_tender_documents")
      .select("id,tender_id,external_document_id,file_name,mime_type,file_size_bytes,storage_url,sharepoint_drive_item_id,storage_status,completed_at,agenttender_tenders!inner(scraped_date,source_portal)")
      .eq("external_source", "TENDER247")
      .eq("agenttender_tenders.scraped_date", scrapedDate)
      .eq("agenttender_tenders.source_portal", "TENDER247")
      .or("storage_url.is.null,sharepoint_drive_item_id.is.null")
      .order("id").range(start, start + 999);
    if (error) throw new Error(`Could not select incomplete canonical Tender247 documents: ${error.message}`);
    const page = (data || []) as CanonicalDocument[];
    documents.push(...page);
    if (page.length < 1000) return documents;
  }
}

async function existingMirrorTenderId(db: Db, canonicalTenderId: string): Promise<string | null> {
  const { data, error } = await db.from(TENDER247_TENDER_MIRROR_TABLE).select("id")
    .eq("canonical_tender_id", canonicalTenderId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String(data.id) : null;
}

const CANONICAL_TENDER_SELECT = "id,qualification_status,source_portal,source_region,source_tender_id,scraped_date,raw_metadata";

type CanonicalTenderResolution =
  | { kind: "resolved"; tender: CanonicalTender; duplicate: boolean; usedMetadataFallback: boolean }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidateIds: string[] };

/**
 * The canonical table's actual Tender247 identity is source_portal +
 * source_region + source_tender_id. `external_source` exists on the document
 * table, not this table. Fetch an array because the canonical schema permits
 * date-scoped snapshots for a stable Tender247 id. Never call single/maybeSingle
 * until the date preference has established a unique row.
 */
function selectCanonicalTender(rows: CanonicalTender[], scrapedDate: string): CanonicalTenderResolution {
  if (rows.length === 0) return { kind: "missing" };
  if (rows.length === 1) return { kind: "resolved", tender: rows[0], duplicate: false, usedMetadataFallback: false };
  const forSavedDate = rows.filter((row) => row.scraped_date === scrapedDate);
  if (forSavedDate.length === 1) return { kind: "resolved", tender: forSavedDate[0], duplicate: true, usedMetadataFallback: false };
  return { kind: "ambiguous", candidateIds: rows.map((row) => row.id).sort() };
}

/** Exported for focused tests; production callers use resolveCanonicalTender. */
export function resolveCanonicalTenderCandidates(rows: CanonicalTender[], scrapedDate: string): CanonicalTenderResolution {
  return selectCanonicalTender(rows, scrapedDate);
}

async function resolveCanonicalTender(
  db: Db,
  stableId: string,
  sourceRegion: string,
  scrapedDate: string,
): Promise<CanonicalTenderResolution> {
  const exact = await db.from(TENDER_TARGET_TABLE).select(CANONICAL_TENDER_SELECT)
    .eq("source_portal", "TENDER247").eq("source_region", sourceRegion).eq("source_tender_id", stableId);
  if (exact.error) throw new Error(exact.error.message);
  const exactResolution = selectCanonicalTender((exact.data || []) as CanonicalTender[], scrapedDate);
  if (exactResolution.kind !== "missing") return exactResolution;

  // Older ingestion could retain Tender247's stable id only in raw_metadata
  // while source_tender_id held the provider reference. This is a read-only,
  // explicitly-identifiable fallback; it never creates or repurposes a row.
  const metadata = await db.from(TENDER_TARGET_TABLE).select(CANONICAL_TENDER_SELECT)
    .eq("source_portal", "TENDER247").eq("source_region", sourceRegion)
    .eq("raw_metadata->tender247_sync->>tenderid", stableId);
  if (metadata.error) throw new Error(metadata.error.message);
  const metadataResolution = selectCanonicalTender((metadata.data || []) as CanonicalTender[], scrapedDate);
  if (metadataResolution.kind === "resolved") return { ...metadataResolution, usedMetadataFallback: true };
  return metadataResolution;
}

const EMPTY_DOCUMENT_RECOVERY_COUNTS: SavedRunDocumentRecoveryCounts = {
  totalCanonicalTender247Documents: 0, complete: 0, storageUrlNull: 0,
  sharepointDriveItemIdNull: 0, eitherIncomplete: 0, bothIncomplete: 0,
};

async function documentRecoveryCounts(db: Db, scrapedDate: string): Promise<SavedRunDocumentRecoveryCounts> {
  // PostgREST defaults to at most 1,000 rows. Page so this diagnostic and the
  // remaining-incomplete count are not silently truncated on large scrape days.
  const documents: Array<Pick<CanonicalDocument, "storage_url" | "sharepoint_drive_item_id">> = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db.from("agenttender_tender_documents")
      .select("id,storage_url,sharepoint_drive_item_id,agenttender_tenders!inner(scraped_date,source_portal)")
      .eq("external_source", "TENDER247")
      .eq("agenttender_tenders.scraped_date", scrapedDate)
      .eq("agenttender_tenders.source_portal", "TENDER247")
      .order("id").range(start, start + 999);
    if (error) throw new Error(`Could not inspect canonical Tender247 documents: ${error.message}`);
    const page = (data || []) as Array<Pick<CanonicalDocument, "storage_url" | "sharepoint_drive_item_id">>;
    documents.push(...page);
    if (page.length < 1000) return summarizeDocumentRecoveryCounts(documents);
  }
}

/** Exported for focused tests and read-only recovery diagnostics. */
export function summarizeDocumentRecoveryCounts(documents: Array<Pick<CanonicalDocument, "storage_url" | "sharepoint_drive_item_id">>): SavedRunDocumentRecoveryCounts {
  return documents.reduce<SavedRunDocumentRecoveryCounts>((counts, document) => {
    const storageUrlNull = document.storage_url === null;
    const sharepointDriveItemIdNull = document.sharepoint_drive_item_id === null;
    counts.totalCanonicalTender247Documents += 1;
    if (!storageUrlNull && !sharepointDriveItemIdNull) counts.complete += 1;
    if (storageUrlNull) counts.storageUrlNull += 1;
    if (sharepointDriveItemIdNull) counts.sharepointDriveItemIdNull += 1;
    if (storageUrlNull || sharepointDriveItemIdNull) counts.eitherIncomplete += 1;
    if (storageUrlNull && sharepointDriveItemIdNull) counts.bothIncomplete += 1;
    return counts;
  }, { ...EMPTY_DOCUMENT_RECOVERY_COUNTS });
}

export async function loadSavedTender247Run(db: Db, runId: string): Promise<{ run: SavedRun; rawResponse: Json }> {
  const { data, error } = await db.from("agenttender_pipeline_runs")
    .select("id,company_id,run_date,summary").eq("id", runId).eq("portal", "TENDER247").eq("mode", "api_sync").maybeSingle();
  if (error || !data) throw new Error("Saved Tender247 API run was not found.");
  const run = data as SavedRun;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(run.run_date))) throw new Error("Saved run has an invalid scraped date.");
  return { run, rawResponse: savedRawResponse(run) };
}

/**
 * Recovery deliberately consumes only the persisted raw response. It has no
 * code path to request the Tender247 `/tender-data` feed or a new pipeline run.
 */
export async function resumeSavedTender247Run(runId: string, dependencies?: { canonicalDb?: Db; mirrorDb?: Db; upload?: typeof uploadTender247Document; onProgress?: (message: string) => void; onlyExternalDocumentId?: string; onlyTender247TenderId?: string }): Promise<SavedRunResumeSummary> {
  const startedAt = Date.now();
  const canonicalDb = dependencies?.canonicalDb || createAdminSupabaseClient();
  const { run, rawResponse } = await loadSavedTender247Run(canonicalDb, runId);
  const scrapedDate = String(run.run_date); // persisted date only; never runtime date
  const summary: SavedRunResumeSummary = {
    runId, scrapedDate, savedSourceRecords: 0, canonicalTendersProcessed: 0, documentsDiscovered: 0,
    canonicalTenderUniqueMatches: 0, canonicalTenderMissingMatches: 0, canonicalTenderDuplicateMatches: 0, canonicalTenderAmbiguousMatches: 0,
    documentsAlreadyComplete: 0, documentsSelectedForRecovery: 0, documentsRecovered: 0,
    documentsReconciledFromExistingSharePointItems: 0, documentsFailed: 0, mirrorUpsertsSucceeded: 0,
    documentsSourceBlocked: 0, documentsRetryPending: 0, documentsUploadFailed: 0, documentsInternalFailed: 0,
    mirrorUpsertsFailed: 0, tender247FeedApiCalls: 0, tender247ManifestDetailApiCalls: 0,
    existingCanonicalTender247Documents: 0, existingCompleteDocuments: 0, existingIncompleteDocumentsSelected: 0,
    documentsDownloaded: 0, newCanonicalDocumentRowsCreated: 0, remainingIncompleteCanonicalDocuments: 0,
    documentRecoveryCounts: { ...EMPTY_DOCUMENT_RECOVERY_COUNTS }, failures: [],
  };
  const upload = dependencies?.upload || uploadTender247Document;
  const onlyExternalDocumentId = dependencies?.onlyExternalDocumentId || null;
  const onlyTender247TenderId = dependencies?.onlyTender247TenderId || null;
  let mirrorDb = dependencies?.mirrorDb;
  dependencies?.onProgress?.("canonical recovery counts query starting");
  summary.documentRecoveryCounts = await documentRecoveryCounts(canonicalDb, scrapedDate);
  dependencies?.onProgress?.("canonical recovery counts query completed");
  summary.existingCanonicalTender247Documents = summary.documentRecoveryCounts.totalCanonicalTender247Documents;
  summary.existingCompleteDocuments = summary.documentRecoveryCounts.complete;
  dependencies?.onProgress?.("incomplete canonical Tender247 document query starting");
  const incomplete = await incompleteCanonicalDocuments(canonicalDb, scrapedDate);
  dependencies?.onProgress?.(`incomplete document query completed, count=${incomplete.length}`);
  summary.existingIncompleteDocumentsSelected = onlyTender247TenderId ? 0 : incomplete.length;
  summary.documentsSelectedForRecovery = onlyTender247TenderId ? 0 : incomplete.length;
  dependencies?.onProgress?.("SharePoint/Tender247 client initialization starting");
  // Configuration is deliberately lazy; this phase performs no feed or
  // manifest enumeration and has no network side effect.
  dependencies?.onProgress?.("client initialization completed");
  dependencies?.onProgress?.("recovery loop starting");
  // A tender-scoped retry must not accidentally retry unrelated incomplete
  // canonical rows. Missing rows for the selected tender are handled below by
  // its immutable saved-feed entry and its manifest.
  const incompleteForThisInvocation = onlyTender247TenderId ? [] : incomplete;
  for (const [index, current] of incompleteForThisInvocation.entries()) {
    const progress = `[${index + 1}/${incomplete.length}]`;
    dependencies?.onProgress?.(`${progress} document=${current.id} starting`);
    const externalDocumentId = asText(current.external_document_id);
    if (onlyExternalDocumentId && externalDocumentId !== onlyExternalDocumentId) continue;
    if (!externalDocumentId || !current.file_name) {
      summary.documentsFailed += 1;
      summary.failures.push({ canonicalTenderId: current.tender_id, tender247TenderId: null, canonicalDocumentId: current.id, tender247DocumentId: externalDocumentId, documentName: current.file_name, downloadUrl: null, error: "EXISTING_CANONICAL_DOCUMENT_HAS_NO_RECOVERABLE_TOKEN_OR_FILENAME", attemptCount: 0 });
      dependencies?.onProgress?.(`${progress} failed`);
      continue;
    }
    try {
      const uploaded = await withHeartbeat(`${progress} document=${current.id}`, dependencies?.onProgress, () => upload({ tenderId: current.tender_id, scrapedDate, existingCanonicalDocumentId: current.id,
        document: { documentid: externalDocumentId, token: externalDocumentId, filename: current.file_name!, contentType: current.mime_type || "application/octet-stream", size: current.file_size_bytes ?? null },
        onDownloadStarting: () => { dependencies?.onProgress?.(`${progress} download starting`); },
        onDownloaded: () => { summary.documentsDownloaded += 1; dependencies?.onProgress?.(`${progress} download completed`); },
        onSharePointUploadStarting: () => { dependencies?.onProgress?.(`${progress} SharePoint upload starting`); },
        onCanonicalUpdateStarting: () => { dependencies?.onProgress?.(`${progress} canonical document update starting`); },
        onProgress: (message) => { dependencies?.onProgress?.(`${progress} ${message}`); },
        onSourceDetailRequested: () => { summary.tender247ManifestDetailApiCalls += 1; } }));
      if (uploaded.canonicalDocumentId !== current.id) throw new Error("DOCUMENT_CREATION_GUARD: upload session returned a different canonical document id");
      const after = await reloadDocument(canonicalDb, current.id);
      if (!after || !isComplete(after)) throw new Error("Upload/reconciliation returned incomplete SharePoint metadata");
      dependencies?.onProgress?.(`${progress} canonical document update completed`);
      if (uploaded.alreadyStored) summary.documentsReconciledFromExistingSharePointItems += 1;
      else summary.documentsRecovered += 1;
      try {
        dependencies?.onProgress?.(`${progress} mirror upsert starting`);
        mirrorDb = await mirrorRecoveredDocument(mirrorDb, current.tender_id, externalDocumentId, after);
        summary.mirrorUpsertsSucceeded += 1;
        dependencies?.onProgress?.(`${progress} mirror upsert completed`);
      } catch { summary.mirrorUpsertsFailed += 1; dependencies?.onProgress?.(`${progress} mirror upsert failed`); }
      dependencies?.onProgress?.(`${progress} completed`);
    } catch (cause) {
      summary.documentsFailed += 1;
      applyTender247Outcome(summary, classifyTender247DocumentFailure(cause));
      dependencies?.onProgress?.(`${progress} failed`);
      summary.failures.push({ canonicalTenderId: current.tender_id, tender247TenderId: null, canonicalDocumentId: current.id, tender247DocumentId: externalDocumentId, documentName: current.file_name, downloadUrl: null, error: cause instanceof Error ? cause.message : String(cause), attemptCount: 1 });
    }
  }
  // The original failure occurred before canonical rows were created for many
  // discovered documents. Recover those from the immutable saved feed rather
  // than treating absence of a canonical row as absence of work. This is the
  // only recovery phase that calls document manifests; it never calls the
  // Tender247 feed endpoint and remains sequential by design.
  const allSavedTenders = responseTenders(rawResponse);
  const savedTenders = onlyTender247TenderId
    ? allSavedTenders.filter((tender) => tender247Id(tender) === onlyTender247TenderId)
    : allSavedTenders;
  if (onlyTender247TenderId && savedTenders.length !== 1) {
    throw new Error(`Saved Tender247 run does not contain exactly one tender with id ${onlyTender247TenderId}.`);
  }
  summary.savedSourceRecords = savedTenders.length;
  dependencies?.onProgress?.(`saved-feed recovery starting tenders=${savedTenders.length} elapsedMs=${Date.now() - startedAt}`);
  for (const [tenderIndex, tender] of savedTenders.entries()) {
    const stableId = tender247Id(tender);
    const sourceRegion = asText(tender.region)?.toUpperCase() || "INDIAN";
    if (!stableId) continue;
    let resolved: CanonicalTenderResolution;
    dependencies?.onProgress?.(`saved-feed tender [${tenderIndex + 1}/${savedTenders.length}] id=${stableId} resolving canonical identity`);
    try { resolved = await resolveCanonicalTender(canonicalDb, stableId, sourceRegion, scrapedDate); }
    catch (cause) { summary.canonicalTenderMissingMatches += 1; summary.failures.push({ canonicalTenderId: null, tender247TenderId: stableId, canonicalDocumentId: null, tender247DocumentId: null, documentName: null, downloadUrl: null, error: cause instanceof Error ? cause.message : String(cause), attemptCount: 0 }); continue; }
    if (resolved.kind === "missing") { summary.canonicalTenderMissingMatches += 1; continue; }
    if (resolved.kind === "ambiguous") { summary.canonicalTenderAmbiguousMatches += 1; summary.failures.push({ canonicalTenderId: null, tender247TenderId: stableId, canonicalDocumentId: null, tender247DocumentId: null, documentName: null, downloadUrl: null, error: "AMBIGUOUS_CANONICAL_TENDER", attemptCount: 0, candidateCanonicalTenderIds: resolved.candidateIds }); continue; }
    summary.canonicalTendersProcessed += 1;
    if (resolved.duplicate) summary.canonicalTenderDuplicateMatches += 1; else summary.canonicalTenderUniqueMatches += 1;
    let manifest: Tender247ManifestDocument[];
    try {
      const embedded = directDocuments(tender);
      manifest = embedded.length ? embedded : await withHeartbeat(`saved-feed tender [${tenderIndex + 1}/${savedTenders.length}] id=${stableId} manifest`, dependencies?.onProgress, () => tender247Manifest(tender, fetch));
      if (!embedded.length && parseTender247ManifestToken(tender.zipdocumentdownload)) {
        summary.tender247ManifestDetailApiCalls += 1;
        await recordManifestRecoveryWork(canonicalDb, runId, resolved.tender.id, stableId, "COMPLETED", null);
      }
    } catch (cause) {
      summary.documentsFailed += 1;
      const message = cause instanceof Error ? cause.message : String(cause);
      try { await recordManifestRecoveryWork(canonicalDb, runId, resolved.tender.id, stableId, "PENDING", message); }
      catch (persistenceCause) {
        const persistenceMessage = persistenceCause instanceof Error ? persistenceCause.message : String(persistenceCause);
        summary.failures.push({ canonicalTenderId: resolved.tender.id, tender247TenderId: stableId, canonicalDocumentId: null, tender247DocumentId: null, documentName: null, downloadUrl: null, error: `MANIFEST_RECOVERY_FAILED: ${message}; ${persistenceMessage}`, attemptCount: 1 });
        continue;
      }
      summary.failures.push({ canonicalTenderId: resolved.tender.id, tender247TenderId: stableId, canonicalDocumentId: null, tender247DocumentId: null, documentName: null, downloadUrl: null, error: `MANIFEST_RECOVERY_FAILED: ${message}`, attemptCount: 1 });
      continue;
    }
    summary.documentsDiscovered += manifest.length;
    dependencies?.onProgress?.(`saved-feed tender [${tenderIndex + 1}/${savedTenders.length}] id=${stableId} manifestDocuments=${manifest.length} selected=${summary.documentsSelectedForRecovery} recovered=${summary.documentsRecovered} reconciled=${summary.documentsReconciledFromExistingSharePointItems} failed=${summary.documentsFailed}`);
    if (!manifest.length) continue;
    const present = new Set((await canonicalDocuments(canonicalDb, resolved.tender.id).then((rows) => rows.map((row) => asText(row.external_document_id)).filter((id): id is string => Boolean(id)))));
    for (const document of manifest) {
      if (onlyExternalDocumentId && document.documentid !== onlyExternalDocumentId) continue;
      if (present.has(document.documentid)) continue;
      summary.documentsSelectedForRecovery += 1;
      try {
        const uploaded = await withHeartbeat(`saved-feed tender [${tenderIndex + 1}/${savedTenders.length}] document=${document.documentid}`, dependencies?.onProgress, () => upload({ tenderId: resolved.tender.id, scrapedDate, document,
          onDownloaded: () => { summary.documentsDownloaded += 1; },
          onSourceDetailRequested: () => { summary.tender247ManifestDetailApiCalls += 1; } }));
        const after = await reloadDocument(canonicalDb, uploaded.canonicalDocumentId);
        if (!after || !isComplete(after)) throw new Error("Recovered document is missing SharePoint metadata");
        summary.newCanonicalDocumentRowsCreated += 1;
        if (uploaded.alreadyStored) summary.documentsReconciledFromExistingSharePointItems += 1; else summary.documentsRecovered += 1;
        present.add(document.documentid);
        // Success replaces any prior blocked/failed state for the same stable
        // run/document work key; the SQL guard prevents stale failures from
        // replacing this terminal state.
        await recordDocumentRecoveryOutcome(canonicalDb, runId, resolved.tender.id, stableId, document, uploaded.alreadyStored ? "RECONCILED" : "COMPLETED", null, after);
        // The saved-feed path creates most formerly missing canonical rows.
        // Keep the Tender247 mirror in sync without re-ingesting tenders.
        try {
          mirrorDb = await mirrorRecoveredDocument(mirrorDb, resolved.tender.id, document.documentid, after);
          summary.mirrorUpsertsSucceeded += 1;
        } catch {
          summary.mirrorUpsertsFailed += 1;
        }
      } catch (cause) {
        summary.documentsFailed += 1;
        const outcome = classifyTender247DocumentFailure(cause); applyTender247Outcome(summary, outcome);
        try { await recordDocumentRecoveryOutcome(canonicalDb, runId, resolved.tender.id, stableId, document, outcome, cause); } catch { summary.documentsInternalFailed += 1; }
        summary.failures.push({ canonicalTenderId: resolved.tender.id, tender247TenderId: stableId, canonicalDocumentId: null, tender247DocumentId: document.documentid, documentName: document.filename, downloadUrl: null, error: cause instanceof Error ? cause.message : String(cause), attemptCount: 1 });
      }
    }
  }
  summary.documentRecoveryCounts = await documentRecoveryCounts(canonicalDb, scrapedDate);
  summary.remainingIncompleteCanonicalDocuments = summary.documentRecoveryCounts.eitherIncomplete;
  dependencies?.onProgress?.(`recovery complete elapsedMs=${Date.now() - startedAt} tenders=${summary.canonicalTendersProcessed}/${summary.savedSourceRecords} selected=${summary.documentsSelectedForRecovery} recovered=${summary.documentsRecovered} reconciled=${summary.documentsReconciledFromExistingSharePointItems} failed=${summary.documentsFailed} remainingIncomplete=${summary.remainingIncompleteCanonicalDocuments}`);
  return summary;
}

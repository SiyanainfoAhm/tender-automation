import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient, createTender247MirrorSupabaseClient } from "@/lib/db/adminClient";
import { tender247SyncMode } from "./upstreamContract";

type Json = Record<string, unknown>;
const TENDER247_NETWORK_TIMEOUT_MS = 120_000;
type SyncStatus = "COMPLETED" | "PARTIAL_SUCCESS" | "FAILED";
export const TENDER_TARGET_TABLE = "agenttender_tenders";
export const TENDER247_TENDER_MIRROR_TABLE = "tender247_tenders";
export const TENDER247_DOCUMENT_MIRROR_TABLE = "tender247_documents";

export type Tender247SyncSummary = {
  scrapedDate: string;
  /** The unfiltered provider feed is usable, but date/pagination completeness is not documented. */
  sourceCompleteness: "VERIFIED" | "UNVERIFIED";
  tenderCount: number;
  tendersUpserted: number;
  tenderFailures: number;
  canonical: { inserted: number; updated: number; repaired: number; failed: number; identityConflicts: number };
  documentsUploaded: number;
  documentFailures: number;
  mirror: {
    tendersInserted: number; tendersUpdated: number; tendersFailed: number;
    documentsInserted: number; documentsUpdated: number; documentsFailed: number;
  };
  documents: {
    tendersWithDocuments: number; manifestsRequested: number; documentsDiscovered: number;
    manifestsFailed: number; attempted: number; alreadyStored: number; downloaded: number; sharepointUploaded: number; failed: number;
  };
  errors: string[];
};

export type Tender247CanonicalIdentity = {
  sourcePortal: "TENDER247";
  sourceRegion: string;
  sourceTenderId: string;
};

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : {};
}

function text(value: unknown): string | null {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const resolved = text(value);
    if (resolved) return resolved;
  }
  return null;
}

function listText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const values = value.map(text).filter((entry): entry is string => Boolean(entry));
    return values.length ? values.join(", ") : null;
  }
  return text(value);
}

function locationParts(tender: Json): { city: string | null; state: string | null; country: string | null; locationText: string | null } {
  const first = Array.isArray(tender.location) ? record(tender.location[0]) : {};
  const city = firstText(tender.city, tender.cityname, first.city);
  const state = firstText(tender.state, tender.statename, first.state);
  const country = firstText(tender.country, first.country);
  const locationText = firstText(
    typeof tender.location === "string" ? tender.location : null,
    tender.locationText,
    tender.location_text,
    [city, state, country].filter(Boolean).join(", "),
  );
  return { city, state, country, locationText };
}

function sourceIdentifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return text(value);
}

export function responseTenders(response: Json): Json[] {
  // Production Tender247 responses use PascalCase (`Data`, `Success`), while
  // older fixtures/gateway variants have used lower-case and nested shapes.
  const candidates = [
    response.Data, response.data, response.tenders, record(response.data).tenders,
    response.items,
  ];
  const result = candidates.find(Array.isArray);
  return Array.isArray(result) ? result.map(record) : [];
}

function tenderId(tender: Json): string | null {
  // This is Tender247's stable identity. `sourcetenderid` is merely the
  // original portal's reference and must never become canonical identity.
  return sourceIdentifier(tender.tenderid) || sourceIdentifier(tender.tenderId);
}

function dateOnly(value: unknown): string | null {
  const result = text(value);
  return result && /^\d{4}-\d{2}-\d{2}/.test(result) ? result.slice(0, 10) : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function mirrorTenderPayload(tender: Json, canonicalTenderId: string, scrapedDate: string): Json | null {
  const tender247TenderId = tenderId(tender);
  if (!tender247TenderId) return null;
  return {
    canonical_tender_id: canonicalTenderId,
    source_region: text(tender.region)?.toUpperCase() || "INDIAN",
    tender247_tender_id: tender247TenderId,
    source_tender_id: text(tender.sourcetenderid) || text(tender.sourceTenderId),
    title: firstText(tender.title, tender.name, tender.tenderTitle, tender.tendername, tender.tenderdescription, tender.tenderdetails),
    authority: text(tender.authority), organization: firstText(tender.organization, tender.organisation, tender.buyer, tender.authority),
    department: firstText(tender.department, tender.departmentName), description: firstText(tender.description, tender.tenderdescription, tender.tenderdetails), sector: listText(tender.sector), subindustry: listText(tender.subindustry) || listText(tender.subIndustry),
    category: firstText(tender.category, listText(tender.sector)), tender_type: firstText(tender.tenderType, tender.tendertype, tender.type), country: locationParts(tender).country, state: locationParts(tender).state, city: locationParts(tender).city, location_text: locationParts(tender).locationText,
    currency: text(tender.currency) || "INR", tender_value: numberOrNull(tender.tenderValue) ?? numberOrNull(tender.estimatedValue) ?? numberOrNull(tender.value), tender_value_text: firstText(tender.tenderValueText, tender.valuetext),
    emd_amount: numberOrNull(tender.emdAmount) ?? numberOrNull(tender.emd), emd_text: firstText(tender.emdText, tender.emdtext), document_cost: firstText(tender.documentCost, tender.documentcost),
    published_date: dateOnly(tender.publishedDate) || dateOnly(tender.publishDate) || dateOnly(tender.datecreated), opening_date: dateOnly(tender.openingDate), closing_date: dateOnly(tender.closingDate) || dateOnly(tender.bidSubmissionDate) || dateOnly(tender.biddeadline),
    bid_submission_date: dateOnly(tender.bidSubmissionDate) || dateOnly(tender.biddeadline), prebid_meeting_date: dateOnly(tender.prebidMeetingDate) || dateOnly(tender.prebidmeetingdate), completion_of_work: firstText(tender.completionOfWork, tender.completionofwork),
    source_url: firstText(tender.sourceUrl, tender.sourceurl, tender.url), zip_document_download_source: text(tender.zipdocumentdownload), scraped_date: scrapedDate,
    raw_metadata: tender, last_synced_at: new Date().toISOString(),
  };
}

export function mapTender(tender: Json, scrapedDate: string): Json | null {
  const sourceTenderId = tenderId(tender);
  if (!sourceTenderId) return null;
  const location = locationParts(tender);
  const title = firstText(tender.title, tender.name, tender.tenderTitle, tender.tendername, tender.tenderdescription, tender.tenderdetails) || "";
  return {
    source_portal: "TENDER247",
    tender247_api_sync: true,
    source_region: text(tender.region)?.toUpperCase() || "INDIAN",
    source_tender_id: sourceTenderId,
    scraped_date: scrapedDate,
    title,
    organization: firstText(tender.organization, tender.organisation, tender.buyer, tender.authority),
    department: firstText(tender.department, tender.departmentName),
    authority: text(tender.authority),
    category: text(tender.category),
    tender_type: firstText(tender.tenderType, tender.tendertype, tender.type),
    description: firstText(tender.description, tender.tenderdescription, tender.tenderdetails),
    city: location.city,
    state: location.state,
    location_text: location.locationText,
    published_date: dateOnly(tender.publishedDate) || dateOnly(tender.publishDate) || dateOnly(tender.datecreated),
    opening_date: dateOnly(tender.openingDate),
    closing_date: dateOnly(tender.closingDate) || dateOnly(tender.bidSubmissionDate) || dateOnly(tender.biddeadline),
    bid_submission_date: dateOnly(tender.bidSubmissionDate) || dateOnly(tender.biddeadline),
    tender_value: numberOrNull(tender.tenderValue) ?? numberOrNull(tender.estimatedValue) ?? numberOrNull(tender.value),
    tender_value_text: firstText(tender.tenderValueText, tender.valuetext),
    emd_amount: numberOrNull(tender.emdAmount) ?? numberOrNull(tender.emd),
    emd_text: firstText(tender.emdText, tender.emdtext),
    currency: text(tender.currency) || "INR",
    source_url: firstText(tender.sourceUrl, tender.sourceurl, tender.url),
    download_status: "DISCOVERED",
    // On updates this is merged by sourceControlledPatch, never replaced.
    raw_metadata: {
      tender247_sync: tender,
      // Keep Tender247's separate sourceTenderId reference without making it
      // the canonical identity of this tender row.
      tender247_source_tender_id: text(tender.sourceTenderId) || text(tender.sourcetenderid),
    },
    metadata_version: 1,
    // The API does not perform qualification. Newly discovered tenders must
    // enter the explicit verification queue; updates preserve human/AI state.
    qualification_status: "VERIFY",
    content_hash: createHash("sha256").update(JSON.stringify(tender)).digest("hex"),
    last_seen_at: new Date().toISOString(),
    supabase_synced_at: new Date().toISOString(),
  };
}

export function tender247CanonicalIdentity(tender: Json): Tender247CanonicalIdentity | null {
  const sourceTenderId = tenderId(tender);
  if (!sourceTenderId) return null;
  return {
    sourcePortal: "TENDER247",
    sourceRegion: text(tender.region)?.toUpperCase() || "INDIAN",
    // Stable Tender247 tenderid is the canonical existing source_tender_id.
    sourceTenderId,
  };
}

/**
 * Only these values are owned by Tender247. In particular, this list excludes
 * qualification_status, decision/prescreen fields, manual notes, and every
 * user/workspace/checklist/submission relation.
 */
const SOURCE_CONTROLLED_UPDATE_COLUMNS = [
  "title", "organization", "department", "authority", "category",
  "tender_type", "description", "city", "state", "location_text",
  "published_date", "opening_date", "closing_date", "bid_submission_date",
  "tender_value", "tender_value_text", "emd_amount", "emd_text", "currency",
  "source_url", "download_status", "raw_metadata", "content_hash",
  "tender247_api_sync", "scraped_date", "last_seen_at", "supabase_synced_at",
] as const;

function sourceControlledPatch(payload: Json, existingRawMetadata: unknown): Json {
  const patch: Json = {};
  for (const column of SOURCE_CONTROLLED_UPDATE_COLUMNS) patch[column] = payload[column];
  // Manual notes and other workflow annotations live in raw_metadata in this
  // application. Retain them and refresh only the upstream-owned namespace.
  patch.raw_metadata = { ...record(existingRawMetadata), ...record(payload.raw_metadata) };
  return patch;
}

const TENDER247_DOCUMENT_CONCURRENCY = 2;
const TENDER247_EDGE_FUNCTION = "tender-automation-company-documents";
const TRANSIENT_REQUEST_ATTEMPTS = 3;

function isTransientStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120_000, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(120_000, Math.max(0, date - Date.now())) : null;
}

function isGatewayRequest(input: RequestInfo | URL): boolean {
  return String(input).includes("/api/tender247/");
}

async function retryFetch(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  // The Azure gateway owns retries for Tender247 itself. Retrying gateway
  // calls here multiplies each upstream request and caused the 10/12 storm.
  // Edge/Graph calls retain their small independent retry budget.
  const attempts = isGatewayRequest(input) ? 1 : TRANSIENT_REQUEST_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await tender247Fetch(fetchImpl, input, init);
      if (!isTransientStatus(response.status) || attempt === attempts - 1) return response;
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response) ?? Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 300)));
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 300)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Tender247 request failed");
}

/** Bound each gateway/Edge request so recovery cannot wait indefinitely. */
async function tender247Fetch(fetchImpl: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Tender247 request timed out after ${TENDER247_NETWORK_TIMEOUT_MS}ms`)), TENDER247_NETWORK_TIMEOUT_MS);
  const upstream = init?.signal;
  const abort = () => controller.abort(upstream?.reason);
  upstream?.addEventListener("abort", abort, { once: true });
  try { return await fetchImpl(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); upstream?.removeEventListener("abort", abort); }
}

type Tender247EdgeResponse = Json & { status?: string; documentId?: string; sessionId?: string; chunkSize?: number; expectedBytes?: number; nextExpectedByte?: number; document?: Json; stagedMetadata?: Json | null };
export type Tender247ManifestDocument = { documentid: string; filename: string; contentType: string; token: string; size: number | null };

export function parseTender247ManifestToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.hostname !== "partnersdataapi.tender247.com" || url.search || url.hash) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 4 || parts.slice(0, 3).join("/") !== "T247Data/api/partner-document-download-links") return null;
    return /^[A-Za-z0-9_-]{8,512}$/.test(parts[3]) ? parts[3] : null;
  } catch { return null; }
}

function gatewayConfiguration() {
  const endpoint = process.env.TENDER247_SYNC_ENDPOINT?.trim();
  const token = process.env.TENDER247_SYNC_UPSTREAM_SECRET?.trim();
  if (!endpoint || !token) throw new Error("TENDER247_SYNC_ENDPOINT and TENDER247_SYNC_UPSTREAM_SECRET must be configured");
  const url = new URL(endpoint);
  if (url.pathname !== "/api/tender247/tenders" || url.search || url.hash) throw new Error("TENDER247_SYNC_ENDPOINT must be the Azure gateway tender route");
  return { base: url.origin, token };
}

export async function tender247Manifest(tender: Json, fetchImpl: typeof fetch): Promise<Tender247ManifestDocument[]> {
  const manifestToken = parseTender247ManifestToken(tender.zipdocumentdownload);
  if (!manifestToken) return [];
  const gateway = gatewayConfiguration();
  const response = await retryFetch(fetchImpl, `${gateway.base}/api/tender247/document-links/${manifestToken}`, { headers: { Authorization: `Bearer ${gateway.token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Tender247 manifest gateway failed (HTTP ${response.status})`);
  const envelope = record(await response.json().catch(() => ({})));
  const data = envelope.data;
  const reportedCount = Number(envelope.count);
  if (!Array.isArray(data)) {
    if (Number.isSafeInteger(reportedCount) && reportedCount > 0) throw new Error(`MANIFEST_NORMALIZATION_FAILED reportedCount=${reportedCount} normalizedCount=0`);
    throw new Error("Tender247 manifest gateway returned an invalid manifest");
  }
  const normalized = data.map(record).flatMap((entry) => {
    const documentid = text(entry.documentid) || text(entry.documentId) || text(entry.id);
    const filename = text(entry.filename) || text(entry.fileName) || text(entry.name);
    const token = text(entry.token) || text(entry.downloadToken) || text(entry.link);
    const rawSize = entry.size ?? entry.fileSize ?? entry.filesize;
    const size = rawSize == null ? null : Number(rawSize);
    if (!documentid || !filename || !token || !/^[A-Za-z0-9_-]{8,512}$/.test(token) || (size !== null && (!Number.isSafeInteger(size) || size <= 0))) return [];
    return [{ documentid, filename, contentType: text(entry.contentType) || text(entry.content_type) || text(entry.type) || "application/octet-stream", token, size }];
  });
  if (reportedCount > 0 && normalized.length === 0) throw new Error(`MANIFEST_NORMALIZATION_FAILED reportedCount=${reportedCount} normalizedCount=0`);
  return normalized;
}

function tender247EdgeConfiguration() {
  const base = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) throw new Error("Tender247 document worker is not configured (missing Supabase service credentials)");
  return { url: `${base}/functions/v1/${TENDER247_EDGE_FUNCTION}`, key };
}

async function edgeJson(
  url: string,
  key: string,
  action: string,
  body: Json,
  fetchImpl: typeof fetch,
  onProgress?: (message: string) => void,
): Promise<Tender247EdgeResponse> {
  const correlation = {
    canonicalDocumentId: text(body.existingCanonicalDocumentId) || text(body.documentId),
    canonicalTenderId: text(body.tenderId),
    externalDocumentId: text(body.externalDocumentId),
  };
  onProgress?.(`Edge-function request starting: ${action}`);
  const response = await retryFetch(fetchImpl, url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  onProgress?.(`Edge-function response received: ${action} HTTP ${response.status}`);
  // Read once so a non-2xx response can be diagnosed without leaving its body
  // open. This response contains no request credentials; still cap the log.
  const responseText = await response.text();
  let parsed: unknown = {};
  try { parsed = responseText ? JSON.parse(responseText) : {}; } catch { parsed = {}; }
  const payload = record(parsed) as Tender247EdgeResponse;
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id") || response.headers.get("x-sb-request-id") || response.headers.get("x-supabase-request-id") || null;
    const traceId = response.headers.get("traceparent") || response.headers.get("x-trace-id") || response.headers.get("cf-ray") || null;
    onProgress?.(`Edge-function non-2xx: ${JSON.stringify({ action, httpStatus: response.status, responseBody: responseText.slice(0, 4096), parsedResponse: parsed, requestId, traceId, ...correlation })}`);
    throw new Error(text(payload.error) || `Tender247 document action failed (HTTP ${response.status})`);
  }
  return payload;
}

/**
 * Runs the service-only create/chunk/finalize protocol. Chunks are bounded by
 * the Edge-provided size: a document is never reassembled during upload.
 */
export type Tender247UploadedDocument = { canonicalDocumentId: string; storageUrl: string; sharepointDriveItemId: string | null; filename: string; mimeType: string; fileSize: number | null; completedAt: string | null; alreadyStored: boolean };

type Tender247StageMetadata = { staged_id: string; staged_size: number; staged_filename: string; staged_content_type: string; staged_expires_at: string };
function stageIdentityKey(tenderId: string, externalDocumentId: string) { return createHash("sha256").update(`${tenderId}:${externalDocumentId}`).digest("hex"); }
function stageMetadata(value: unknown): Tender247StageMetadata | null {
  const stage = record(value); const size = Number(stage.staged_size); const expiresAt = text(stage.staged_expires_at);
  return text(stage.staged_id) && Number.isSafeInteger(size) && size > 0 && text(stage.staged_filename) && text(stage.staged_content_type) && expiresAt && Number.isFinite(Date.parse(expiresAt))
    ? { staged_id: text(stage.staged_id)!, staged_size: size, staged_filename: text(stage.staged_filename)!, staged_content_type: text(stage.staged_content_type)!, staged_expires_at: expiresAt }
    : null;
}

function responseSize(response: Response, payload?: Json): number | null {
  const values = [payload?.size, payload?.fileSize, payload?.filesize, payload?.contentLength, response.headers.get("content-length")];
  for (const value of values) { const size = Number(value); if (Number.isSafeInteger(size) && size > 0) return size; }
  const range = response.headers.get("content-range") || (typeof payload?.contentRange === "string" ? payload.contentRange : "");
  const total = /\/\s*(\d+)\s*$/i.exec(range || "")?.[1]; const size = Number(total);
  return Number.isSafeInteger(size) && size > 0 ? size : null;
}

function safeHttpDiagnostic(response: Response, body: string) {
  return {
    httpStatus: response.status, responseBody: body.slice(0, 4096),
    requestId: response.headers.get("x-request-id") || response.headers.get("x-sb-request-id") || response.headers.get("x-supabase-request-id") || null,
    traceId: response.headers.get("traceparent") || response.headers.get("x-trace-id") || response.headers.get("cf-ray") || null,
  };
}

export async function uploadTender247Document(options: {
  tenderId: string;
  /** Pipeline callers must provide the persisted saved-run date. */
  scrapedDate?: string;
  document: Tender247ManifestDocument;
  fetchImpl?: typeof fetch;
  onAlreadyStored?: () => void;
  onDownloaded?: () => void;
  onDownloadStarting?: () => void;
  onSharePointUploadStarting?: () => void;
  /** Bounded recovery only: Edge must reuse precisely this existing row. */
  existingCanonicalDocumentId?: string;
  onSourceDetailRequested?: () => void;
  onProgress?: (message: string) => void;
  onCanonicalUpdateStarting?: () => void;
}): Promise<Tender247UploadedDocument> {
  const { tenderId, document, fetchImpl = fetch } = options;
  // Compatibility for direct unit callers only; the sync pipeline always
  // provides its persisted scrapedDate and never derives this from runtime.
  const scrapedDate = options.scrapedDate || "1970-01-01";
  const { url, key } = tender247EdgeConfiguration();
  const storedResult = (created: Tender247EdgeResponse): Tender247UploadedDocument => {
    const canonical = record(created.document); const storageUrl = text(canonical.storage_url);
    const sharepointDriveItemId = text(canonical.sharepoint_drive_item_id);
    if (!storageUrl || !sharepointDriveItemId) throw new Error("Stored Tender247 document has incomplete SharePoint metadata");
    options.onAlreadyStored?.();
    return { canonicalDocumentId: String(canonical.id || created.documentId || ""), storageUrl, sharepointDriveItemId, filename: text(canonical.file_name) || document.filename, mimeType: text(canonical.mime_type) || document.contentType, fileSize: numberOrNull(canonical.file_size_bytes), completedAt: text(canonical.completed_at), alreadyStored: true };
  };
  let expectedSize = document.size;
  let stagedId: string | null = null;
  const identityKey = stageIdentityKey(tenderId, document.documentid);
  let gateway: ReturnType<typeof gatewayConfiguration> | null = null;
  const getGateway = () => gateway ||= gatewayConfiguration();
  const gatewayHeaders = () => ({ Authorization: `Bearer ${getGateway().token}`, "x-tender247-stage-identity": identityKey });
  let precreated: Tender247EdgeResponse | null = null;
  if (expectedSize === null) {
    // The Edge Function can answer ALREADY_STORED by canonical identity before
    // bytes are requested. Otherwise it explicitly asks us to resolve size.
    options.onProgress?.("upload-session creation starting");
    const identity = await edgeJson(url, key, "createTender247UploadSession", {
      tenderId, scrapedDate, externalDocumentId: document.documentid, filename: document.filename, mimeType: document.contentType, existingCanonicalDocumentId: options.existingCanonicalDocumentId,
    }, fetchImpl, options.onProgress);
    options.onProgress?.("upload-session creation completed");
    if (identity.status === "ALREADY_STORED") return storedResult(identity);
    if (identity.status !== "NEEDS_SIZE") throw new Error("Tender247 Edge Function returned an invalid size-resolution response");
    precreated = identity;
    const persistedStage = stageMetadata(identity.stagedMetadata);
    if (persistedStage && new Date(persistedStage.staged_expires_at).getTime() > Date.now()) {
      options.onProgress?.("staged-document lookup starting");
      const checked = await tender247Fetch(fetchImpl, `${getGateway().base}/api/tender247/staged-document/${persistedStage.staged_id}/info`, { headers: gatewayHeaders(), cache: "no-store" });
      options.onProgress?.(`staged-document lookup completed: HTTP ${checked.status}`);
      const actual = record(await checked.json().catch(() => ({})));
      if (checked.ok && Number(actual.size) === persistedStage.staged_size && text(actual.filename) === persistedStage.staged_filename && text(actual.contentType) === persistedStage.staged_content_type && text(actual.expiresAt) === persistedStage.staged_expires_at) {
        expectedSize = persistedStage.staged_size; stagedId = persistedStage.staged_id;
      }
    }
    if (!stagedId) {
      options.onSourceDetailRequested?.();
      options.onProgress?.("staged-document lookup starting");
      const prepared = await tender247Fetch(fetchImpl, `${getGateway().base}/api/tender247/document-info/${document.token}`, { headers: gatewayHeaders(), cache: "no-store" });
      options.onProgress?.(`staged-document lookup completed: HTTP ${prepared.status}`);
      const infoText = await prepared.text(); let info: Json = {}; try { info = record(infoText ? JSON.parse(infoText) : {}); } catch { /* reported below */ }
      expectedSize = responseSize(prepared, info); stagedId = text(info.stagedId);
      if (!prepared.ok) throw new Error(`DOCUMENT_SIZE_UNKNOWN detail=${JSON.stringify({ ...safeHttpDiagnostic(prepared, infoText), tenderId, canonicalDocumentId: options.existingCanonicalDocumentId || null, externalDocumentId: document.documentid })}`);
      if (!expectedSize) {
        options.onProgress?.("size probe starting");
        const probe = await retryFetch(fetchImpl, `${getGateway().base}/api/tender247/document/${document.token}`, { headers: { Authorization: `Bearer ${getGateway().token}`, Range: "bytes=0-0" }, cache: "no-store" });
        const probeText = await probe.text(); expectedSize = responseSize(probe);
        options.onProgress?.(`size probe completed: HTTP ${probe.status}`);
        if (!probe.ok || !expectedSize) throw new Error(`DOCUMENT_SIZE_UNKNOWN detail=${JSON.stringify({ detail: safeHttpDiagnostic(prepared, infoText), probe: safeHttpDiagnostic(probe, probeText), tenderId, canonicalDocumentId: options.existingCanonicalDocumentId || null, externalDocumentId: document.documentid })}`);
      }
      precreated = null;
      options.onProgress?.("upload-session creation starting");
      precreated = await edgeJson(url, key, "createTender247UploadSession", { tenderId, scrapedDate, externalDocumentId: document.documentid, filename: document.filename, mimeType: document.contentType, expectedBytes: expectedSize, existingCanonicalDocumentId: options.existingCanonicalDocumentId, ...(stagedId ? { stagedMetadata: { staged_id: stagedId, staged_size: expectedSize, staged_filename: text(info.filename) || document.filename, staged_content_type: text(info.contentType) || document.contentType, staged_expires_at: text(info.expiresAt) } } : {}) }, fetchImpl, options.onProgress);
      options.onProgress?.("upload-session creation completed");
    }
  }
  if (!precreated) options.onProgress?.("upload-session creation starting");
  const created = precreated || await edgeJson(url, key, "createTender247UploadSession", {
    tenderId, scrapedDate, externalDocumentId: document.documentid, filename: document.filename, mimeType: document.contentType, expectedBytes: Number(expectedSize), existingCanonicalDocumentId: options.existingCanonicalDocumentId,
  }, fetchImpl, options.onProgress);
  if (!precreated) options.onProgress?.("upload-session creation completed");
  if (created.status === "ALREADY_STORED") {
    return storedResult(created);
  }
  if (created.status !== "UPLOAD_REQUIRED" || !created.documentId || !created.sessionId) {
    throw new Error("Tender247 Edge Function returned an invalid upload session");
  }
  const totalSize = Number(expectedSize);
  if (!Number.isSafeInteger(totalSize) || totalSize <= 0) throw new Error("DOCUMENT_SIZE_UNKNOWN");
  const chunkSize = Number(created.chunkSize);
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error("Tender247 Edge Function returned an invalid chunk size");
  // New deployments may return the safe persisted offset. Older deployed
  // versions start at zero, which remains idempotent for a fresh session.
  let offset = Number.isSafeInteger(created.nextExpectedByte) ? Number(created.nextExpectedByte) : 0;
  if (offset < 0 || offset > totalSize) throw new Error("Tender247 Edge Function returned an invalid resume offset");
  const openSource = async (startByte: number) => {
    const endpoint = stagedId
      ? `${getGateway().base}/api/tender247/staged-document/${stagedId}`
      : `${getGateway().base}/api/tender247/document/${document.token}`;
    const headers = stagedId
      ? { ...gatewayHeaders(), ...(startByte ? { Range: `bytes=${startByte}-` } : {}) }
      : { Authorization: `Bearer ${getGateway().token}`, ...(startByte ? { Range: `bytes=${startByte}-` } : {}) };
    options.onProgress?.(`download source request starting${startByte ? ` at byte ${startByte}` : ""}`);
    const response = await retryFetch(fetchImpl, endpoint, { headers, cache: "no-store" });
    options.onProgress?.(`download source response received: HTTP ${response.status}`);
    if (!response.ok || !response.body) throw new Error(`Tender247 ${stagedId ? "staged " : ""}document gateway failed (HTTP ${response.status})`);
    return response;
  };
  options.onDownloadStarting?.();
  let source = await openSource(offset);
  let sourceOffset = source.status === 206 ? offset : 0;
  let sourceRemaining: number | null = Number(source.headers.get("content-length"));
  if (!Number.isSafeInteger(sourceRemaining) || sourceRemaining <= 0) sourceRemaining = null;
  let reader = source.body!.getReader();
  let pending = new Uint8Array(0);
  let eof = false;
  let lastRestartOffset = -1;
  let sharePointUploadStarted = false;
  while (offset < totalSize) {
    if (!eof && pending.byteLength < chunkSize) {
      const read = await reader.read();
      eof = Boolean(read.done);
      if (read.value?.byteLength) {
        if (sourceRemaining !== null) {
          sourceRemaining -= read.value.byteLength;
          if (sourceRemaining < 0) throw new Error("Tender247 source exceeded its Content-Length");
        }
        const joined = new Uint8Array(pending.byteLength + read.value.byteLength);
        joined.set(pending); joined.set(read.value, pending.byteLength); pending = joined;
      }
      if (sourceRemaining === 0) { eof = true; await reader.cancel().catch(() => undefined); }
      if (!eof) continue;
    }
    if (sourceOffset < offset) {
      const discard = Math.min(offset - sourceOffset, pending.byteLength);
      pending = pending.subarray(discard); sourceOffset += discard;
      continue;
    }
    const length = Math.min(chunkSize, pending.byteLength, totalSize - offset);
    if (!length) {
      // Tender247's gateway commonly closes a response at 5 MB. Resume from
      // the byte already committed to SharePoint rather than treating that
      // bounded response as a truncated document.
      if (lastRestartOffset === offset) break;
      lastRestartOffset = offset;
      await reader.cancel().catch(() => undefined);
      source = await openSource(offset);
      sourceOffset = source.status === 206 ? offset : 0;
      sourceRemaining = Number(source.headers.get("content-length"));
      if (!Number.isSafeInteger(sourceRemaining) || sourceRemaining <= 0) sourceRemaining = null;
      reader = source.body!.getReader();
      eof = false;
      continue;
    }
    const offsetBefore = offset;
    const chunk = pending.slice(0, length); pending = pending.subarray(length);
    sourceOffset += length;
    const endExclusive = offsetBefore + length;
    if (!sharePointUploadStarted) { sharePointUploadStarted = true; options.onSharePointUploadStarting?.(); }
    options.onProgress?.(`chunk upload starting: bytes ${offset}-${endExclusive - 1}/${totalSize}`);
    const response = await tender247Fetch(fetchImpl, url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/octet-stream",
        "x-upload-action": "tender247-upload-chunk", "x-tender247-session-id": created.sessionId,
        "x-tender247-document-id": created.documentId, "x-tender247-start-byte": String(offsetBefore),
        "x-tender247-end-byte": String(endExclusive - 1), "x-tender247-total-bytes": String(totalSize),
      },
      // Buffer.subarray is the current bounded chunk only, never the document.
      body: chunk,
    });
    const responseText = await response.text(); let parsed: unknown = {}; try { parsed = responseText ? JSON.parse(responseText) : {}; } catch { /* diagnostic below */ }
    const chunkResult = record(parsed) as Tender247EdgeResponse;
    options.onProgress?.(`chunk upload completed: HTTP ${response.status}`);
    if (!response.ok) {
      options.onProgress?.(`chunk upload non-2xx: ${JSON.stringify({ operation: "edge-tender247-upload-chunk", ...safeHttpDiagnostic(response, responseText), tenderId, canonicalDocumentId: created.documentId, externalDocumentId: document.documentid, byteRange: `${offsetBefore}-${endExclusive - 1}`, currentOffset: offsetBefore, totalSize })}`);
      throw new Error(text(chunkResult.error) || `Tender247 chunk upload failed (HTTP ${response.status})`);
    }
    const offsetAfter = chunkResult.status === "CONTINUE" && Number.isSafeInteger(chunkResult.nextExpectedByte)
      ? Number(chunkResult.nextExpectedByte) : endExclusive;
    if (offsetAfter !== endExclusive) throw new Error(`Tender247 upload session advanced unexpectedly (${offsetBefore}->${offsetAfter}; uploaded=${length})`);
    offset = offsetAfter;
    const remaining = totalSize - offset;
    options.onProgress?.(`chunk progress: offset before=${offsetBefore}; bytes uploaded=${length}; offset after=${offset}; remaining=${remaining}`);
    if (remaining) options.onProgress?.(`next chunk: bytes ${offset}-${Math.min(offset + chunkSize, totalSize) - 1}/${totalSize}`);
  }
  if (offset !== totalSize) throw new Error(`Tender247 document stream ended before the expected byte size (${offset}/${totalSize})`);
  options.onDownloaded?.(); // Increment only after Azure response reaches EOF.
  options.onProgress?.("finalize starting");
  options.onCanonicalUpdateStarting?.();
  const finalized = await edgeJson(url, key, "finalizeTender247Upload", {
    tenderId, documentId: created.documentId, externalDocumentId: document.documentid, sessionId: created.sessionId,
  }, fetchImpl, options.onProgress);
  options.onProgress?.("finalize completed");
  const canonical = record(finalized.document); const storageUrl = text(canonical.storage_url); const sharepointDriveItemId = text(canonical.sharepoint_drive_item_id);
  if (finalized.status !== "COMPLETED" || !storageUrl || !sharepointDriveItemId) throw new Error("Tender247 upload finalization did not return complete SharePoint metadata");
  if (stagedId) await tender247Fetch(fetchImpl, `${getGateway().base}/api/tender247/staged-document/${stagedId}`, { method: "DELETE", headers: gatewayHeaders(), cache: "no-store" });
  return { canonicalDocumentId: String(canonical.id || created.documentId), storageUrl, sharepointDriveItemId, filename: text(canonical.file_name) || document.filename, mimeType: text(canonical.mime_type) || document.contentType, fileSize: numberOrNull(canonical.file_size_bytes) || totalSize, completedAt: text(canonical.completed_at), alreadyStored: false };
}

async function withDocumentConcurrency<T>(items: T[], worker: (item: T) => Promise<void>) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(TENDER247_DOCUMENT_CONCURRENCY, items.length) }, run));
}

async function upsertMirrorTender(db: SupabaseClient, payload: Json): Promise<{ id: string; inserted: boolean }> {
  const existing = await db.from(TENDER247_TENDER_MIRROR_TABLE).select("id")
    .eq("source_region", payload.source_region).eq("tender247_tender_id", payload.tender247_tender_id).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const updated = await db.from(TENDER247_TENDER_MIRROR_TABLE).update(payload).eq("id", existing.data.id).select("id").single();
    if (updated.error || !updated.data) throw new Error(updated.error?.message || "Could not update Tender247 mirror tender");
    return { id: String(updated.data.id), inserted: false };
  }
  const inserted = await db.from(TENDER247_TENDER_MIRROR_TABLE).insert(payload).select("id").single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not insert Tender247 mirror tender");
  return { id: String(inserted.data.id), inserted: true };
}

async function upsertMirrorDocument(db: SupabaseClient, tender247TenderRowId: string, canonicalTenderId: string, externalDocumentId: string, uploaded: Tender247UploadedDocument): Promise<boolean> {
  const payload = {
    tender247_tender_row_id: tender247TenderRowId, canonical_tender_id: canonicalTenderId,
    canonical_document_id: uploaded.canonicalDocumentId || null, external_document_id: externalDocumentId,
    filename: uploaded.filename, mime_type: uploaded.mimeType, file_size: uploaded.fileSize,
    storage_status: "COMPLETED", storage_url: uploaded.storageUrl,
    sharepoint_drive_item_id: uploaded.sharepointDriveItemId, completed_at: uploaded.completedAt,
  };
  const existing = await db.from(TENDER247_DOCUMENT_MIRROR_TABLE).select("id")
    .eq("tender247_tender_row_id", tender247TenderRowId).eq("external_document_id", externalDocumentId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    const updated = await db.from(TENDER247_DOCUMENT_MIRROR_TABLE).update(payload).eq("id", existing.data.id).select("id").single();
    if (updated.error || !updated.data) throw new Error(updated.error?.message || "Could not update Tender247 mirror document");
    return false;
  }
  const inserted = await db.from(TENDER247_DOCUMENT_MIRROR_TABLE).insert(payload).select("id").single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not insert Tender247 mirror document");
  return true;
}

/**
 * The database function locks both rows, moves every dependent FK only when
 * the loser is API-only, then removes that duplicate atomically. A missing
 * migration/function is deliberately treated as unresolved: never guess a
 * canonical UUID from application code.
 */
async function reconcileStableLegacyConflict(
  canonicalSupabase: SupabaseClient,
  legacyId: string,
  stableId: string,
  stableSourceTenderId: string,
): Promise<{ survivor: Json | null; reason: string | null }> {
  // Keep this guard for degraded/migration-mismatch environments. Production
  // clients always expose rpc; tests also use it to model an unavailable RPC.
  if (typeof canonicalSupabase.rpc !== "function") {
    return { survivor: null, reason: "Reconciliation database function is unavailable" };
  }
  // Keep the canonical Supabase client as the receiver. `rpc` reads client
  // internals (including `rest`), so extracting it into a standalone function
  // crashes. This RPC intentionally does not exist on the mirror project.
  const { data, error } = await canonicalSupabase.rpc("reconcile_tender247_identity_conflict", {
    p_legacy_id: legacyId, p_stable_id: stableId, p_stable_source_tender_id: stableSourceTenderId,
  });
  if (error || data?.status !== "RECONCILED" || !data.survivor_id) return { survivor: null, reason: data?.reason || error?.message || "Identity reconciliation requires manual review" };
  const result = await canonicalSupabase.from(TENDER_TARGET_TABLE).select("id, raw_metadata, document_urls").eq("id", data.survivor_id).maybeSingle();
  if (result.error || !result.data) return { survivor: null, reason: result.error?.message || "Reconciled canonical row could not be reloaded" };
  return { survivor: result.data as Json, reason: null };
}

export function indiaYesterdayIsoDate(now = new Date()): string {
  // Tender247's feed date is a calendar date in India. It is deliberately not
  // a business-day calculation: Saturday/Sunday runs must request Friday and
  // Saturday respectively, rather than skipping either date.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (kind: string) => Number(parts.find((part) => part.type === kind)?.value);
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function requestTender247Once(scrapedDate: string): Promise<Json> {
  const mode = tender247SyncMode();
  const endpoint = process.env.TENDER247_SYNC_ENDPOINT?.trim();
  const token = process.env.TENDER247_SYNC_UPSTREAM_SECRET?.trim();
  if (!endpoint || !token) throw new Error("TENDER247_SYNC_ENDPOINT and TENDER247_SYNC_UPSTREAM_SECRET must be configured");
  const url = new URL(endpoint);
  if (url.search || url.hash) throw new Error("TENDER247_SYNC_ENDPOINT must not contain query parameters or a fragment");
  // Exactly one request using the already-observed feed contract. `scrapedDate`
  // is stored as a processing-date label only; it is intentionally not sent
  // upstream. Without documented filters/pagination this run is unverified
  // for source-date and source-completeness, but is still recoverable.
  const response = await tender247Fetch(fetch, url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Tender247 upstream HTTP ${response.status}`);
  const payload = record(await response.json());
  return { ...payload, tender247_sync_mode: mode, tender247_source_completeness: "UNVERIFIED", tender247_processing_date: scrapedDate };
}

/** An upstream logical failure is auditable but must never mutate tenders. */
export function upstreamResponseCanBeProcessed(response: Json): boolean {
  // A documented Data/data array is a usable response even when optional
  // success flags are absent. Explicit failures and rate-limit envelopes never
  // mutate state. This also permits a valid empty feed response.
  return response.success !== false && response.Success !== false &&
    response.limitExceeded !== true && response.limit_exceeded !== true &&
    [response.Data, response.data, response.tenders, record(response.data).tenders, response.items].some(Array.isArray);
}

export async function processSavedTender247Response(response: Json, scrapedDate: string, options?: { onProgress?: (message: string) => void }): Promise<{ status: SyncStatus; summary: Tender247SyncSummary }> {
  const summary: Tender247SyncSummary = {
    scrapedDate, sourceCompleteness: "UNVERIFIED", tenderCount: 0, tendersUpserted: 0, tenderFailures: 0, documentsUploaded: 0, documentFailures: 0, errors: [],
    canonical: { inserted: 0, updated: 0, repaired: 0, failed: 0, identityConflicts: 0 },
    mirror: { tendersInserted: 0, tendersUpdated: 0, tendersFailed: 0, documentsInserted: 0, documentsUpdated: 0, documentsFailed: 0 },
    documents: { tendersWithDocuments: 0, manifestsRequested: 0, manifestsFailed: 0, documentsDiscovered: 0, attempted: 0, alreadyStored: 0, downloaded: 0, sharepointUploaded: 0, failed: 0 },
  };
  // This guard protects saved-response resume callers as well as the route:
  // failed/limited Tender247 responses must never mutate either database.
  if (!upstreamResponseCanBeProcessed(response)) {
    summary.errors.push("Tender247 response was unsuccessful or rate-limited; no tenders were processed.");
    return { status: "FAILED", summary };
  }
  const db = createAdminSupabaseClient();
  options?.onProgress?.(`source records count=${responseTenders(response).length}`);
  // The project database remains canonical. Only Tender247 integration rows
  // are sent to this separately configured mirror database.
  let mirrorDb: SupabaseClient | null = null;
  for (const tender of responseTenders(response)) {
    summary.tenderCount += 1;
    options?.onProgress?.(`tender ${summary.tenderCount} mapping starting`);
    const payload = mapTender(tender, scrapedDate);
    if (!payload) { summary.tenderFailures += 1; summary.canonical.failed += 1; summary.errors.push("Tender missing Tender247 tenderid"); continue; }
    const identity = db.from(TENDER_TARGET_TABLE)
      .select("id, raw_metadata, document_urls")
      .eq("source_portal", "TENDER247")
      .eq("source_region", payload.source_region)
      .eq("source_tender_id", payload.source_tender_id)
      .order("scraped_date", { ascending: false })
      .limit(1);
    const { data: stableExisting, error: existingError } = await identity.maybeSingle();
    let existing: Json | null = stableExisting as Json | null;
    if (existingError) { summary.tenderFailures += 1; summary.canonical.failed += 1; summary.errors.push(existingError.message); continue; }
    // A previous buggy sync used sourcetenderid as source_tender_id. Repair
    // only a row whose retained upstream payload proves it belongs to this
    // stable Tender247 tender; never delete or repurpose ambiguous rows.
    let repaired = false;
    let canonicalExisting: Json | null = existing;
    const legacySourceId = text(tender.sourcetenderid) || text(tender.sourceTenderId);
    if (legacySourceId) {
      const { data: candidates, error: candidateError } = await db.from(TENDER_TARGET_TABLE)
        .select("id, raw_metadata, document_urls").eq("source_portal", "TENDER247")
        .eq("source_region", payload.source_region).eq("source_tender_id", legacySourceId).limit(2);
      if (candidateError) { summary.tenderFailures += 1; summary.canonical.failed += 1; summary.errors.push(candidateError.message); continue; }
      const proven = (candidates || []).filter((candidate) => tenderId(record(record(record(candidate as Json).raw_metadata).tender247_sync)) === payload.source_tender_id);
      if (canonicalExisting && proven.length) {
        const reconciliation = await reconcileStableLegacyConflict(db, String(proven[0].id), String(canonicalExisting.id), String(payload.source_tender_id));
        if (!reconciliation.survivor) {
          summary.canonical.identityConflicts += 1;
          summary.errors.push(`${payload.source_tender_id}: stable and legacy identity rows both exist; ${reconciliation.reason}`);
          continue;
        }
        existing = reconciliation.survivor;
        canonicalExisting = reconciliation.survivor;
        repaired = true;
      }
      if (!canonicalExisting && proven.length === 1) { canonicalExisting = proven[0]; repaired = true; }
      else if (proven.length > 1) { summary.canonical.identityConflicts += 1; summary.errors.push(`${payload.source_tender_id}: multiple legacy identity rows; left unchanged`); }
    }
    const write = existing
      ? db.from(TENDER_TARGET_TABLE).update(sourceControlledPatch(payload, existing.raw_metadata)).eq("id", existing.id).select("id, document_urls").maybeSingle()
      : canonicalExisting
      ? db.from(TENDER_TARGET_TABLE).update({ ...sourceControlledPatch(payload, canonicalExisting.raw_metadata), source_tender_id: payload.source_tender_id }).eq("id", canonicalExisting.id).select("id, document_urls").maybeSingle()
      : db.from(TENDER_TARGET_TABLE).insert(payload).select("id, document_urls").single();
    const { data, error } = await write;
    if (error || !data) { summary.tenderFailures += 1; summary.canonical.failed += 1; summary.errors.push(error?.message || `Could not upsert ${payload.source_tender_id}`); continue; }
    summary.tendersUpserted += 1;
    options?.onProgress?.(`tender ${payload.source_tender_id} canonical upsert completed`);
    if (repaired) summary.canonical.repaired += 1;
    else if (existing) summary.canonical.updated += 1;
    else summary.canonical.inserted += 1;
    let tender247TenderRowId: string | null = null;
    try {
      mirrorDb ||= createTender247MirrorSupabaseClient();
      const mirrorPayload = mirrorTenderPayload(tender, String(data.id), scrapedDate);
      if (!mirrorPayload) throw new Error("Tender missing Tender247 tenderid for mirror");
      const mirror = await upsertMirrorTender(mirrorDb, mirrorPayload);
      tender247TenderRowId = mirror.id;
      if (mirror.inserted) summary.mirror.tendersInserted += 1; else summary.mirror.tendersUpdated += 1;
    } catch (mirrorError) {
      summary.mirror.tendersFailed += 1;
      summary.errors.push(`${payload.source_tender_id}: mirror tender: ${mirrorError instanceof Error ? mirrorError.message : String(mirrorError)}`);
    }
    let manifest: Tender247ManifestDocument[];
    try {
      if (parseTender247ManifestToken(tender.zipdocumentdownload)) summary.documents.manifestsRequested += 1;
      options?.onProgress?.(`tender ${payload.source_tender_id} manifest discovery starting`);
      manifest = await tender247Manifest(tender, fetch);
      options?.onProgress?.(`tender ${payload.source_tender_id} docs discovered=${manifest.length}`);
    } catch (error) {
      summary.documents.manifestsFailed += 1; summary.documents.failed += 1; summary.documentFailures += 1;
      summary.errors.push(`${payload.source_tender_id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    // Provider attachments are opaque binary for SharePoint. The Edge worker
    // performs only its explicit unsafe-type policy; do not silently omit HTML,
    // CSV, XML, or a newly introduced safe Tender247 extension here.
    const uploadableManifest = manifest;
    if (uploadableManifest.length) summary.documents.tendersWithDocuments += 1;
    summary.documents.documentsDiscovered += manifest.length;
    await withDocumentConcurrency(uploadableManifest, async (document) => {
      try {
        let alreadyStored = false; let downloaded = false;
        const uploaded = await uploadTender247Document({
          tenderId: String(data.id), scrapedDate, document,
          onAlreadyStored: () => { alreadyStored = true; },
          onDownloaded: () => { downloaded = true; },
          onDownloadStarting: () => options?.onProgress?.(`document ${document.documentid} download starting`),
          onSharePointUploadStarting: () => options?.onProgress?.(`document ${document.documentid} SharePoint upload starting`),
          onCanonicalUpdateStarting: () => options?.onProgress?.(`document ${document.documentid} canonical finalize starting`),
          onProgress: (message) => options?.onProgress?.(`document ${document.documentid} ${message}`),
        });
        if (alreadyStored) summary.documents.alreadyStored += 1;
        else {
          summary.documents.attempted += 1;
          if (downloaded) summary.documents.downloaded += 1;
          summary.documents.sharepointUploaded += 1; summary.documentsUploaded += 1;
        }
        const urlMerge = await db.rpc("append_tender_document_url", { p_tender_id: String(data.id), p_document_url: uploaded.storageUrl });
        if (urlMerge.error) throw new Error(`document_urls merge failed: ${urlMerge.error.message}`);
        if (tender247TenderRowId) {
          try {
            if (!mirrorDb) throw new Error("Tender247 mirror database is unavailable");
            const inserted = await upsertMirrorDocument(mirrorDb, tender247TenderRowId, String(data.id), document.documentid, uploaded);
            if (inserted) summary.mirror.documentsInserted += 1; else summary.mirror.documentsUpdated += 1;
          } catch (mirrorError) {
            // Canonical completion is durable. A later ALREADY_STORED pass repairs this metadata row without another byte download/upload.
            summary.mirror.documentsFailed += 1;
            summary.errors.push(`${payload.source_tender_id}: mirror document ${document.documentid}: ${mirrorError instanceof Error ? mirrorError.message : String(mirrorError)}`);
          }
        } else {
          summary.mirror.documentsFailed += 1;
        }
      } catch (error) {
        // Count once per discovered document. A source-download/finalize failure
        // never prevents the other at-most-two workers from proceeding.
        summary.documents.attempted += 1; summary.documents.failed += 1; summary.documentFailures += 1;
        summary.errors.push(`${payload.source_tender_id}: ${error instanceof Error ? error.message : String(error)}`);
        options?.onProgress?.(`document ${document.documentid} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
  const status: SyncStatus = summary.canonical.failed || summary.canonical.identityConflicts || summary.mirror.tendersFailed || summary.mirror.documentsFailed || summary.documents.manifestsFailed || summary.documents.failed
    ? "PARTIAL_SUCCESS" : "COMPLETED";
  return { status, summary };
}

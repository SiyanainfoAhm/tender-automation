import type { SupabaseClient } from "@supabase/supabase-js";
import { directDocuments, loadSavedTender247Run } from "@/server/tender247/savedRunResume";
import { parseTender247ManifestToken, responseTenders, tender247Manifest, type Tender247ManifestDocument } from "@/server/tender247/sync";

type Json = Record<string, unknown>;
type Db = SupabaseClient;
export type HistoricalGapClassification = "CONFIRMED_EXISTING" | "PROBABLE_EXISTING" | "CONFIRMED_MISSING" | "AMBIGUOUS" | "SOURCE_ONLY_CHANGED_VERSION" | "CANONICAL_ORPHAN";
export type GapSource = Tender247ManifestDocument & { canonicalTenderId: string | null; tender247TenderId: string | null; manifestToken: string | null; sourceKind: "direct" | "manifest" };
export type GapCanonical = { id: string; tender_id: string; external_document_id: string | null; file_name: string | null; mime_type: string | null; file_size_bytes: number | null; storage_url: string | null; sharepoint_drive_item_id: string | null; tender247TenderId: string | null };
export type GapRow = { canonical_tender_id: string | null; tender247_tender_id: string | null; source_identity: string | null; source_filename: string | null; canonical_document_id: string | null; canonical_external_document_id: string | null; canonical_filename: string | null; source_size: number | null; canonical_size: number | null; source_type: string | null; canonical_type: string | null; match_score: number; match_basis: string; classification: HistoricalGapClassification; reason: string; hash_match: boolean | null; manifest_token: string | null; source_url: string | null; sharepoint_url: string | null; safe_for_auto_recovery: boolean };

export function normalizeHistoricalFilename(value: string | null | undefined) {
  return decodeURIComponent(String(value || "").trim()).replace(/[+_]+/g, " ").replace(/[-]+/g, " ").replace(/\s+/g, " ").replace(/[^a-z0-9. ]/gi, "").trim().toLowerCase();
}

function extension(value: string | null) { const name = String(value || ""); return name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : ""; }
function tenderId(value: Json) { const id = value.tenderid ?? value.tenderId; return typeof id === "number" ? String(id) : typeof id === "string" ? id.trim() : null; }
function record(value: unknown): Json { return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }

/** Conservative per-tender evidence classifier. `absenceProven` is deliberately false for live manifests: changed identity namespaces cannot prove absence. */
export function classifyHistoricalGap(source: Pick<GapSource, "documentid" | "filename" | "size" | "contentType">, canonicals: GapCanonical[], absenceProven = false): GapRow {
  const sameName = canonicals.filter((document) => normalizeHistoricalFilename(document.file_name) === normalizeHistoricalFilename(source.filename));
  const sameNameAndSize = sameName.filter((document) => source.size !== null && document.file_size_bytes !== null && source.size === document.file_size_bytes);
  const exact = sameNameAndSize.length === 1 ? sameNameAndSize[0] : null;
  if (exact) return row(source, exact, "CONFIRMED_EXISTING", 100, "normalized filename + exact size", "Unique metadata match", false);
  if (sameName.length > 1) return row(source, null, "AMBIGUOUS", 40, "normalized filename", "Multiple canonical documents share the filename", false);
  if (sameName.length === 1) {
    const candidate = sameName[0];
    if (source.size !== null && candidate.file_size_bytes !== null && source.size !== candidate.file_size_bytes) return row(source, candidate, "SOURCE_ONLY_CHANGED_VERSION", 60, "normalized filename + different size", "Current source appears to be a changed version", false);
    return row(source, candidate, "PROBABLE_EXISTING", 70, "unique normalized filename", "Filename is unique but size/hash evidence is unavailable", false);
  }
  if (canonicals.some((document) => extension(document.file_name) === extension(source.filename))) {
    return row(source, null, "AMBIGUOUS", 0, "extension only", "Legacy/current identities differ; absence is not proven", false);
  }
  return row(source, null, absenceProven ? "CONFIRMED_MISSING" : "AMBIGUOUS", 0, "no stable historical match", absenceProven ? "Independent historical absence proof supplied" : "No stable evidence proves this source is historically missing", absenceProven);
}

function row(source: Pick<GapSource, "documentid" | "filename" | "size" | "contentType">, canonical: GapCanonical | null, classification: HistoricalGapClassification, match_score: number, match_basis: string, reason: string, safe: boolean): GapRow {
  return { canonical_tender_id: canonical?.tender_id || null, tender247_tender_id: canonical?.tender247TenderId || null, source_identity: source.documentid, source_filename: source.filename, canonical_document_id: canonical?.id || null, canonical_external_document_id: canonical?.external_document_id || null, canonical_filename: canonical?.file_name || null, source_size: source.size, canonical_size: canonical?.file_size_bytes || null, source_type: source.contentType, canonical_type: canonical?.mime_type || null, match_score, match_basis, classification, reason, hash_match: null, manifest_token: null, source_url: null, sharepoint_url: canonical?.storage_url || null, safe_for_auto_recovery: safe };
}

export async function auditTender247HistoricalGap(runId: string, db: Db, options?: { fetchImpl?: typeof fetch; onProgress?: (message: string) => void }) {
  const { run, rawResponse } = await loadSavedTender247Run(db, runId);
  const scrapedDate = String(run.run_date); const fetchImpl = options?.fetchImpl || fetch;
  const tenderRows: Array<{ id: string; source_tender_id: string; raw_metadata: unknown }> = [];
  for (let start = 0; ; start += 1000) {
    const response = await db.from("agenttender_tenders").select("id,source_tender_id,raw_metadata").eq("source_portal", "TENDER247").eq("scraped_date", scrapedDate).order("id").range(start, start + 999);
    if (response.error) throw new Error(response.error.message); tenderRows.push(...response.data || []); if ((response.data || []).length < 1000) break;
  }
  const byTender247Id = new Map<string, string>();
  for (const tender of tenderRows) { byTender247Id.set(String(tender.source_tender_id), tender.id); const metadata = record(tender.raw_metadata); const sync = record(metadata.tender247_sync); const stable = sync.tenderid; if (stable != null) byTender247Id.set(String(stable), tender.id); }
  const canonical: GapCanonical[] = [];
  for (let start = 0; ; start += 1000) {
    const response = await db.from("agenttender_tender_documents").select("id,tender_id,external_document_id,file_name,mime_type,file_size_bytes,storage_url,sharepoint_drive_item_id,agenttender_tenders!inner(scraped_date,source_portal,source_tender_id)").eq("external_source", "TENDER247").eq("agenttender_tenders.scraped_date", scrapedDate).eq("agenttender_tenders.source_portal", "TENDER247").order("id").range(start, start + 999);
    if (response.error) throw new Error(response.error.message);
    for (const value of response.data || []) { const item = value as unknown as Json; const related = item.agenttender_tenders; const joined = Array.isArray(related) ? record(related[0]) : record(related); canonical.push({ id: String(item.id), tender_id: String(item.tender_id), external_document_id: typeof item.external_document_id === "string" ? item.external_document_id : null, file_name: typeof item.file_name === "string" ? item.file_name : null, mime_type: typeof item.mime_type === "string" ? item.mime_type : null, file_size_bytes: typeof item.file_size_bytes === "number" ? item.file_size_bytes : null, storage_url: typeof item.storage_url === "string" ? item.storage_url : null, sharepoint_drive_item_id: typeof item.sharepoint_drive_item_id === "string" ? item.sharepoint_drive_item_id : null, tender247TenderId: String(joined.source_tender_id || "") || null }); }
    if ((response.data || []).length < 1000) break;
  }
  let manifestApiCalls = 0; const reconstructed: GapSource[] = [];
  for (const tender of responseTenders(rawResponse)) {
    const sourceTenderId = tenderId(tender); const canonicalTenderId = sourceTenderId ? byTender247Id.get(sourceTenderId) || null : null;
    for (const document of directDocuments(tender)) reconstructed.push({ ...document, canonicalTenderId, tender247TenderId: sourceTenderId, manifestToken: null, sourceKind: "direct" });
    if (parseTender247ManifestToken(tender.zipdocumentdownload)) { manifestApiCalls += 1; options?.onProgress?.(`manifest ${manifestApiCalls} starting`); const docs = await tender247Manifest(tender, fetchImpl); for (const document of docs) reconstructed.push({ ...document, canonicalTenderId, tender247TenderId: sourceTenderId, manifestToken: parseTender247ManifestToken(tender.zipdocumentdownload), sourceKind: "manifest" }); }
  }
  const unique = new Map<string, GapSource>(); const duplicateKeys = new Set<string>();
  for (const source of reconstructed) { const key = `${source.canonicalTenderId || source.tender247TenderId || "unknown"}|${source.documentid}`; if (unique.has(key)) duplicateKeys.add(key); else unique.set(key, source); }
  const rows: GapRow[] = [];
  for (const source of unique.values()) { const candidates = source.canonicalTenderId ? canonical.filter((document) => document.tender_id === source.canonicalTenderId) : []; const result = classifyHistoricalGap(source, candidates); result.canonical_tender_id = source.canonicalTenderId; result.tender247_tender_id = source.tender247TenderId; result.manifest_token = source.manifestToken; rows.push(result); }
  for (const document of canonical) if (!rows.some((row) => row.canonical_document_id === document.id)) rows.push({ ...row({ documentid: "", filename: "", size: null, contentType: "" }, document, "CANONICAL_ORPHAN", 0, "no current source match", "Canonical document has no uniquely related current source", false), source_identity: null, source_filename: null });
  const counts = Object.fromEntries((["CONFIRMED_EXISTING", "PROBABLE_EXISTING", "CONFIRMED_MISSING", "AMBIGUOUS", "SOURCE_ONLY_CHANGED_VERSION", "CANONICAL_ORPHAN"] as HistoricalGapClassification[]).map((kind) => [kind, rows.filter((row) => row.classification === kind).length]));
  return { version: 1, runId, scrapedDate, generatedAt: new Date().toISOString(), summary: { savedRawDirectDocumentEntries: reconstructed.filter((source) => source.sourceKind === "direct").length, manifestExpandedDocumentEntries: reconstructed.filter((source) => source.sourceKind === "manifest").length, totalReconstructedEntries: reconstructed.length, uniqueReconstructedEntries: unique.size, duplicatesWithinReconstructedSource: duplicateKeys.size, canonicalDocuments: canonical.length, ...counts, SAFE_CONFIRMED_MISSING_COUNT: rows.filter((row) => row.classification === "CONFIRMED_MISSING" && row.safe_for_auto_recovery).length, manifestApiCalls, documentDetailDownloadCalls: 0, tender247FeedApiCalls: 0 }, rows };
}

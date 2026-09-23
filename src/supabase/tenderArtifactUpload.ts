/**
 * Upload tender crawl artifacts to SharePoint via the document Edge Function.
 * AI_Summary.pdf is optional — missing summary does not fail the tender.
 *
 * Local layout (canonical):
 *   T247-{id}/documents/Tender_All_Documents.zip
 *   T247-{id}/AI_Summary.pdf
 * metadata.json stays in DB only (never uploaded to SharePoint).
 *
 * SharePoint TenderDocs layout:
 *   companies/siyana-info-solutions-pvt-ltd_{companyId}/
 *     tender-artifacts/{manual|tender247}/{date}/{id}/…
 */
import fs from "node:fs";
import path from "node:path";
import { getSupabaseAdminClient, isSupabaseConfigured } from "./client.js";
import { CANONICAL_ARCHIVE_NAME } from "../tender247Batch/canonicalTenderArchive.js";

const FUNCTION_NAME = "tender-automation-company-documents";
const ARTIFACT_MARKER = "artifact-upload.json";
const DEFAULT_COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const DEFAULT_COMPANY_NAME = "Siyana Info Solutions Pvt. Ltd.";
const SHAREPOINT_COMPANY_SEGMENT =
  "siyana-info-solutions-pvt-ltd_a1b2c3d4-e5f6-7890-abcd-ef1234567890";

export type TenderArtifactKind = "documents_zip" | "ai_summary";

export type TenderArtifactUploadResult = {
  attempted: number;
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
  urls: {
    documents_zip_url: string | null;
    ai_summary_url: string | null;
  };
};

function resolveServiceKey(): string {
  return (
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

function slugifyBlobSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

function sanitizeBlobFileName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[/\\]/g, "");
  const lastDot = trimmed.lastIndexOf(".");
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext = lastDot > 0 ? trimmed.slice(lastDot) : "";
  const safeBase = slugifyBlobSegment(base) || "file";
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${safeBase}${safeExt}`;
}

export function resolveCompanyBlobRoot(options?: {
  companyName?: string | null;
  companyId?: string | null;
}): string {
  const explicit = process.env.COMPANY_BLOB_FOLDER?.trim();
  if (explicit && !explicit.includes("..") && !explicit.includes("/")) {
    return explicit;
  }
  const companyId =
    options?.companyId?.trim() ||
    process.env.COMPANY_ID?.trim() ||
    process.env.SIYANA_COMPANY_ID?.trim() ||
    DEFAULT_COMPANY_ID;
  const companyName =
    options?.companyName?.trim() ||
    process.env.COMPANY_NAME?.trim() ||
    DEFAULT_COMPANY_NAME;
  return `${slugifyBlobSegment(companyName)}_${companyId}`;
}

export function buildTenderArtifactBlobName(options: {
  sourcePortal: "TENDER247" | "BIDASSIST" | "MANUAL";
  sourceTenderId: string;
  runDate: string;
  fileName: string;
  companyName?: string | null;
  companyId?: string | null;
}): string {
  const portal = options.sourcePortal.toLowerCase();
  const id = String(options.sourceTenderId)
    .replace(/^T247-/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const date = options.runDate.match(/^\d{4}-\d{2}-\d{2}$/)
    ? options.runDate
    : "undated";
  const file = sanitizeBlobFileName(options.fileName);

  return `companies/${SHAREPOINT_COMPANY_SEGMENT}/tender-artifacts/${portal}/${date}/${id}/${file}`;
}

/** Resolve local file path for an artifact kind (canonical Tender247 layout). */
export function resolveLocalArtifactPath(
  tenderFolder: string,
  kind: TenderArtifactKind,
): string | null {
  if (kind === "documents_zip") {
    const candidates = [
      path.join(tenderFolder, "documents", CANONICAL_ARCHIVE_NAME),
      path.join(tenderFolder, CANONICAL_ARCHIVE_NAME),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
          return candidate;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  const aiPath = path.join(tenderFolder, "AI_Summary.pdf");
  try {
    if (fs.existsSync(aiPath) && fs.statSync(aiPath).size > 0) return aiPath;
  } catch {
    // ignore
  }
  return null;
}

function mimeForFile(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

function columnForKind(kind: TenderArtifactKind): keyof TenderArtifactUploadResult["urls"] {
  if (kind === "documents_zip") return "documents_zip_url";
  return "ai_summary_url";
}

async function invokeUploadTenderArtifact(options: {
  sourcePortal: "TENDER247" | "BIDASSIST" | "MANUAL";
  sourceTenderId: string;
  runDate: string;
  kind: TenderArtifactKind;
  filePath: string;
  fileName: string;
}): Promise<{ ok: boolean; storageUrl: string | null; error: string | null }> {
  const base = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const key = resolveServiceKey();
  if (!base || !key) {
    return {
      ok: false,
      storageUrl: null,
      error: "Supabase / Edge Function not configured",
    };
  }

  const bytes = fs.readFileSync(options.filePath);
  const blobName = buildTenderArtifactBlobName({
    sourcePortal: options.sourcePortal,
    sourceTenderId: options.sourceTenderId,
    runDate: options.runDate,
    fileName: options.fileName,
  });

  const form = new FormData();
  form.set("action", "upload-tender-artifact");
  form.set("sourcePortal", options.sourcePortal);
  form.set("sourceTenderId", options.sourceTenderId);
  form.set("runDate", options.runDate);
  form.set("artifactKind", options.kind);
  form.set("blobName", blobName);
  form.set("companyFolder", resolveCompanyBlobRoot());
  form.set(
    "companyId",
    process.env.COMPANY_ID?.trim() ||
      process.env.SIYANA_COMPANY_ID?.trim() ||
      DEFAULT_COMPANY_ID,
  );
  form.set(
    "companyName",
    process.env.COMPANY_NAME?.trim() || DEFAULT_COMPANY_NAME,
  );
  form.set(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mimeForFile(options.fileName) }),
    options.fileName,
  );

  const response = await fetch(`${base}/functions/v1/${FUNCTION_NAME}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    body: form,
  });

  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    storageUrl?: string;
    error?: string;
  };

  if (!response.ok || !body.success || !body.storageUrl) {
    return {
      ok: false,
      storageUrl: null,
      error: body.error || `HTTP ${response.status}`,
    };
  }

  return { ok: true, storageUrl: body.storageUrl, error: null };
}

function readExistingUrls(
  tenderFolder: string,
): TenderArtifactUploadResult["urls"] {
  const markerPath = path.join(tenderFolder, ARTIFACT_MARKER);
  if (!fs.existsSync(markerPath)) {
    return {
      documents_zip_url: null,
      ai_summary_url: null,
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8")) as {
      urls?: TenderArtifactUploadResult["urls"];
    };
    const sharePointOnly = (value: string | null | undefined): string | null => {
      const raw = String(value || "").trim();
      if (!raw) return null;
      try {
        return new URL(raw).hostname.toLowerCase().endsWith(".sharepoint.com")
          ? raw
          : null;
      } catch {
        return null;
      }
    };
    return {
      documents_zip_url: sharePointOnly(parsed.urls?.documents_zip_url),
      ai_summary_url: sharePointOnly(parsed.urls?.ai_summary_url),
    };
  } catch {
    return {
      documents_zip_url: null,
      ai_summary_url: null,
    };
  }
}

function writeMarker(
  tenderFolder: string,
  urls: TenderArtifactUploadResult["urls"],
): void {
  fs.writeFileSync(
    path.join(tenderFolder, ARTIFACT_MARKER),
    JSON.stringify(
      {
        urls,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * Seed SharePoint URL marker from Supabase so re-uploads are skipped and
 * existing non-empty URLs are never overwritten.
 */
export function seedArtifactUploadUrlsFromSupabase(
  tenderFolder: string,
  urls: {
    documents_zip_url?: string | null;
    ai_summary_url?: string | null;
  },
): void {
  if (!fs.existsSync(tenderFolder)) {
    fs.mkdirSync(tenderFolder, { recursive: true });
  }
  const existing = readExistingUrls(tenderFolder);
  const sharePointOnly = (value: string | null | undefined): string => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw).hostname.toLowerCase().endsWith(".sharepoint.com")
        ? raw
        : "";
    } catch {
      return "";
    }
  };
  const docs =
    sharePointOnly(urls.documents_zip_url) || existing.documents_zip_url;
  const summary =
    sharePointOnly(urls.ai_summary_url) || existing.ai_summary_url;
  writeMarker(tenderFolder, {
    documents_zip_url: docs || null,
    ai_summary_url: summary || null,
  });
}

/**
 * Upload available local artifacts and persist public URLs on the tender row.
 * AI Summary missing is success (skipped), not failure.
 * Called right after Tender247 download/zip — before ChatGPT qualification.
 */
export async function uploadTenderArtifactsAndPersistUrls(options: {
  sourcePortal: "TENDER247" | "BIDASSIST" | "MANUAL";
  sourceRegion?: "INDIAN" | "GLOBAL";
  sourceTenderId: string;
  tenderFolder: string;
  runDate: string;
  logger?: { info: (msg: string) => void; warn?: (msg: string) => void };
}): Promise<TenderArtifactUploadResult> {
  const result: TenderArtifactUploadResult = {
    attempted: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    urls: readExistingUrls(options.tenderFolder),
  };

  const candidates: Array<{
    kind: TenderArtifactKind;
    fileName: string;
  }> = [
    { kind: "documents_zip", fileName: CANONICAL_ARCHIVE_NAME },
    // metadata.json is already in agenttender_tenders.raw_metadata — do not upload.
    { kind: "ai_summary", fileName: "AI_Summary.pdf" },
  ];

  for (const candidate of candidates) {
    const column = columnForKind(candidate.kind);
    if (result.urls[column]) {
      result.skipped += 1;
      options.logger?.info?.(
        `ARTIFACT_UPLOAD_SKIPPED=${candidate.fileName} reason=already_uploaded`,
      );
      continue;
    }

    const filePath = resolveLocalArtifactPath(
      options.tenderFolder,
      candidate.kind,
    );
    if (!filePath) {
      result.skipped += 1;
      options.logger?.info?.(
        `ARTIFACT_UPLOAD_SKIPPED=${candidate.fileName} reason=missing_local`,
      );
      continue;
    }

    result.attempted += 1;
    options.logger?.info?.(
      `Uploading: ${candidate.fileName} from=${path.relative(options.tenderFolder, filePath)}`,
    );
    const uploaded = await invokeUploadTenderArtifact({
      sourcePortal: options.sourcePortal,
      sourceTenderId: options.sourceTenderId,
      runDate: options.runDate,
      kind: candidate.kind,
      filePath,
      fileName: candidate.fileName,
    });

    if (!uploaded.ok || !uploaded.storageUrl) {
      result.failed += 1;
      result.errors.push(`${candidate.fileName}: ${uploaded.error}`);
      options.logger?.warn?.(
        `ARTIFACT_UPLOAD_FAILED=${candidate.fileName} error=${uploaded.error}`,
      );
      continue;
    }

    result.urls[column] = uploaded.storageUrl;
    result.uploaded += 1;
    options.logger?.info?.(
      `ARTIFACT_UPLOAD_OK=${candidate.fileName} url=${uploaded.storageUrl}`,
    );
  }

  writeMarker(options.tenderFolder, result.urls);

  if (isSupabaseConfigured()) {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (result.urls.documents_zip_url) {
      patch.documents_zip_url = result.urls.documents_zip_url;
      patch.document_archive_available = true;
    }
    if (result.urls.ai_summary_url) {
      patch.ai_summary_url = result.urls.ai_summary_url;
      patch.ai_summary_available = true;
    }

    if (Object.keys(patch).length > 1) {
      const client = getSupabaseAdminClient();
      const scrapedDate = options.runDate?.trim() || null;
      // Hard require scraped_date — never update by source_tender_id alone
      // (same Tender247 ID can exist on multiple mail dates).
      if (!scrapedDate || !/^\d{4}-\d{2}-\d{2}$/.test(scrapedDate)) {
        result.errors.push(
          "db_url_persist: refused update without scraped_date (runDate)",
        );
        options.logger?.warn?.(
          "ARTIFACT_URL_DB_UPDATE_REFUSED=missing_scraped_date",
        );
      } else {
        let update = client
          .from("agenttender_tenders")
          .update(patch)
          .eq("source_portal", options.sourcePortal)
          .eq("source_tender_id", options.sourceTenderId)
          .eq("scraped_date", scrapedDate);
        if (options.sourcePortal === "TENDER247" && options.sourceRegion) {
          update = update.eq("source_region", options.sourceRegion);
        }
        const { error } = await update;
        if (error) {
          result.errors.push(`db_url_persist: ${error.message}`);
          options.logger?.warn?.(
            `ARTIFACT_URL_DB_UPDATE_FAILED=${error.message}`,
          );
        }
      }
    }
  }

  // Whenever a docs zip URL is known (fresh upload or already on SharePoint),
  // schedule Ask AI indexing. Deduped server-side via tender index jobs.
  if (result.urls.documents_zip_url) {
    try {
      const { scheduleTenderAiIndexAfterArtifactUpload } = await import(
        "./scheduleTenderAiIndex.js"
      );
      void scheduleTenderAiIndexAfterArtifactUpload({
        sourcePortal: options.sourcePortal,
        sourceRegion: options.sourceRegion,
        sourceTenderId: options.sourceTenderId,
        runDate: options.runDate,
        logger: options.logger,
      });
    } catch (error) {
      options.logger?.warn?.(
        `AI_INDEX_SCHEDULE_IMPORT_FAILED=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
}

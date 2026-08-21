/**
 * Upload tender crawl artifacts via the existing Azure Edge Function.
 * AI_Summary.pdf is optional — missing summary does not fail the tender.
 *
 * Local layout (canonical):
 *   T247-{id}/documents/Tender_All_Documents.zip
 *   T247-{id}/AI_Summary.pdf
 * metadata.json stays in DB only (never uploaded to Azure).
 */
import fs from "node:fs";
import path from "node:path";
import { getSupabaseAdminClient, isSupabaseConfigured } from "./client.js";
import { CANONICAL_ARCHIVE_NAME } from "../tender247Batch/canonicalTenderArchive.js";

const FUNCTION_NAME = "tender-automation-company-documents";
const ARTIFACT_MARKER = "artifact-upload.json";

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

function sanitizeBlobFileName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[/\\]/g, "");
  const lastDot = trimmed.lastIndexOf(".");
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext = lastDot > 0 ? trimmed.slice(lastDot) : "";
  const safeBase =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "file";
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${safeBase}${safeExt}`;
}

export function buildTenderArtifactBlobName(options: {
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  runDate: string;
  fileName: string;
  /** Company slug/id for company-scoped Azure layout (no account segment). */
  companyKey?: string | null;
}): string {
  const portal = options.sourcePortal.toLowerCase();
  const id = String(options.sourceTenderId)
    .replace(/^T247-/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const date = options.runDate.match(/^\d{4}-\d{2}-\d{2}$/)
    ? options.runDate
    : "undated";
  const company =
    String(options.companyKey || process.env.COMPANY_BLOB_KEY || "siyana")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "siyana";
  // Company-based path — never include Tender247 account id.
  // metadata.json is intentionally not uploaded (raw_metadata in DB).
  return `companies/${company}/tender-artifacts/${portal}/${date}/${id}/${sanitizeBlobFileName(options.fileName)}`;
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
  sourcePortal: "TENDER247" | "BIDASSIST";
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
    return {
      documents_zip_url: parsed.urls?.documents_zip_url ?? null,
      ai_summary_url: parsed.urls?.ai_summary_url ?? null,
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
 * Upload available local artifacts and persist public URLs on the tender row.
 * AI Summary missing is success (skipped), not failure.
 * Called right after Tender247 download/zip — before ChatGPT qualification.
 */
export async function uploadTenderArtifactsAndPersistUrls(options: {
  sourcePortal: "TENDER247" | "BIDASSIST";
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
      const { error } = await client
        .from("agenttender_tenders")
        .update(patch)
        .eq("source_portal", options.sourcePortal)
        .eq("source_tender_id", options.sourceTenderId);
      if (error) {
        result.errors.push(`db_url_persist: ${error.message}`);
        options.logger?.warn?.(
          `ARTIFACT_URL_DB_UPDATE_FAILED=${error.message}`,
        );
      }
    }
  }

  return result;
}

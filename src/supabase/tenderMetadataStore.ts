import fs from "node:fs";
import path from "node:path";
import type { BidassistMetadata } from "../bidassist/bidassistTypes.js";
import { ensureDir } from "../fileUtils.js";
import type { CompleteTenderMetadata } from "../tender247Batch/extractCompleteMetadata.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "./client.js";
import {
  buildBidassistSupabaseRow,
  buildTender247SupabaseRow,
  type AgenttenderTenderRow,
} from "./tenderMetadataMap.js";
import { mergeNullOnlyRecord } from "./mergeTenderNullOnly.js";
import { validateBidAssistUpsertPayload } from "../bidassist/bidassistDocumentMetadataExtractor.js";

const TABLE = "agenttender_tenders";
const SOURCE = "TENDER247";

export type SourcePortal = "TENDER247" | "BIDASSIST";

export interface TenderMetadataRecord {
  id: string;
  source_portal: SourcePortal;
  source_tender_id: string;
  folder_id: string | null;
  raw_metadata: Record<string, unknown>;
  local_folder_path: string | null;
  ai_summary_available: boolean;
  document_archive_available: boolean;
  download_status: string | null;
  qualification_status: string | null;
}

export interface UpsertTender247MetadataResult {
  ok: boolean;
  id: string | null;
  contentHash: string | null;
  error: string | null;
}

export interface VerifiedTender247MetadataRow {
  id: string;
  source_portal: string;
  source_tender_id: string;
  folder_id: string | null;
  raw_metadata: Record<string, unknown>;
  updated_at: string | null;
}

export interface VerifyTender247MetadataResult {
  ok: boolean;
  row: VerifiedTender247MetadataRow | null;
  error: string | null;
}

/** Upsert Tender247 crawler metadata. Does not write local metadata.json. */
export async function upsertTender247Metadata(options: {
  metadata: CompleteTenderMetadata;
  localFolderPath: string;
  scrapedDate?: string | null;
  aiSummaryAvailable?: boolean;
  documentArchiveAvailable?: boolean;
  logger?: {
    info: (msg: string) => void;
    error?: (msg: string) => void;
    warn?: (msg: string) => void;
  };
}): Promise<UpsertTender247MetadataResult> {
  const { metadata, localFolderPath, logger } = options;
  if (!isSupabaseConfigured()) {
    const error =
      "SUPABASE_URL / SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) missing — metadata not synced";
    logger?.error?.(`SUPABASE_METADATA_UPSERT_SKIPPED=${error}`);
    return { ok: false, id: null, contentHash: null, error };
  }

  const row = buildTender247SupabaseRow({
    metadata,
    localFolderPath,
    scrapedDate: options.scrapedDate,
    aiSummaryAvailable: options.aiSummaryAvailable,
    documentArchiveAvailable: options.documentArchiveAvailable,
  });

  try {
    const client = getSupabaseAdminClient();
    const { data: existing } = await client
      .from(TABLE)
      .select("*")
      .eq("source_portal", SOURCE)
      .eq("source_tender_id", String(metadata.t247Id))
      .maybeSingle();

    // Crawl enriches GPT-Excel rows: fill missing fields only; never wipe screening status.
    const alwaysUpdate: Array<keyof AgenttenderTenderRow> = [
      "local_folder_path",
      "ai_summary_available",
      "document_archive_available",
      "download_status",
      "content_hash",
      "last_seen_at",
      "crawled_at",
      "supabase_synced_at",
      "raw_metadata",
      "metadata_version",
    ];

    let payload: Record<string, unknown> = { ...row };
    if (existing) {
      const { next, updatedKeys } = mergeNullOnlyRecord(
        existing as Record<string, unknown>,
        row as unknown as Record<string, unknown>,
        alwaysUpdate as string[],
      );
      // Preserve GPT Excel / qualification status unless empty.
      if (
        existing.qualification_status &&
        String(existing.qualification_status).trim()
      ) {
        delete next.qualification_status;
      }
      payload = {
        ...next,
        source_portal: SOURCE,
        source_tender_id: String(metadata.t247Id),
        updated_at: new Date().toISOString(),
      };
      logger?.info?.(
        `SUPABASE_METADATA_NULL_ONLY_MERGE=T247-${metadata.t247Id} keys=${updatedKeys.join(",") || "none"}`,
      );

      const { data, error } = await client
        .from(TABLE)
        .update(payload)
        .eq("id", existing.id)
        .select("id")
        .maybeSingle();

      if (error) {
        logger?.error?.(`SUPABASE_METADATA_UPSERT_FAILED=${error.message}`);
        return {
          ok: false,
          id: null,
          contentHash: row.content_hash,
          error: error.message,
        };
      }
      const id = data && typeof data.id === "string" ? data.id : String(existing.id);
      logger?.info(
        `SUPABASE_METADATA_UPSERTED=T247-${metadata.t247Id} hash=${row.content_hash.slice(0, 12)}`,
      );
      return { ok: true, id, contentHash: row.content_hash, error: null };
    }

    const { data, error } = await client
      .from(TABLE)
      .upsert(
        {
          ...row,
        } satisfies AgenttenderTenderRow,
        {
          onConflict: "source_portal,source_tender_id",
          ignoreDuplicates: false,
        },
      )
      .select("id")
      .maybeSingle();

    if (error) {
      logger?.error?.(`SUPABASE_METADATA_UPSERT_FAILED=${error.message}`);
      try {
        await client.from(TABLE).upsert(
          {
            ...row,
            download_status: "DB_SYNC_FAILED",
          },
          { onConflict: "source_portal,source_tender_id" },
        );
      } catch {
        // ignore secondary failure
      }
      return {
        ok: false,
        id: null,
        contentHash: row.content_hash,
        error: error.message,
      };
    }

    const id = data && typeof data.id === "string" ? data.id : null;
    logger?.info(
      `SUPABASE_METADATA_UPSERTED=T247-${metadata.t247Id} hash=${row.content_hash.slice(0, 12)}`,
    );
    return { ok: true, id, contentHash: row.content_hash, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error?.(`SUPABASE_METADATA_UPSERT_FAILED=${message}`);
    return {
      ok: false,
      id: null,
      contentHash: row.content_hash,
      error: message,
    };
  }
}

/** Confirm a Tender247 metadata row exists with a non-empty raw_metadata payload. */
export async function verifyTender247MetadataRow(
  t247Id: string,
): Promise<VerifyTender247MetadataResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      row: null,
      error: "Supabase is not configured",
    };
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select("id, source_portal, source_tender_id, folder_id, raw_metadata, updated_at")
    .eq("source_portal", SOURCE)
    .eq("source_tender_id", String(t247Id))
    .maybeSingle();

  if (error) {
    return { ok: false, row: null, error: error.message };
  }
  if (!data) {
    return { ok: false, row: null, error: "No row returned" };
  }

  const raw = data.raw_metadata;
  const rawOk =
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.keys(raw as object).length > 0;

  if (
    data.source_portal !== SOURCE ||
    String(data.source_tender_id) !== String(t247Id) ||
    !rawOk
  ) {
    return {
      ok: false,
      row: null,
      error: "Verification checks failed for source portal, tender id, or raw_metadata",
    };
  }

  return {
    ok: true,
    row: {
      id: String(data.id),
      source_portal: String(data.source_portal),
      source_tender_id: String(data.source_tender_id),
      folder_id: data.folder_id ? String(data.folder_id) : null,
      raw_metadata: raw as Record<string, unknown>,
      updated_at: data.updated_at ? String(data.updated_at) : null,
    },
    error: null,
  };
}

/** Upsert BidAssist crawler metadata. */
export async function upsertBidassistMetadata(options: {
  metadata: BidassistMetadata;
  localFolderPath: string;
  scrapedDate?: string | null;
  documentArchiveAvailable?: boolean;
  logger?: {
    info: (msg: string) => void;
    error?: (msg: string) => void;
    warn?: (msg: string) => void;
  };
}): Promise<UpsertTender247MetadataResult> {
  const { metadata, localFolderPath, logger } = options;
  const label = metadata.folderId || `BA-${metadata.bidassistId}`;
  logger?.info(`SUPABASE_TENDER_UPSERT_START=${label}`);

  if (!isSupabaseConfigured()) {
    const error =
      "SUPABASE_URL / SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) missing — metadata not synced";
    logger?.error?.(`SUPABASE_METADATA_UPSERT_SKIPPED=${error}`);
    return { ok: false, id: null, contentHash: null, error };
  }

  const row = buildBidassistSupabaseRow({
    metadata,
    localFolderPath,
    scrapedDate: options.scrapedDate,
    documentArchiveAvailable: options.documentArchiveAvailable,
  });

  const validation = validateBidAssistUpsertPayload(row);
  if (!validation.ok) {
    logger?.error?.(
      `SUPABASE_METADATA_UPSERT_FAILED=validation ${validation.error}`,
    );
    return {
      ok: false,
      id: null,
      contentHash: row.content_hash,
      error: validation.error,
    };
  }

  try {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from(TABLE)
      .upsert(
        {
          ...row,
        } satisfies AgenttenderTenderRow,
        {
          onConflict: "source_portal,source_tender_id",
          ignoreDuplicates: false,
        },
      )
      .select("id")
      .maybeSingle();

    if (error) {
      logger?.error?.(`SUPABASE_METADATA_UPSERT_FAILED=${error.message}`);
      return {
        ok: false,
        id: null,
        contentHash: row.content_hash,
        error: error.message,
      };
    }

    const id = data && typeof data.id === "string" ? data.id : null;
    logger?.info(`SUPABASE_TENDER_UPSERTED=${label}`);
    if (id) {
      logger?.info(`SUPABASE_TENDER_DATABASE_ID=${id}`);
    }
    return { ok: true, id, contentHash: row.content_hash, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error?.(`SUPABASE_METADATA_UPSERT_FAILED=${message}`);
    return {
      ok: false,
      id: null,
      contentHash: row.content_hash,
      error: message,
    };
  }
}

/** Confirm a BidAssist metadata row exists with enriched raw_metadata. */
export async function verifyBidassistMetadataRow(
  bidassistId: string,
): Promise<VerifyTender247MetadataResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      row: null,
      error: "Supabase is not configured",
    };
  }

  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select(
      "id, source_portal, source_tender_id, folder_id, title, tender_value, tender_value_text, emd_amount, emd_text, raw_metadata, updated_at",
    )
    .eq("source_portal", "BIDASSIST")
    .eq("source_tender_id", String(bidassistId))
    .maybeSingle();

  if (error) {
    return { ok: false, row: null, error: error.message };
  }
  if (!data) {
    return { ok: false, row: null, error: "No row returned" };
  }

  const raw = data.raw_metadata;
  const rawOk =
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.keys(raw as object).length > 0;

  if (
    data.source_portal !== "BIDASSIST" ||
    String(data.source_tender_id) !== String(bidassistId) ||
    !rawOk ||
    !String(data.title || "").trim()
  ) {
    return {
      ok: false,
      row: null,
      error:
        "Verification checks failed for source portal, tender id, title, or raw_metadata",
    };
  }

  return {
    ok: true,
    row: data as VerifyTender247MetadataResult["row"],
    error: null,
  };
}

/** Unified metadata reader for Tender247 and BidAssist. */
export async function getTenderMetadata(
  sourcePortal: SourcePortal,
  sourceTenderId: string,
): Promise<TenderMetadataRecord | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select(
      "id, source_portal, source_tender_id, folder_id, raw_metadata, local_folder_path, ai_summary_available, document_archive_available, download_status, qualification_status",
    )
    .eq("source_portal", sourcePortal)
    .eq("source_tender_id", String(sourceTenderId))
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: String(data.id),
    source_portal: data.source_portal as SourcePortal,
    source_tender_id: String(data.source_tender_id),
    folder_id: data.folder_id ? String(data.folder_id) : null,
    raw_metadata: (data.raw_metadata || {}) as Record<string, unknown>,
    local_folder_path: data.local_folder_path
      ? String(data.local_folder_path)
      : null,
    ai_summary_available: Boolean(data.ai_summary_available),
    document_archive_available: Boolean(data.document_archive_available),
    download_status: data.download_status ? String(data.download_status) : null,
    qualification_status: data.qualification_status
      ? String(data.qualification_status)
      : null,
  };
}

export async function verifySourceTenderMetadataRow(
  sourcePortal: SourcePortal,
  sourceTenderId: string,
): Promise<{ ok: boolean; id: string | null; error: string | null }> {
  const row = await getTenderMetadata(sourcePortal, sourceTenderId);
  if (!row) {
    return { ok: false, id: null, error: "Metadata row not found" };
  }
  const raw = row.raw_metadata;
  const rawOk =
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.keys(raw).length > 0;
  if (!rawOk) {
    return { ok: false, id: row.id, error: "raw_metadata is empty" };
  }
  return { ok: true, id: row.id, error: null };
}

export async function fetchTender247Metadata(
  t247Id: string,
): Promise<CompleteTenderMetadata | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select("raw_metadata, download_status")
    .eq("source_portal", SOURCE)
    .eq("source_tender_id", String(t247Id))
    .maybeSingle();

  if (error || !data?.raw_metadata) {
    return null;
  }
  return data.raw_metadata as CompleteTenderMetadata;
}

export async function tender247MetadataExistsInSupabase(
  t247Id: string,
): Promise<boolean> {
  const metadata = await fetchTender247Metadata(t247Id);
  if (!metadata) {
    return false;
  }
  const status = metadata.metadataExtractionStatus;
  return status === "complete" || status === "partial" || status == null;
}

/**
 * Write a temporary metadata.json for ChatGPT upload, then return a cleanup fn.
 * Prefers Supabase; falls back to a legacy on-disk metadata.json when present.
 */
export async function materializeTempMetadataJson(options: {
  dateFolder: string;
  t247Id: string;
  logger?: {
    info: (msg: string) => void;
    error?: (msg: string) => void;
    warn?: (msg: string) => void;
  };
}): Promise<{ metadataPath: string; cleanup: () => void } | null> {
  const { dateFolder, t247Id, logger } = options;
  const tenderFolder = path.join(dateFolder, `T247-${t247Id}`);
  const legacyPath = path.join(tenderFolder, "metadata.json");
  const tempPath = path.join(tenderFolder, `.chatgpt-metadata-temp.json`);

  let metadata: CompleteTenderMetadata | Record<string, unknown> | null =
    await fetchTender247Metadata(t247Id);

  if (!metadata && fs.existsSync(legacyPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(legacyPath, "utf8")) as CompleteTenderMetadata;
      logger?.info(`CHATGPT_METADATA_LEGACY_FALLBACK=T247-${t247Id}`);
      // Best-effort backfill so later runs use Supabase
      if (metadata && "t247Id" in metadata) {
        await upsertTender247Metadata({
          metadata: metadata as CompleteTenderMetadata,
          localFolderPath: tenderFolder,
          logger,
        }).catch(() => undefined);
      }
    } catch {
      metadata = null;
    }
  }

  if (!metadata) {
    return null;
  }

  ensureDir(tenderFolder);
  // ChatGPT upload expects the filename metadata.json
  const uploadPath = path.join(tenderFolder, "metadata.json");
  const hadLegacy = fs.existsSync(legacyPath);
  let legacyBackup: string | null = null;
  if (hadLegacy) {
    legacyBackup = `${legacyPath}.pre-chatgpt.bak`;
    fs.copyFileSync(legacyPath, legacyBackup);
  }

  fs.writeFileSync(uploadPath, JSON.stringify(metadata, null, 2), "utf8");
  // Marker so cleanup knows this was our temporary materialization
  fs.writeFileSync(
    tempPath,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      t247Id,
      hadLegacy,
      legacyBackup,
    }),
    "utf8",
  );
  logger?.info(`CHATGPT_TEMP_METADATA_CREATED=T247-${t247Id}`);

  return {
    metadataPath: uploadPath,
    cleanup: () => {
      try {
        if (fs.existsSync(tempPath)) {
          const marker = JSON.parse(fs.readFileSync(tempPath, "utf8")) as {
            hadLegacy?: boolean;
            legacyBackup?: string | null;
          };
          fs.rmSync(tempPath, { force: true });
          if (!marker.hadLegacy && fs.existsSync(uploadPath)) {
            fs.rmSync(uploadPath, { force: true });
          } else if (marker.legacyBackup && fs.existsSync(marker.legacyBackup)) {
            fs.copyFileSync(marker.legacyBackup, uploadPath);
            fs.rmSync(marker.legacyBackup, { force: true });
          }
        } else if (fs.existsSync(uploadPath) && !hadLegacy) {
          fs.rmSync(uploadPath, { force: true });
        }
        logger?.info(`CHATGPT_TEMP_METADATA_REMOVED=T247-${t247Id}`);
      } catch {
        // ignore cleanup errors
      }
    },
  };
}

/**
 * Repair GPT metadata availability without changing the canonical architecture:
 * ChatGPT still receives metadata.json materialized from Supabase.
 */
import fs from "node:fs";
import path from "node:path";
import type { CompleteTenderMetadata } from "../tender247Batch/extractCompleteMetadata.js";
import {
  readMetadataSyncMarker,
  writeMetadataSyncMarker,
} from "../tender247Batch/resumeArtifacts.js";
import {
  getTenderMetadata,
  upsertTender247Metadata,
  verifyTender247MetadataRow,
} from "../supabase/tenderMetadataStore.js";

export type MetadataFailureCode =
  | "SUPABASE_METADATA_ROW_MISSING"
  | "SUPABASE_METADATA_FETCH_FAILED"
  | "LOCAL_METADATA_RECOVERY_UNAVAILABLE"
  | "METADATA_REPAIR_FAILED";

export type GptMetadataReadyResult = {
  ready: boolean;
  supabaseFound: boolean;
  repaired: boolean;
  reason: MetadataFailureCode | null;
};

export type MetadataRepairLogger = {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

export type MetadataRepairDeps = {
  getTenderMetadata: typeof getTenderMetadata;
  upsertTender247Metadata: typeof upsertTender247Metadata;
  verifyTender247MetadataRow: typeof verifyTender247MetadataRow;
};

const defaultDeps: MetadataRepairDeps = {
  getTenderMetadata,
  upsertTender247Metadata,
  verifyTender247MetadataRow,
};

function log(logger: MetadataRepairLogger | undefined, msg: string): void {
  logger?.info(msg);
  if (!logger) console.log(msg);
}

export function readLocalRecoverableTenderMetadata(
  tenderFolder: string,
  t247Id: string,
): CompleteTenderMetadata | null {
  const candidates = [
    path.join(tenderFolder, "metadata.json"),
    path.join(tenderFolder, "metadata.json.pre-chatgpt.bak"),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size <= 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      const record = parsed as Record<string, unknown>;
      const id =
        String(record.t247Id ?? record.source_tender_id ?? "").replace(
          /^T247-/i,
          "",
        ) || t247Id;
      if (id && id !== t247Id) {
        continue;
      }
      if (record.source === "tender247" || record.normalized || record.t247Id) {
        return {
          ...(record as unknown as CompleteTenderMetadata),
          source: "tender247",
          t247Id,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function markLocalSyncFromSupabase(
  tenderFolder: string,
  t247Id: string,
  contentHash: string | null,
): void {
  writeMetadataSyncMarker(tenderFolder, {
    sourcePortal: "TENDER247",
    sourceTenderId: t247Id,
    contentHash,
    extractionStatus: "complete",
    syncedAt: new Date().toISOString(),
    ok: true,
    error: null,
  });
}

/**
 * Recovery order:
 * 1. Supabase row for TENDER247 + source_tender_id
 * 2. Local metadata.json → upsert + verify
 * 3. Existing ok sync marker (already materialized previously)
 */
export async function ensureGptMetadataReady(options: {
  tenderFolder: string;
  t247Id: string;
  logger?: MetadataRepairLogger;
  deps?: MetadataRepairDeps;
}): Promise<GptMetadataReadyResult> {
  const { tenderFolder, logger } = options;
  const t247Id = String(options.t247Id).replace(/^T247-/i, "");
  const deps = options.deps ?? defaultDeps;

  const marker = readMetadataSyncMarker(tenderFolder);
  if (marker?.ok) {
    log(logger, "GPT_METADATA_AVAILABLE=true");
    return {
      ready: true,
      supabaseFound: true,
      repaired: false,
      reason: null,
    };
  }

  let supabaseFetchFailed = false;
  try {
    const row = await deps.getTenderMetadata("TENDER247", t247Id);
    const rawOk =
      Boolean(row?.raw_metadata) &&
      typeof row?.raw_metadata === "object" &&
      Object.keys(row.raw_metadata).length > 0;
    if (row && rawOk) {
      markLocalSyncFromSupabase(tenderFolder, t247Id, null);
      log(logger, "GPT_METADATA_AVAILABLE=true");
      log(logger, "SUPABASE_METADATA_ROW_FOUND=true");
      return {
        ready: true,
        supabaseFound: true,
        repaired: true,
        reason: null,
      };
    }
    log(logger, "SUPABASE_METADATA_ROW_MISSING=true");
  } catch (error) {
    supabaseFetchFailed = true;
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn?.(`SUPABASE_METADATA_FETCH_FAILED=${message}`);
  }

  const local = readLocalRecoverableTenderMetadata(tenderFolder, t247Id);
  if (!local) {
    log(logger, "LOCAL_METADATA_RECOVERY_UNAVAILABLE=true");
    log(logger, "GPT_METADATA_AVAILABLE=false");
    return {
      ready: false,
      supabaseFound: false,
      repaired: false,
      reason: supabaseFetchFailed
        ? "SUPABASE_METADATA_FETCH_FAILED"
        : "SUPABASE_METADATA_ROW_MISSING",
    };
  }

  log(logger, "METADATA_REPAIR_UPSERT_START=true");
  const upsert = await deps.upsertTender247Metadata({
    metadata: local,
    localFolderPath: tenderFolder,
    logger: logger
      ? {
          info: (msg) => logger.info(msg),
          warn: logger.warn,
          error: logger.error,
        }
      : undefined,
  });
  if (!upsert.ok) {
    log(logger, `METADATA_REPAIR_FAILED=${upsert.error ?? "upsert"}`);
    return {
      ready: false,
      supabaseFound: false,
      repaired: false,
      reason: "METADATA_REPAIR_FAILED",
    };
  }

  const verified = await deps.verifyTender247MetadataRow(t247Id);
  if (!verified.ok) {
    log(logger, `METADATA_REPAIR_FAILED=${verified.error ?? "verify"}`);
    return {
      ready: false,
      supabaseFound: false,
      repaired: false,
      reason: "METADATA_REPAIR_FAILED",
    };
  }

  markLocalSyncFromSupabase(tenderFolder, t247Id, upsert.contentHash);
  log(logger, "GPT_METADATA_AVAILABLE=true");
  log(logger, "METADATA_REPAIRED=true");
  return {
    ready: true,
    supabaseFound: true,
    repaired: true,
    reason: null,
  };
}

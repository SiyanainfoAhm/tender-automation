/**
 * Backfill Azure/Supabase uploads for local Tender247 artifact folders.
 *
 * Usage:
 *   npx tsx src/supabase/backfillTenderArtifactUploads.ts --date=2026-08-20
 *   npx tsx src/supabase/backfillTenderArtifactUploads.ts --date=2026-08-20 --recover-url-from-logs
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getArgValue, resolveRequestedDate } from "../cli/requestedDate.js";
import { loadConfig } from "../config.js";
import { Logger } from "../logger.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "./client.js";
import { uploadTenderArtifactsAndPersistUrls } from "./tenderArtifactUpload.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dateIso = resolveRequestedDate(argv).requestedDate;
  const onlyId = getArgValue(argv, "tender-id")?.replace(/\D/g, "") || null;
  const onlyMissingDocumentUrls = argv.includes("--missing-document-urls");
  const recoverUrlFromLogs = argv.includes("--recover-url-from-logs");
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "ArtifactBackfill");
  const dateFolder = path.join(config.downloadRoot, dateIso);

  if (!fs.existsSync(dateFolder)) {
    throw new Error(`Date folder not found: ${dateFolder}`);
  }

  let dirs = fs
    .readdirSync(dateFolder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^T247-\d+$/i.test(d.name))
    .map((d) => d.name)
    .filter((name) => {
      if (!onlyId) return true;
      const digits = name.match(/^T247-(\d+)$/i)?.[1] || "";
      return digits === onlyId || name.replace(/\D/g, "").endsWith(onlyId);
    })
    .sort();

  if (onlyMissingDocumentUrls) {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase is required for --missing-document-urls");
    }
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("agenttender_tenders")
      .select("source_tender_id, documents_zip_url")
      .eq("source_portal", "TENDER247")
      .eq("scraped_date", dateIso);
    if (error) throw new Error(`Unable to load artifact backfill queue: ${error.message}`);
    const missingIds = new Set(
      (data || [])
        .filter((row) => !String(row.documents_zip_url || "").trim())
        .map((row) => String(row.source_tender_id || "").replace(/\D/g, ""))
        .filter(Boolean),
    );
    dirs = dirs.filter((name) => missingIds.has(name.replace(/^T247-/i, "")));
    logger.info(`ARTIFACT_BACKFILL_MISSING_DOCUMENT_URLS=true queued=${dirs.length}`);
  }

  if (recoverUrlFromLogs) {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase is required for --recover-url-from-logs");
    }
    const logPath = path.join(config.logRoot, `${dateIso}.log`);
    if (!fs.existsSync(logPath)) {
      throw new Error(`Run log not found: ${logPath}`);
    }
    const escapedDate = dateIso.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const urlPattern = new RegExp(
      `https://[^\\s]+\\.sharepoint\\.com/[^\\s]*/tender-artifacts/tender247/${escapedDate}/(\\d+)/Tender_All_Documents\\.zip`,
      "gi",
    );
    const recoveredUrls = new Map<string, string>();
    for (const match of fs.readFileSync(logPath, "utf8").matchAll(urlPattern)) {
      const id = match[1];
      const url = match[0];
      if (id && url) recoveredUrls.set(id, url);
    }

    const client = getSupabaseAdminClient();
    const { data: missingRows, error } = await client
      .from("agenttender_tenders")
      .select("id, source_tender_id")
      .eq("source_portal", "TENDER247")
      .eq("scraped_date", dateIso)
      .is("documents_zip_url", null);
    if (error) throw new Error(`Unable to load URL recovery queue: ${error.message}`);

    let recovered = 0;
    let unmatched = 0;
    for (const row of missingRows || []) {
      const tenderId = String(row.source_tender_id || "").replace(/\D/g, "");
      const url = recoveredUrls.get(tenderId);
      if (!url) {
        unmatched += 1;
        continue;
      }
      // The URL comes only from an ARTIFACT_UPLOAD_OK run log and is scoped to
      // this date/id. Updating by the primary key avoids the region mismatch
      // that caused the original missing URL records.
      const { error: updateError } = await client
        .from("agenttender_tenders")
        .update({
          documents_zip_url: url,
          document_archive_available: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updateError) {
        throw new Error(`Unable to recover URL for T247-${tenderId}: ${updateError.message}`);
      }
      recovered += 1;
      logger.info(`ARTIFACT_URL_LOG_RECOVERY_OK=T247-${tenderId}`);
    }
    logger.info(
      `ARTIFACT_URL_LOG_RECOVERY_SUMMARY recovered=${recovered} unmatched=${unmatched} logged_urls=${recoveredUrls.size}`,
    );
    return;
  }

  logger.info(`ARTIFACT_BACKFILL_DATE=${dateIso} folders=${dirs.length}`);

  let uploaded = 0;
  let failed = 0;
  let skipped = 0;

  for (const name of dirs) {
    const t247Id = name.match(/^T247-(\d+)$/i)?.[1] || name.replace(/\D/g, "");
    const tenderFolder = path.join(dateFolder, name);
    logger.info(`ARTIFACT_BACKFILL_START=${name}`);
    const result = await uploadTenderArtifactsAndPersistUrls({
      sourcePortal: "TENDER247",
      sourceRegion: "INDIAN",
      sourceTenderId: t247Id,
      tenderFolder,
      runDate: dateIso,
      logger,
    });
    uploaded += result.uploaded;
    failed += result.failed;
    skipped += result.skipped;
    logger.info(
      `ARTIFACT_BACKFILL_DONE=${name} uploaded=${result.uploaded} failed=${result.failed} skipped=${result.skipped}`,
    );
  }

  console.log("");
  console.log(`ARTIFACT_BACKFILL_SUMMARY uploaded=${uploaded} failed=${failed} skipped=${skipped}`);
  if (failed > 0) process.exitCode = 1;
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

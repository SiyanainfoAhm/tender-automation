/**
 * Backfill Azure/Supabase uploads for local Tender247 artifact folders.
 *
 * Usage:
 *   npx tsx src/supabase/backfillTenderArtifactUploads.ts --date=2026-08-20
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getArgValue, resolveRequestedDate } from "../cli/requestedDate.js";
import { loadConfig } from "../config.js";
import { Logger } from "../logger.js";
import { uploadTenderArtifactsAndPersistUrls } from "./tenderArtifactUpload.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dateIso = resolveRequestedDate(argv).requestedDate;
  const onlyId = getArgValue(argv, "tender-id")?.replace(/\D/g, "") || null;
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "ArtifactBackfill");
  const dateFolder = path.join(config.downloadRoot, dateIso);

  if (!fs.existsSync(dateFolder)) {
    throw new Error(`Date folder not found: ${dateFolder}`);
  }

  const dirs = fs
    .readdirSync(dateFolder, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^T247-\d+$/i.test(d.name))
    .map((d) => d.name)
    .filter((name) => {
      if (!onlyId) return true;
      const digits = name.match(/^T247-(\d+)$/i)?.[1] || "";
      return digits === onlyId || name.replace(/\D/g, "").endsWith(onlyId);
    })
    .sort();

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

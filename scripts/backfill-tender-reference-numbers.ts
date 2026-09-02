/**
 * Backfill reference_no on agenttender_tenders from daily screening Excel files.
 *
 * Usage:
 *   npx tsx scripts/backfill-tender-reference-numbers.ts
 *   npx tsx scripts/backfill-tender-reference-numbers.ts --file=downloads/2026-08-31/screening/31-08-26_daily Tenders.xlsx
 */
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

import { referenceNoForWorkbookRow } from "../src/excel/referenceNumber.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "../src/supabase/client.js";
import { persistGptScreenedWorkbookToDatabase } from "../src/runScreening/persistPhase1Results.js";
import { parseSourceWorkbook, type RunWorkbookRow } from "../src/runScreening/runWorkbook.js";
import { resolveRunCompanyId } from "../src/company/siyanaCompany.js";
import { Logger } from "../src/logger.js";

loadEnv({ path: path.resolve(process.cwd(), ".env") });

const DEFAULT_FILES = [
  {
    label: "31-08-26_daily Tenders.xlsx",
    runDate: "2026-08-31",
    relativePath: path.join(
      "downloads",
      "2026-08-31",
      "screening",
      "31-08-26_daily Tenders.xlsx",
    ),
  },
  {
    label: "01-09-26_daily Tenders.xlsx",
    runDate: "2026-09-01",
    relativePath: path.join(
      "downloads",
      "2026-09-01",
      "screening",
      "01-09-26_daily Tenders.xlsx",
    ),
  },
] as const;

type FileStats = {
  label: string;
  path: string;
  rowsRead: number;
  withReference: number;
  blankReference: number;
  matched: number;
  updated: number;
  unchanged: number;
  inserted: number;
  missingIds: string[];
  errors: string[];
};

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : null;
}

function portalForRow(row: RunWorkbookRow): "TENDER247" | "BIDASSIST" {
  if (row.tender247Id) return "TENDER247";
  return "BIDASSIST";
}

function sourceTenderId(row: RunWorkbookRow): string | null {
  const id = row.tender247Id || row.bidAssistId || row.canonicalId;
  return id ? String(id).trim() : null;
}

async function backfillFile(
  fileInfo: (typeof DEFAULT_FILES)[number],
): Promise<FileStats> {
  const absolutePath = path.resolve(process.cwd(), fileInfo.relativePath);
  const stats: FileStats = {
    label: fileInfo.label,
    path: absolutePath,
    rowsRead: 0,
    withReference: 0,
    blankReference: 0,
    matched: 0,
    updated: 0,
    unchanged: 0,
    inserted: 0,
    missingIds: [],
    errors: [],
  };

  if (!fs.existsSync(absolutePath)) {
    stats.errors.push(`File not found: ${absolutePath}`);
    return stats;
  }

  const rows = parseSourceWorkbook(absolutePath, "TENDER247");
  stats.rowsRead = rows.length;

  const client = getSupabaseAdminClient();
  const missingRows: RunWorkbookRow[] = [];

  for (const row of rows) {
    const ref = referenceNoForWorkbookRow(row);
    if (ref) stats.withReference += 1;
    else stats.blankReference += 1;

    const id = sourceTenderId(row);
    if (!id) {
      stats.errors.push(`Row missing tender id: ${row.tenderName || row.canonicalId}`);
      continue;
    }

    const portal = portalForRow(row);
    const { data: existing, error: lookupError } = await client
      .from("agenttender_tenders")
      .select("id, reference_no")
      .eq("source_portal", portal)
      .eq("source_tender_id", id)
      .maybeSingle();

    if (lookupError) {
      stats.errors.push(`${id}: lookup failed — ${lookupError.message}`);
      continue;
    }

    if (!existing) {
      stats.missingIds.push(id);
      missingRows.push(row);
      continue;
    }

    stats.matched += 1;
    const current = existing.reference_no ? String(existing.reference_no).trim() : null;
    if (current === ref || (current == null && ref == null)) {
      stats.unchanged += 1;
      continue;
    }

    const { error: updateError } = await client
      .from("agenttender_tenders")
      .update({ reference_no: ref, updated_at: new Date().toISOString() })
      .eq("id", existing.id);

    if (updateError) {
      stats.errors.push(`${id}: update failed — ${updateError.message}`);
      continue;
    }
    stats.updated += 1;
  }

  if (missingRows.length > 0) {
    const logger = new Logger("./logs", "BackfillReferenceNo");
    const persist = await persistGptScreenedWorkbookToDatabase({
      rows: missingRows,
      runDate: fileInfo.runDate,
      dateFolder: path.dirname(absolutePath),
      screenedWorkbookPath: absolutePath,
      companyId: resolveRunCompanyId(),
      logger,
      screeningSource: "REFERENCE_NO_BACKFILL",
    });
    stats.inserted = persist.created;
    if (persist.errors.length > 0) {
      stats.errors.push(...persist.errors.slice(0, 20));
    }
  }

  return stats;
}

function printStats(stats: FileStats): void {
  console.log(`\n${stats.label}`);
  console.log(`Path: ${stats.path}`);
  console.log(`Rows read: ${stats.rowsRead}`);
  console.log(`Rows with Reference No.: ${stats.withReference}`);
  console.log(`Blank reference numbers: ${stats.blankReference}`);
  console.log(`Existing matched: ${stats.matched}`);
  console.log(`Reference numbers updated: ${stats.updated}`);
  console.log(`Unchanged: ${stats.unchanged}`);
  console.log(`New tenders inserted: ${stats.inserted}`);
  console.log(`Missing tender IDs (before insert): ${stats.missingIds.length}`);
  if (stats.missingIds.length > 0 && stats.missingIds.length <= 10) {
    console.log(`  ${stats.missingIds.join(", ")}`);
  }
  console.log(`Errors: ${stats.errors.length}`);
  for (const err of stats.errors.slice(0, 10)) {
    console.log(`  - ${err}`);
  }
}

async function main(): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.error("Supabase is not configured (.env).");
    process.exit(1);
  }

  const customFile = getArg("file");
  const files = customFile
    ? [
        {
          label: path.basename(customFile),
          runDate: "1970-01-01",
          relativePath: customFile,
        },
      ]
    : DEFAULT_FILES;

  const allStats: FileStats[] = [];
  for (const file of files) {
    allStats.push(await backfillFile(file));
  }

  for (const stats of allStats) {
    printStats(stats);
  }

  const total = {
    rows: allStats.reduce((n, s) => n + s.rowsRead, 0),
    updated: allStats.reduce((n, s) => n + s.updated, 0),
    inserted: allStats.reduce((n, s) => n + s.inserted, 0),
    blank: allStats.reduce((n, s) => n + s.blankReference, 0),
    errors: allStats.reduce((n, s) => n + s.errors.length, 0),
  };

  console.log("\nTOTAL");
  console.log(`Rows processed: ${total.rows}`);
  console.log(`Reference numbers populated/updated: ${total.updated + total.inserted}`);
  console.log(`Blank reference numbers: ${total.blank}`);
  console.log(`Errors: ${total.errors}`);

  if (total.errors > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

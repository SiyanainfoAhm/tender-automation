/**
 * Re-upsert Phase-1 screened Excel to Supabase, then send the screening email.
 * No Tender247 browser / ChatGPT — uses the existing date-folder workbook only.
 *
 * Usage:
 *   npm run reupsert:screening -- --date=2026-09-02
 *   npx tsx scripts/reupsert-screening-excel.ts --date=2026-09-02
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { dailyScreeningOutputFilename } from "../src/runScreening/buildDailyScreeningOperatorPrompt.js";
import {
  persistGptScreenedWorkbookToDatabase,
  assertPhase1PersistComplete,
} from "../src/runScreening/persistPhase1Results.js";
import {
  parseSourceWorkbook,
  type RunWorkbookRow,
} from "../src/runScreening/runWorkbook.js";
import {
  emptyStatusCounts,
  resolveExistingScreenedWorkbook,
} from "../src/runScreening/screeningManifest.js";
import type { Phase1ScreeningStatus } from "../src/runScreening/phase1Statuses.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "../src/supabase/client.js";
import { Logger } from "../src/logger.js";
import { resolveRunCompanyId } from "../src/company/siyanaCompany.js";
import { notifyAfterScreeningAndUpsert } from "../src/notify/sendScreeningRunNotify.js";
import { resolveRequestedDate } from "../src/cli/requestedDate.js";

function countStatuses(
  rows: RunWorkbookRow[],
): Record<Phase1ScreeningStatus, number> {
  const counts = emptyStatusCounts();
  for (const row of rows) {
    if (row.screeningStatus) counts[row.screeningStatus] += 1;
  }
  return counts;
}

async function countSupabaseForDate(runDate: string): Promise<number> {
  const client = getSupabaseAdminClient();
  const { count, error } = await client
    .from("agenttender_tenders")
    .select("id", { count: "exact", head: true })
    .eq("source_portal", "TENDER247")
    .eq("scraped_date", runDate);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function main(): Promise<void> {
  let runDate: string;
  try {
    const resolved = resolveRequestedDate(process.argv, {
      requireExplicit: true,
    });
    runDate = resolved.requestedDate;
    console.log(`REQUESTED_DATE=${runDate} source=${resolved.source}`);
  } catch (error) {
    console.error(
      "Usage: npm run reupsert:screening -- --date=YYYY-MM-DD",
    );
    console.error(
      "  (Windows/npm: --date is also read from npm_config_date)",
    );
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (!isSupabaseConfigured()) {
    console.error("Supabase not configured in .env");
    process.exit(1);
  }

  const dateFolder = path.join(process.cwd(), "downloads", runDate);
  const dailyName = dailyScreeningOutputFilename(runDate);
  const dailyPath = path.join(dateFolder, "screening", dailyName);
  const excelPath =
    resolveExistingScreenedWorkbook(dateFolder, runDate) ||
    (fs.existsSync(dailyPath) ? dailyPath : null);

  if (!excelPath) {
    console.error(
      `No screened Excel found under ${path.join(dateFolder, "screening")}`,
    );
    process.exit(1);
  }

  const logger = new Logger("./logs", "ReupsertScreening");

  const rows = parseSourceWorkbook(excelPath, "TENDER247");
  const counts = countStatuses(rows);
  console.log(`EXCEL_PATH=${excelPath}`);
  console.log(`EXCEL_ROWS=${rows.length}`);

  const before = await countSupabaseForDate(runDate);
  console.log(`SUPABASE_BEFORE scraped_date=${runDate} count=${before}`);

  const result = await persistGptScreenedWorkbookToDatabase({
    rows,
    runDate,
    dateFolder,
    screenedWorkbookPath: excelPath,
    companyId: resolveRunCompanyId(),
    logger,
    screeningSource: "REUPSERT_DAILY_EXCEL",
  });

  const after = await countSupabaseForDate(runDate);
  console.log(
    `PERSIST attempted=${result.attempted} stored=${result.stored} skipped=${result.skipped} created=${result.created} updated=${result.updated}`,
  );
  console.log(`SUPABASE_AFTER scraped_date=${runDate} count=${after}`);

  if (result.errors.length > 0) {
    console.log(`ERRORS (${result.errors.length}):`);
    for (const err of result.errors) console.log(`  ${err}`);
  }

  assertPhase1PersistComplete(result, rows.length);
  console.log("REUPSERT_OK=true");

  // Excel is authoritative on reupsert (no live Fresh badge).
  const notify = await notifyAfterScreeningAndUpsert({
    dateIso: runDate,
    dateFolder,
    webTenderCount: rows.length,
    excelRowCount: rows.length,
    screenedRowCount: rows.length,
    counts,
    screenedWorkbookPath: excelPath,
    logger,
  });
  console.log(`NOTIFY_EMAIL_KIND=${notify.kind}`);
  console.log(`NOTIFY_EMAIL_OK=${notify.emailOk}`);
  if (notify.error) console.log(`NOTIFY_EMAIL_ERROR=${notify.error}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

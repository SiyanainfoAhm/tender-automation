/**
 * Re-upsert Phase-1 screened Excel to Supabase and verify row counts match.
 * Usage: npx tsx scripts/reupsert-screening-excel.ts --date=2026-08-30
 */
import "dotenv/config";
import path from "node:path";
import { dailyScreeningOutputFilename } from "../src/runScreening/buildDailyScreeningOperatorPrompt.js";
import { persistGptScreenedWorkbookToDatabase, assertPhase1PersistComplete } from "../src/runScreening/persistPhase1Results.js";
import { parseSourceWorkbook } from "../src/runScreening/runWorkbook.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "../src/supabase/client.js";
import { Logger } from "../src/logger.js";
import { resolveRunCompanyId } from "../src/company/siyanaCompany.js";

function parseArg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
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
  const runDate = parseArg("date");
  if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    console.error("Usage: npx tsx scripts/reupsert-screening-excel.ts --date=YYYY-MM-DD");
    process.exit(1);
  }

  if (!isSupabaseConfigured()) {
    console.error("Supabase not configured in .env");
    process.exit(1);
  }

  const dailyName = dailyScreeningOutputFilename(runDate);
  const excelPath = path.join(
    process.cwd(),
    "downloads",
    runDate,
    "screening",
    dailyName,
  );
  const dateFolder = path.join(process.cwd(), "downloads", runDate);
  const logger = new Logger("./logs", "ReupsertScreening");

  const rows = parseSourceWorkbook(excelPath, "TENDER247");
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
  console.log(`PERSIST attempted=${result.attempted} stored=${result.stored} skipped=${result.skipped} created=${result.created} updated=${result.updated}`);
  console.log(`SUPABASE_AFTER scraped_date=${runDate} count=${after}`);

  if (result.errors.length > 0) {
    console.log(`ERRORS (${result.errors.length}):`);
    for (const err of result.errors) console.log(`  ${err}`);
  }

  assertPhase1PersistComplete(result, rows.length);
  console.log("REUPSERT_OK=true");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

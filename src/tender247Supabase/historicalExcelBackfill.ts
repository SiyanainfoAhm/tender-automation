/**
 * Supabase-only historical Excel backfill.
 *
 * Existing tender table: agenttender_tenders
 * Existing conflict/upsert key: source_portal,source_tender_id
 * Existing date field: scraped_date (+ raw_metadata.runDate)
 * Existing sheet/batch field: none historically — store excelSheetName / sheetDates in raw_metadata
 *
 * Skips sheets: final, 24, 21 22 23 (already stored for 21–24 Aug 2026).
 * Does NOT launch browser / Tender247 / AI screening.
 *
 * Usage:
 *   npm run tender:backfill-supabase -- "C:\path\file.xlsx" --dry-run
 *   npm run tender:backfill-supabase -- "C:\path\file.xlsx"
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getArgOrNpmConfig,
  hasBooleanFlag,
} from "../prescreen/prescreenBackfillArgs.js";
import {
  PROTECTED_SCRAPED_DATES,
  parseDatesFromSheetName,
} from "./excelSheetMeta.js";
import {
  readHistoricalWorkbook,
  type HistoricalTenderRow,
} from "./excelSheetParser.js";
import { upsertHistoricalTenders } from "./historicalUpsert.js";

export type BackfillReport = {
  workbook: string;
  dryRun: boolean;
  sheetsDetected: number;
  skippedSheets: Array<{ name: string; reason: string }>;
  processedSheets: Array<{ name: string; rows: number; valid: number; invalid: number }>;
  rowsRead: number;
  validRows: number;
  invalidRows: number;
  internalDuplicates: number;
  supabaseUpserted: number;
  skippedProtectedExisting: number;
  supabaseErrors: number;
  errors: string[];
  datesBackfilled: string[];
  sampleRows: HistoricalTenderRow[];
};

function dedupeRows(rows: HistoricalTenderRow[]): {
  unique: HistoricalTenderRow[];
  duplicates: number;
} {
  const map = new Map<string, HistoricalTenderRow>();
  let duplicates = 0;
  for (const row of rows) {
    const key = `${row.sourcePortal}::${row.sourceTenderId}`;
    if (map.has(key)) {
      duplicates += 1;
      // Prefer row that already has a reason / richer title
      const prev = map.get(key)!;
      if (
        (row.screeningReason && !prev.screeningReason) ||
        (row.title.length > prev.title.length && row.qualificationStatus)
      ) {
        map.set(key, row);
      }
      continue;
    }
    map.set(key, row);
  }
  return { unique: [...map.values()], duplicates };
}

function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${String(d).padStart(2, "0")} ${months[(m || 1) - 1]} ${y}`;
}

export async function backfillHistoricalTenderExcelToSupabase(
  filePath: string,
  options?: { dryRun?: boolean },
): Promise<BackfillReport> {
  const dryRun = Boolean(options?.dryRun);
  const absolute = path.resolve(filePath);
  const { sheetNames, sheets } = readHistoricalWorkbook(absolute);

  const skippedSheets: BackfillReport["skippedSheets"] = [];
  const processedSheets: BackfillReport["processedSheets"] = [];
  const allValid: HistoricalTenderRow[] = [];
  let rowsRead = 0;
  let invalidRows = 0;

  for (const sheet of sheets) {
    if (sheet.skipped) {
      skippedSheets.push({
        name: sheet.sheetName,
        reason: sheet.skipReason || "skipped",
      });
      continue;
    }
    rowsRead += sheet.rowsRead;
    invalidRows += sheet.invalidRows.length;
    processedSheets.push({
      name: sheet.sheetName,
      rows: sheet.rowsRead,
      valid: sheet.validRows.length,
      invalid: sheet.invalidRows.length,
    });
    allValid.push(...sheet.validRows);
  }

  const { unique, duplicates } = dedupeRows(allValid);

  console.log("=================================================");
  console.log("Historical Tender → Supabase Backfill");
  console.log("=================================================");
  console.log("");
  console.log(`Workbook:\n${path.basename(absolute)}`);
  console.log("");
  console.log(`Sheets detected: ${sheetNames.length}`);
  console.log("");
  console.log("Existing tender table: agenttender_tenders");
  console.log("Existing conflict/upsert key: source_portal,source_tender_id");
  console.log("Existing date field: scraped_date (+ raw_metadata.runDate)");
  console.log(
    "Existing sheet/batch field: raw_metadata.excelSheetName / sheetDates (new for historical)",
  );
  console.log("");
  console.log("Skipped:");
  for (const s of skippedSheets) {
    console.log(`- ${s.name}  (${s.reason})`);
  }
  if (skippedSheets.length === 0) console.log("- (none)");
  console.log("");
  console.log("Processed:");
  for (const s of processedSheets) {
    console.log(
      `- ${s.name.padEnd(16)} ${String(s.valid).padStart(4)} valid / ${s.rows} read (${s.invalid} invalid)`,
    );
  }
  console.log("");
  console.log(`Target Supabase table: agenttender_tenders`);
  console.log(`Rows to upsert: ${unique.length}`);
  console.log(`Excluded dates: 21, 22, 23, 24 Aug 2026`);
  console.log(`Mode: ${dryRun ? "DRY-RUN (no writes)" : "IMPORT"}`);
  console.log("");

  if (dryRun && unique.length > 0) {
    console.log("Sample normalized rows:");
    for (const row of unique.slice(0, 5)) {
      console.log(
        JSON.stringify(
          {
            sourcePortal: row.sourcePortal,
            sourceTenderId: row.sourceTenderId,
            scrapedDate: row.scrapedDate,
            excelSheetName: row.excelSheetName,
            status: row.qualificationStatus,
            title: row.title.slice(0, 80),
            closingDate: row.closingDate,
            tenderValue: row.tenderValue,
            emdAmount: row.emdAmount,
          },
          null,
          2,
        ),
      );
    }
    console.log("");
  }

  const upsert = await upsertHistoricalTenders(unique, {
    dryRun,
    logger: {
      info: (m) => console.log(m),
      warn: (m) => console.warn(m),
    },
  });

  const datesBackfilled = [
    ...new Set(unique.map((r) => r.scrapedDate)),
  ].sort();

  console.log("-------------------------------------------------");
  console.log(`Rows read:             ${rowsRead}`);
  console.log(`Valid rows:            ${allValid.length}`);
  console.log(`Invalid/skipped:       ${invalidRows}`);
  console.log(`Internal duplicates:   ${duplicates}`);
  console.log(
    `Supabase upserted:     ${upsert.upserted}${dryRun ? " (dry-run count)" : ""}`,
  );
  console.log(`Protected existing skip: ${upsert.skippedProtected}`);
  console.log(`Supabase errors:       ${upsert.errors.length}`);
  console.log("-------------------------------------------------");
  console.log("");
  console.log("Dates backfilled:");
  for (const d of datesBackfilled) {
    console.log(`${formatDayLabel(d)} → OK`);
  }
  console.log("");
  console.log("Already stored:");
  for (const d of PROTECTED_SCRAPED_DATES) {
    console.log(`${formatDayLabel(d)} → SKIPPED`);
  }
  console.log("");
  if (upsert.errors.length > 0) {
    console.log("Errors:");
    for (const e of upsert.errors.slice(0, 20)) console.log(`- ${e}`);
    if (upsert.errors.length > 20) {
      console.log(`… +${upsert.errors.length - 20} more`);
    }
    console.log("");
  }
  console.log(dryRun ? "DRY-RUN COMPLETE" : "BACKFILL COMPLETE");
  console.log("=================================================");

  return {
    workbook: absolute,
    dryRun,
    sheetsDetected: sheetNames.length,
    skippedSheets,
    processedSheets,
    rowsRead,
    validRows: allValid.length,
    invalidRows,
    internalDuplicates: duplicates,
    supabaseUpserted: upsert.upserted,
    skippedProtectedExisting: upsert.skippedProtected,
    supabaseErrors: upsert.errors.length,
    errors: upsert.errors,
    datesBackfilled,
    sampleRows: unique.slice(0, 5),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = hasBooleanFlag(argv, "dry-run");
  const fileArg =
    argv.find((a) => !a.startsWith("--") && a.toLowerCase().endsWith(".xlsx")) ||
    getArgOrNpmConfig(argv, "file") ||
    getArgOrNpmConfig(argv, "excel") ||
    null;

  if (!fileArg) {
    console.error(
      'Usage: npm run tender:backfill-supabase -- "C:\\path\\workbook.xlsx" [--dry-run]',
    );
    process.exit(2);
  }

  const report = await backfillHistoricalTenderExcelToSupabase(fileArg, {
    dryRun,
  });
  if (report.supabaseErrors > 0) process.exit(1);
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

// re-export for tests
export { parseDatesFromSheetName };

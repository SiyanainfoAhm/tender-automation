/**
 * Backfill closing_date + emd_amount/emd_text from screened Excel Deadline/EMD.
 *
 * Usage:
 *   npx tsx scripts/backfillDeadlineEmdFromExcel.ts --date=2026-08-23
 */
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { getSupabaseAdminClient, isSupabaseConfigured } from "../src/supabase/client.js";
import { parsePortalDate } from "../src/supabase/tenderMetadataMap.js";
import { parsePhase1Amount } from "../src/runScreening/phase1DecisionGuard.js";
import {
  readRunWorkbook,
  RUN_SCREENED_FILE,
} from "../src/runScreening/runWorkbook.js";
import { parseTender247DailyExcelRows } from "../src/tender247Batch/parseDailyExcelRows.js";

loadEnv({ path: path.resolve(process.cwd(), ".env") });

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : null;
}

type DeadlineEmdRow = {
  sourceTenderId: string;
  closingDate: string | null;
  emdAmount: number | null;
  emdText: string | null;
};

function loadFromScreened(dateIso: string): Map<string, DeadlineEmdRow> {
  const map = new Map<string, DeadlineEmdRow>();
  const screenedPath = path.join(
    process.cwd(),
    "downloads",
    dateIso,
    "screening",
    RUN_SCREENED_FILE,
  );
  if (!fs.existsSync(screenedPath)) {
    console.warn(`SCREENED_EXCEL_MISSING=${screenedPath}`);
    return map;
  }
  const rows = readRunWorkbook(screenedPath);
  for (const row of rows) {
    const id = String(row.tender247Id || row.bidAssistId || "")
      .replace(/^T247-/i, "")
      .replace(/\D/g, "");
    if (!id) continue;
    map.set(id, {
      sourceTenderId: id,
      closingDate: parsePortalDate(row.deadline),
      emdAmount: parsePhase1Amount(row.emdAmount),
      emdText: row.emdAmount?.trim() || null,
    });
  }
  console.log(`SCREENED_ROWS_LOADED=${map.size} path=${screenedPath}`);
  return map;
}

function mergeMasterExcel(
  dateIso: string,
  map: Map<string, DeadlineEmdRow>,
): void {
  const candidates = [
    path.join(process.cwd(), "downloads", dateIso, "screening", `Tender247_${dateIso}.xlsx`),
    path.join(process.cwd(), "downloads", dateIso, "accounts", "env-1", `Tender247_${dateIso}.xlsx`),
    path.join(process.cwd(), "downloads", dateIso, "accounts", "env-2", `Tender247_${dateIso}.xlsx`),
  ];
  for (const excelPath of candidates) {
    if (!fs.existsSync(excelPath)) continue;
    try {
      const parsed = parseTender247DailyExcelRows(excelPath);
      let filled = 0;
      for (const row of parsed.rows) {
        const id = String(row.sourceTenderId || "").replace(/\D/g, "");
        if (!id) continue;
        const existing = map.get(id) || {
          sourceTenderId: id,
          closingDate: null,
          emdAmount: null,
          emdText: null,
        };
        const deadline = parsePortalDate(row.deadline) || existing.closingDate;
        const emdText =
          row.rawEmd != null && String(row.rawEmd).trim()
            ? String(row.rawEmd).trim()
            : existing.emdText;
        const emdAmount =
          parsePhase1Amount(emdText) ?? existing.emdAmount;
        if (
          deadline !== existing.closingDate ||
          emdAmount !== existing.emdAmount ||
          emdText !== existing.emdText
        ) {
          filled += 1;
        }
        map.set(id, {
          sourceTenderId: id,
          closingDate: deadline,
          emdAmount,
          emdText,
        });
      }
      console.log(
        `MASTER_EXCEL_MERGED path=${excelPath} rows=${parsed.rows.length} touched=${filled}`,
      );
    } catch (error) {
      console.warn(
        `MASTER_EXCEL_SKIP path=${excelPath} error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const dateIso = getArg("date") || "2026-08-23";
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured in .env");
  }
  const client = getSupabaseAdminClient();
  const byId = loadFromScreened(dateIso);
  mergeMasterExcel(dateIso, byId);
  if (byId.size === 0) {
    throw new Error(`No deadline/EMD rows found for ${dateIso}`);
  }

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  const errors: string[] = [];

  for (const row of byId.values()) {
    if (!row.closingDate && row.emdAmount == null && !row.emdText) {
      skipped += 1;
      continue;
    }
    const { data: existing, error: findError } = await client
      .from("agenttender_tenders")
      .select("id, closing_date, emd_amount, emd_text, bid_submission_date")
      .eq("source_portal", "TENDER247")
      .eq("source_tender_id", row.sourceTenderId)
      .maybeSingle();
    if (findError) {
      errors.push(`${row.sourceTenderId}: ${findError.message}`);
      continue;
    }
    if (!existing) {
      missing += 1;
      continue;
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    // Prefer Excel deadline whenever present (fixes null / dirty scrape dates).
    if (row.closingDate) {
      patch.closing_date = row.closingDate;
      if (!existing.bid_submission_date) {
        patch.bid_submission_date = row.closingDate;
      }
    }
    if (row.emdAmount != null) {
      patch.emd_amount = row.emdAmount;
    }
    if (row.emdText) {
      patch.emd_text = row.emdText;
    }

    const unchanged =
      (patch.closing_date == null ||
        patch.closing_date === existing.closing_date) &&
      (patch.emd_amount == null || patch.emd_amount === existing.emd_amount) &&
      (patch.emd_text == null || patch.emd_text === existing.emd_text);
    if (unchanged) {
      skipped += 1;
      continue;
    }

    const { error: updateError } = await client
      .from("agenttender_tenders")
      .update(patch)
      .eq("id", existing.id);
    if (updateError) {
      errors.push(`${row.sourceTenderId}: ${updateError.message}`);
      continue;
    }
    updated += 1;
  }

  console.log(`DEADLINE_EMD_BACKFILL_DATE=${dateIso}`);
  console.log(`DEADLINE_EMD_BACKFILL_UPDATED=${updated}`);
  console.log(`DEADLINE_EMD_BACKFILL_SKIPPED=${skipped}`);
  console.log(`DEADLINE_EMD_BACKFILL_MISSING_DB=${missing}`);
  console.log(`DEADLINE_EMD_BACKFILL_ERRORS=${errors.length}`);
  if (errors.length) {
    for (const err of errors.slice(0, 20)) console.error(err);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import fs from "node:fs";
import path from "node:path";

import { getSupabaseAdminClient, isSupabaseConfigured } from "../supabase/client.js";
import {
  authorityBriefDeadlineKey,
  type HistoricalTenderIndex,
  type HistoricalTenderRecord,
  isValidReferenceNumber,
  normalizeTender247Id,
  referenceKey,
} from "./duplicateScreening.js";
import { readRunWorkbook } from "./runWorkbook.js";
import { RUN_SCREENED_FILE } from "./runWorkbook.js";

function shiftIsoDate(iso: string, days: number): string {
  const base = new Date(`${iso.slice(0, 10)}T12:00:00+05:30`);
  base.setTime(base.getTime() + days * 86_400_000);
  return base.toISOString().slice(0, 10);
}

function registerRecord(
  index: HistoricalTenderIndex,
  record: HistoricalTenderRecord,
): void {
  const t247 = normalizeTender247Id(record.tender247Id);
  if (t247 && !index.byTender247Id.has(t247)) {
    index.byTender247Id.set(t247, record);
  }
  const ref = referenceKey(record.referenceNumber);
  if (ref && !index.byReference.has(ref)) {
    index.byReference.set(ref, record);
  }
  const abd = authorityBriefDeadlineKey(record);
  if (abd && !index.byAuthorityBriefDeadline.has(abd)) {
    index.byAuthorityBriefDeadline.set(abd, record);
  }
}

function emptyIndex(): HistoricalTenderIndex {
  return {
    byTender247Id: new Map(),
    byReference: new Map(),
    byAuthorityBriefDeadline: new Map(),
  };
}

async function loadHistoryFromSupabase(options: {
  runDateIso: string;
  lookbackDays: number;
}): Promise<HistoricalTenderIndex> {
  const index = emptyIndex();
  if (!isSupabaseConfigured()) return index;

  const fromDate = shiftIsoDate(options.runDateIso, -options.lookbackDays);
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("agenttender_tenders")
    .select(
      "source_tender_id, title, organization, closing_date, scraped_date, raw_metadata",
    )
    .eq("source_portal", "TENDER247")
    .gte("scraped_date", fromDate)
    .lte("scraped_date", options.runDateIso);

  if (error) {
    console.warn(`SCREENING_HISTORY_LOAD_FAILED=${error.message}`);
    return index;
  }

  for (const row of data || []) {
    const tender247Id = normalizeTender247Id(row.source_tender_id);
    if (!tender247Id) continue;
    const meta = (row.raw_metadata || {}) as Record<string, unknown>;
    const phase1 = (meta.phase1Screening || {}) as Record<string, unknown>;
    const referenceNumber =
      typeof phase1.referenceNumber === "string"
        ? phase1.referenceNumber
        : typeof meta.referenceNumber === "string"
          ? meta.referenceNumber
          : null;
    registerRecord(index, {
      tender247Id,
      referenceNumber:
        referenceNumber && isValidReferenceNumber(referenceNumber)
          ? referenceNumber
          : null,
      organization: String(row.organization || ""),
      tenderName: String(row.title || ""),
      deadline: String(row.closing_date || ""),
      runDate: String(row.scraped_date || options.runDateIso).slice(0, 10),
    });
  }

  return index;
}

function loadHistoryFromLocalScreenedWorkbooks(options: {
  runDateIso: string;
  lookbackDays: number;
  downloadsRoot: string;
}): HistoricalTenderIndex {
  const index = emptyIndex();
  const root = path.resolve(options.downloadsRoot);
  if (!fs.existsSync(root)) return index;

  const fromDate = shiftIsoDate(options.runDateIso, -options.lookbackDays);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runDate = entry.name.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) continue;
    if (runDate < fromDate || runDate > options.runDateIso) continue;
    const screenedPath = path.join(root, runDate, "screening", RUN_SCREENED_FILE);
    if (!fs.existsSync(screenedPath)) continue;
    try {
      const rows = readRunWorkbook(screenedPath);
      for (const row of rows) {
        const tender247Id = normalizeTender247Id(row.tender247Id);
        if (!tender247Id) continue;
        registerRecord(index, {
          tender247Id,
          referenceNumber: isValidReferenceNumber(row.bidAssistId)
            ? String(row.bidAssistId).trim()
            : null,
          organization: row.organization,
          tenderName: row.tenderName,
          deadline: row.deadline,
          runDate,
        });
      }
    } catch {
      // ignore unreadable local history
    }
  }
  return index;
}

export async function loadScreeningHistoryIndex(options: {
  runDateIso: string;
  lookbackDays?: number;
  downloadsRoot?: string;
}): Promise<HistoricalTenderIndex> {
  const lookbackDays = options.lookbackDays ?? 30;
  const downloadsRoot =
    options.downloadsRoot || path.join(process.cwd(), "downloads");
  const remote = await loadHistoryFromSupabase({
    runDateIso: options.runDateIso,
    lookbackDays,
  });
  const local = loadHistoryFromLocalScreenedWorkbooks({
    runDateIso: options.runDateIso,
    lookbackDays,
    downloadsRoot,
  });

  const merged = emptyIndex();
  for (const record of local.byTender247Id.values()) {
    registerRecord(merged, record);
  }
  for (const record of remote.byTender247Id.values()) {
    registerRecord(merged, record);
  }
  return merged;
}

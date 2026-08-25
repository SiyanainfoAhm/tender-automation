/**
 * Batch upsert historical tender rows into agenttender_tenders.
 *
 * Existing tender table: agenttender_tenders
 * Existing conflict/upsert key: source_portal,source_tender_id
 * Existing date field: scraped_date (+ raw_metadata.runDate)
 * Existing sheet/batch field: none historically — use raw_metadata.excelSheetName / sheetDates
 */
import { getSupabaseAdminClient, isSupabaseConfigured } from "../supabase/client.js";
import { upsertQualificationResult } from "../supabase/qualificationResultStore.js";
import { PHASE1_STATUS_DISPLAY } from "../runScreening/phase1Statuses.js";
import { PHASE1_SCREENING_POLICY_VERSION } from "../runScreening/screeningPolicy.js";
import { resolveRunCompanyId } from "../company/siyanaCompany.js";
import {
  PROTECTED_SCRAPED_DATE_SET,
} from "./excelSheetMeta.js";
import type { HistoricalTenderRow } from "./excelSheetParser.js";

export const UPSERT_BATCH_SIZE = 250;

export type HistoricalUpsertResult = {
  attempted: number;
  upserted: number;
  skippedProtected: number;
  errors: string[];
};

function qualificationPayload(row: HistoricalTenderRow) {
  const status = row.qualificationStatus;
  const label = PHASE1_STATUS_DISPLAY[status];
  const reason = row.screeningReason || "Historical Excel backfill";
  if (status === "NO_GO") {
    return {
      status: "NO_GO" as const,
      decisionLabel: label,
      verdict: "NO_GO",
      reason,
      requiredAction: null as string | null,
      confidence: 0.5,
      matchedCriteria: [] as string[],
      failedCriteria: reason ? [reason] : ["Historical NO_GO"],
      unclearCriteria: [] as string[],
      missingDocuments: [] as string[],
      manualReviewRequired: false,
    };
  }
  if (status === "VERIFY" || status === "CONDITIONAL_GO" || status === "PARTNER_BID") {
    return {
      status,
      decisionLabel: label,
      verdict: status,
      reason,
      requiredAction: "Review historical screened tender",
      confidence: 0.55,
      matchedCriteria: [] as string[],
      failedCriteria: [] as string[],
      unclearCriteria: reason ? [reason] : [],
      missingDocuments: [] as string[],
      manualReviewRequired: true,
    };
  }
  return {
    status: "GO" as const,
    decisionLabel: label,
    verdict: "GO",
    reason,
    requiredAction: "Start bid preparation",
    confidence: 0.6,
    matchedCriteria: reason ? [reason] : ["Historical Will Bid"],
    failedCriteria: [] as string[],
    unclearCriteria: [] as string[],
    missingDocuments: [] as string[],
    manualReviewRequired: false,
  };
}

function toDbRow(row: HistoricalTenderRow, companyId: string, now: string) {
  const rawMetadata = {
    phase1Screening: true,
    screeningSource: "HISTORICAL_EXCEL_BACKFILL",
    excelSheetName: row.excelSheetName,
    sheetDates: row.sheetDates,
    runDate: row.scrapedDate,
    screeningStatus: row.qualificationStatus,
    screeningReason: row.screeningReason,
    companyId,
    tenderCategory: row.tenderCategory,
    msmeExemption: row.msmeExemption,
    startupExemption: row.startupExemption,
  };

  return {
    source_portal: row.sourcePortal,
    source_tender_id: row.sourceTenderId,
    folder_id: row.folderId,
    title: row.title,
    organization: row.organization,
    location_text: row.locationText,
    closing_date: row.closingDate,
    bid_submission_date: row.closingDate,
    tender_value: row.tenderValue,
    tender_value_text: row.tenderValueText,
    emd_text: row.emdText,
    emd_amount: row.emdAmount,
    currency: "INR",
    qualification_status: row.qualificationStatus,
    category: row.tenderCategory,
    project_category: "Other",
    raw_metadata: rawMetadata,
    metadata_version: 1,
    content_hash: `historical-excel:${row.sourcePortal}:${row.sourceTenderId}:${row.scrapedDate}:${row.qualificationStatus}`,
    last_seen_at: now,
    supabase_synced_at: now,
    scraped_date: row.scrapedDate,
    download_status: "DISCOVERED",
    ai_summary_available: false,
    document_archive_available: false,
    local_folder_path: null,
    crawled_at: null,
  };
}

async function filterProtectedExisting(
  rows: HistoricalTenderRow[],
): Promise<{ toUpsert: HistoricalTenderRow[]; skippedProtected: number }> {
  if (rows.length === 0) return { toUpsert: [], skippedProtected: 0 };
  const client = getSupabaseAdminClient();
  const byPortal = new Map<string, string[]>();
  for (const row of rows) {
    const list = byPortal.get(row.sourcePortal) || [];
    list.push(row.sourceTenderId);
    byPortal.set(row.sourcePortal, list);
  }

  const protectedKeys = new Set<string>();
  for (const [portal, ids] of byPortal) {
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      const { data, error } = await client
        .from("agenttender_tenders")
        .select("source_portal, source_tender_id, scraped_date")
        .eq("source_portal", portal)
        .in("source_tender_id", chunk);
      if (error) throw new Error(error.message);
      for (const row of data || []) {
        const scraped = row.scraped_date ? String(row.scraped_date).slice(0, 10) : "";
        if (PROTECTED_SCRAPED_DATE_SET.has(scraped)) {
          protectedKeys.add(`${row.source_portal}::${row.source_tender_id}`);
        }
      }
    }
  }

  const toUpsert: HistoricalTenderRow[] = [];
  let skippedProtected = 0;
  for (const row of rows) {
    const key = `${row.sourcePortal}::${row.sourceTenderId}`;
    if (protectedKeys.has(key)) {
      skippedProtected += 1;
      continue;
    }
    // Also never write protected scraped_date values from this backfill
    if (PROTECTED_SCRAPED_DATE_SET.has(row.scrapedDate)) {
      skippedProtected += 1;
      continue;
    }
    toUpsert.push(row);
  }
  return { toUpsert, skippedProtected };
}

export async function upsertHistoricalTenders(
  rows: HistoricalTenderRow[],
  options?: { dryRun?: boolean; logger?: { info: (m: string) => void; warn?: (m: string) => void } },
): Promise<HistoricalUpsertResult> {
  const result: HistoricalUpsertResult = {
    attempted: rows.length,
    upserted: 0,
    skippedProtected: 0,
    errors: [],
  };
  if (rows.length === 0) return result;

  if (!isSupabaseConfigured()) {
    result.errors.push("Supabase is not configured");
    return result;
  }

  const { toUpsert, skippedProtected } = await filterProtectedExisting(rows);
  result.skippedProtected = skippedProtected;
  options?.logger?.info(
    `PROTECTED_EXISTING_SKIPPED=${skippedProtected} TO_UPSERT=${toUpsert.length}`,
  );

  if (options?.dryRun) {
    result.upserted = toUpsert.length;
    return result;
  }

  const client = getSupabaseAdminClient();
  const companyId = resolveRunCompanyId();
  const now = new Date().toISOString();

  for (let i = 0; i < toUpsert.length; i += UPSERT_BATCH_SIZE) {
    const batch = toUpsert.slice(i, i + UPSERT_BATCH_SIZE);
    const batchNo = Math.floor(i / UPSERT_BATCH_SIZE) + 1;
    const payload = batch.map((row) => toDbRow(row, companyId, now));
    const { error } = await client.from("agenttender_tenders").upsert(payload, {
      onConflict: "source_portal,source_tender_id",
    });
    if (error) {
      const ids = batch.map((r) => r.sourceTenderId).slice(0, 12).join(",");
      const msg = `batch=${batchNo} error=${error.message} ids=${ids}`;
      result.errors.push(msg);
      options?.logger?.warn?.(msg);
      continue;
    }
    result.upserted += batch.length;

    // Mirror Phase-1 qualification rows (best-effort; do not fail whole batch).
    for (const row of batch) {
      const qual = qualificationPayload(row);
      const upserted = await upsertQualificationResult({
        sourcePortal: row.sourcePortal,
        sourceTenderId: row.sourceTenderId,
        status: qual.status,
        decisionLabel: qual.decisionLabel,
        verdict: qual.verdict,
        reason: qual.reason,
        requiredAction: qual.requiredAction,
        confidence: qual.confidence,
        matchedCriteria: qual.matchedCriteria,
        failedCriteria: qual.failedCriteria,
        unclearCriteria: qual.unclearCriteria,
        missingDocuments: qual.missingDocuments,
        conditions: [],
        partnershipRequiredFor: [],
        partnershipModeAllowed: [],
        manualReviewRequired: qual.manualReviewRequired,
        requiresDetailedTenderReview:
          qual.status !== "GO" && qual.status !== "NO_GO",
        evidenceFiles: ["HISTORICAL_EXCEL_BACKFILL", row.excelSheetName],
        rawResponse: row.screeningReason || qual.reason || "Historical Excel backfill",
        rawResult: {
          excelSheetName: row.excelSheetName,
          sheetDates: row.sheetDates,
          scrapedDate: row.scrapedDate,
        },
        chatUrl: null,
        promptVersion: PHASE1_SCREENING_POLICY_VERSION,
        modelName: "historical-excel-backfill",
      });
      if (!upserted.ok) {
        result.errors.push(
          `${row.sourceTenderId}: qualification ${upserted.error || "upsert failed"}`,
        );
      }
    }
  }

  return result;
}

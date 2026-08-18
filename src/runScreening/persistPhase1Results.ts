/**
 * Persist Phase-1 NO_GO rows as screened-out tenders (no detail artifacts).
 */
import { getSupabaseAdminClient, isSupabaseConfigured } from "../supabase/client.js";
import { upsertQualificationResult } from "../supabase/qualificationResultStore.js";
import { resolveRunCompanyId } from "../company/siyanaCompany.js";
import type { RunWorkbookRow } from "./runWorkbook.js";
import { isPhase1NoBid, PHASE1_STATUS_DISPLAY } from "./phase1Statuses.js";

export type Phase1PersistResult = {
  attempted: number;
  stored: number;
  skipped: number;
  errors: string[];
};

function portalForRow(row: RunWorkbookRow): "TENDER247" | "BIDASSIST" {
  if (row.tender247Id) return "TENDER247";
  return "BIDASSIST";
}

function sourceTenderId(row: RunWorkbookRow): string {
  return row.tender247Id || row.bidAssistId || row.canonicalId;
}

export async function persistPhase1NoBidResults(options: {
  rows: RunWorkbookRow[];
  runDate: string;
  companyId?: string;
  logger?: { info: (msg: string) => void; warn?: (msg: string) => void };
}): Promise<Phase1PersistResult> {
  const noBid = options.rows.filter((row) => isPhase1NoBid(row.screeningStatus || null));
  const result: Phase1PersistResult = {
    attempted: noBid.length,
    stored: 0,
    skipped: 0,
    errors: [],
  };
  if (noBid.length === 0) return result;
  if (!isSupabaseConfigured()) {
    options.logger?.warn?.(
      "PHASE1_NO_BID_DB_SKIPPED=Supabase not configured (local screened workbook still retained)",
    );
    result.skipped = noBid.length;
    return result;
  }

  const client = getSupabaseAdminClient();
  const companyId = options.companyId ?? resolveRunCompanyId();
  const now = new Date().toISOString();

  for (const row of noBid) {
    const sourcePortal = portalForRow(row);
    const id = sourceTenderId(row);
    try {
      const rawMetadata = {
        phase1Screening: true,
        screeningSource: "CHATGPT_RUN_EXCEL",
        companyId,
        runDate: options.runDate,
        screeningStatus: row.screeningStatus,
        screeningReason: row.screeningReason,
        source: row.source,
      };
      const { error: tenderError } = await client.from("agenttender_tenders").upsert(
        {
          source_portal: sourcePortal,
          source_tender_id: id,
          folder_id: null,
          title: row.tenderName || id,
          organization: row.organization || null,
          location_text: row.location || null,
          closing_date: null,
          tender_value_text: row.estimatedCost || null,
          emd_text: row.emdAmount || null,
          currency: "INR",
          local_folder_path: null,
          ai_summary_available: false,
          document_archive_available: false,
          download_status: "DISCOVERED",
          qualification_status: "NO_GO",
          project_category: "Other",
          raw_metadata: rawMetadata,
          metadata_version: 1,
          content_hash: `phase1:${sourcePortal}:${id}:${options.runDate}`,
          last_seen_at: now,
          crawled_at: null,
          supabase_synced_at: now,
        },
        { onConflict: "source_portal,source_tender_id" },
      );
      if (tenderError) {
        result.errors.push(`${id}: ${tenderError.message}`);
        continue;
      }
      const upserted = await upsertQualificationResult({
        sourcePortal,
        sourceTenderId: id,
        status: "NO_GO",
        decisionLabel: PHASE1_STATUS_DISPLAY.NO_GO,
        verdict: "NO_GO",
        reason: row.screeningReason || "Phase-1 ChatGPT run Excel screening",
        requiredAction: null,
        confidence: 0.5,
        matchedCriteria: [],
        failedCriteria: row.screeningReason ? [row.screeningReason] : ["Phase-1 NO_GO"],
        unclearCriteria: [],
        missingDocuments: [],
        conditions: [],
        partnershipRequiredFor: [],
        partnershipModeAllowed: [],
        manualReviewRequired: false,
        requiresDetailedTenderReview: false,
        evidenceFiles: ["CHATGPT_RUN_EXCEL"],
        rawResponse: row.screeningReason,
        rawResult: rawMetadata,
        chatUrl: null,
        promptVersion: "phase1-run-excel-v1",
        modelName: "chatgpt-project-run-screening",
      });
      if (!upserted.ok) {
        result.errors.push(`${id}: ${upserted.error || "qualification upsert failed"}`);
        continue;
      }
      result.stored += 1;
      options.logger?.info(
        `[PHASE1] NO_BID stored ${sourcePortal} ${id} reason=${row.screeningReason}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${id}: ${message}`);
    }
  }
  return result;
}

/**
 * Persist Phase-1 GPT screened workbook → Supabase.
 * Source of truth: run-screened-siyana.xlsx (NOT a local pre-filter workbook).
 *
 * Rules:
 * - Create/update tender rows from every GPT Excel row
 * - Match by T247 ID / BidAssist ID / reference / source_tender_id
 * - Fill missing fields only; always refresh screening status + reason
 * - Upload artifacts separately after detail crawl (AI Summary optional)
 */
import path from "node:path";
import { getSupabaseAdminClient, isSupabaseConfigured } from "../supabase/client.js";
import { upsertQualificationResult } from "../supabase/qualificationResultStore.js";
import { mergeNullOnlyRecord } from "../supabase/mergeTenderNullOnly.js";
import { resolveRunCompanyId } from "../company/siyanaCompany.js";
import type { RunWorkbookRow } from "./runWorkbook.js";
import {
  isPhase1NoBid,
  normalizePhase1ScreeningStatus,
  PHASE1_STATUS_DISPLAY,
  type Phase1ScreeningStatus,
} from "./phase1Statuses.js";
import { screeningDir, writeJson } from "./screeningManifest.js";
import { runCorrelationIdForDate } from "./phase1DetailQueue.js";
import { PHASE1_SCREENING_POLICY_VERSION } from "./screeningPolicy.js";
import { RUN_SCREENED_FILE } from "./runWorkbook.js";
import { parsePhase1Amount } from "./phase1DecisionGuard.js";
import { parsePortalDate } from "../supabase/tenderMetadataMap.js";

export type Phase1PersistResult = {
  attempted: number;
  stored: number;
  skipped: number;
  created: number;
  updated: number;
  errors: string[];
};

function portalForRow(row: RunWorkbookRow): "TENDER247" | "BIDASSIST" {
  if (row.tender247Id) return "TENDER247";
  return "BIDASSIST";
}

function sourceTenderId(row: RunWorkbookRow): string {
  return row.tender247Id || row.bidAssistId || row.canonicalId;
}

function referenceCandidates(row: RunWorkbookRow): string[] {
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const text = String(value ?? "").trim();
    if (text && !out.includes(text)) out.push(text);
  };
  push(row.tender247Id);
  push(row.bidAssistId);
  push(row.canonicalId);
  for (const part of String(row.sourceRefs || "").split(/[|,;/]/)) {
    push(part);
  }
  return out;
}

function excelDeadlineIso(row: RunWorkbookRow): string | null {
  return parsePortalDate(row.deadline);
}

function excelEmdAmount(row: RunWorkbookRow): number | null {
  return parsePhase1Amount(row.emdAmount);
}

function mapScreeningToQualificationStatus(
  status: Phase1ScreeningStatus,
): Phase1ScreeningStatus {
  return status;
}

function qualificationPayloadForStatus(
  status: Phase1ScreeningStatus,
  reason: string,
) {
  const label = PHASE1_STATUS_DISPLAY[status];
  if (status === "NO_GO") {
    return {
      status: "NO_GO" as const,
      decisionLabel: label,
      verdict: "NO_GO",
      reason: reason || "Phase-1 ChatGPT run Excel screening",
      requiredAction: null as string | null,
      confidence: 0.5,
      matchedCriteria: [] as string[],
      failedCriteria: reason ? [reason] : ["Phase-1 NO_GO"],
      unclearCriteria: [] as string[],
      missingDocuments: [] as string[],
      manualReviewRequired: false,
    };
  }
  if (status === "VERIFY" || status === "CONDITIONAL_GO") {
    return {
      status,
      decisionLabel: label,
      verdict: status,
      reason: reason || "Phase-1 ChatGPT run Excel screening",
      requiredAction: "Review screened tender and continue qualification",
      confidence: 0.55,
      matchedCriteria: [] as string[],
      failedCriteria: [] as string[],
      unclearCriteria: reason ? [reason] : ["Phase-1 screening requires review"],
      missingDocuments: [] as string[],
      manualReviewRequired: true,
    };
  }
  if (status === "PARTNER_BID") {
    return {
      status,
      decisionLabel: label,
      verdict: status,
      reason: reason || "Phase-1 ChatGPT run Excel screening",
      requiredAction: "Obtain partnership approval before bid lock",
      confidence: 0.55,
      matchedCriteria: [] as string[],
      failedCriteria: [] as string[],
      unclearCriteria: [] as string[],
      missingDocuments: [] as string[],
      manualReviewRequired: true,
    };
  }
  return {
    status: "GO" as const,
    decisionLabel: label,
    verdict: "GO",
    reason: reason || "Phase-1 ChatGPT run Excel screening",
    requiredAction: "Start bid preparation",
    confidence: 0.6,
    matchedCriteria: reason ? [reason] : ["Phase-1 Will Bid"],
    failedCriteria: [] as string[],
    unclearCriteria: [] as string[],
    missingDocuments: [] as string[],
    manualReviewRequired: false,
  };
}

type ExistingTenderRow = {
  id: string;
  source_portal: string;
  source_tender_id: string;
  folder_id: string | null;
  title: string | null;
  organization: string | null;
  location_text: string | null;
  closing_date: string | null;
  tender_value_text: string | null;
  emd_text: string | null;
  qualification_status: string | null;
  raw_metadata: Record<string, unknown> | null;
};

async function findExistingTender(options: {
  client: ReturnType<typeof getSupabaseAdminClient>;
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  references: string[];
}): Promise<ExistingTenderRow | null> {
  const { client, sourcePortal, sourceTenderId, references } = options;

  const byId = await client
    .from("agenttender_tenders")
    .select(
      "id, source_portal, source_tender_id, folder_id, title, organization, location_text, closing_date, tender_value_text, emd_text, qualification_status, raw_metadata",
    )
    .eq("source_portal", sourcePortal)
    .eq("source_tender_id", sourceTenderId)
    .maybeSingle();
  if (byId.data) return byId.data as ExistingTenderRow;

  for (const reference of references) {
    if (!reference || reference === sourceTenderId) continue;
    const byFolder = await client
      .from("agenttender_tenders")
      .select(
        "id, source_portal, source_tender_id, folder_id, title, organization, location_text, closing_date, tender_value_text, emd_text, qualification_status, raw_metadata",
      )
      .eq("source_portal", sourcePortal)
      .eq("folder_id", reference)
      .maybeSingle();
    if (byFolder.data) return byFolder.data as ExistingTenderRow;

    const byAltId = await client
      .from("agenttender_tenders")
      .select(
        "id, source_portal, source_tender_id, folder_id, title, organization, location_text, closing_date, tender_value_text, emd_text, qualification_status, raw_metadata",
      )
      .eq("source_portal", sourcePortal)
      .eq("source_tender_id", reference)
      .maybeSingle();
    if (byAltId.data) return byAltId.data as ExistingTenderRow;
  }

  return null;
}

/** @deprecated Prefer persistGptScreenedWorkbookToDatabase */
export async function persistPhase1NoBidResults(options: {
  rows: RunWorkbookRow[];
  runDate: string;
  dateFolder?: string;
  screenedWorkbookPath?: string;
  companyId?: string;
  logger?: { info: (msg: string) => void; warn?: (msg: string) => void };
}): Promise<Phase1PersistResult> {
  return persistGptScreenedWorkbookToDatabase(options);
}

/**
 * Sync every row from the GPT screened workbook into agenttender_tenders.
 */
export async function persistGptScreenedWorkbookToDatabase(options: {
  rows: RunWorkbookRow[];
  runDate: string;
  dateFolder?: string;
  screenedWorkbookPath?: string;
  companyId?: string;
  logger?: { info: (msg: string) => void; warn?: (msg: string) => void };
}): Promise<Phase1PersistResult> {
  const workbookLabel =
    options.screenedWorkbookPath ||
    (options.dateFolder
      ? path.join(options.dateFolder, "screening", RUN_SCREENED_FILE)
      : RUN_SCREENED_FILE);

  options.logger?.info(`GPT_SCREENED_WORKBOOK=${workbookLabel}`);
  options.logger?.info(`GPT_ROWS_FOUND=${options.rows.length}`);

  const result: Phase1PersistResult = {
    attempted: options.rows.length,
    stored: 0,
    skipped: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  const noBid = options.rows.filter((row) =>
    isPhase1NoBid(row.screeningStatus || null),
  );
  if (options.dateFolder) {
    const runCorrelationId = runCorrelationIdForDate(options.runDate);
    writeJson(path.join(screeningDir(options.dateFolder), "phase1-no-bid-decisions.json"), {
      screeningRunId: runCorrelationId,
      source: RUN_SCREENED_FILE,
      sourcePath: options.screenedWorkbookPath ?? null,
      count: noBid.length,
      decisions: noBid.map((row) => ({
        tender247Id: row.tender247Id,
        canonicalId: row.canonicalId,
        status: "NO_BID",
        screeningReason: row.screeningReason,
        source: row.source,
        runCorrelationId,
        screeningWorkbookSource:
          options.screenedWorkbookPath ?? RUN_SCREENED_FILE,
      })),
      updatedAt: new Date().toISOString(),
    });
    writeJson(
      path.join(screeningDir(options.dateFolder), "gpt-excel-db-sync.json"),
      {
        screeningRunId: runCorrelationId,
        source: RUN_SCREENED_FILE,
        sourcePath: options.screenedWorkbookPath ?? null,
        rowCount: options.rows.length,
        updatedAt: new Date().toISOString(),
      },
    );
  }

  if (options.rows.length === 0) {
    options.logger?.info("GPT_EXCEL_DATABASE_SYNC_COMPLETE=true");
    options.logger?.info("TENDERS_UPDATED=0");
    return result;
  }

  if (!isSupabaseConfigured()) {
    options.logger?.warn?.(
      "GPT_EXCEL_DB_SKIPPED=Supabase not configured (local screened workbook still retained)",
    );
    result.skipped = options.rows.length;
    return result;
  }

  const client = getSupabaseAdminClient();
  const companyId = options.companyId ?? resolveRunCompanyId();
  const now = new Date().toISOString();

  for (const row of options.rows) {
    const status = normalizePhase1ScreeningStatus(row.screeningStatus || null);
    if (!status) {
      result.skipped += 1;
      result.errors.push(
        `${sourceTenderId(row)}: missing/invalid Screening Status`,
      );
      continue;
    }

    const sourcePortal = portalForRow(row);
    const id = sourceTenderId(row);
    const label = sourcePortal === "TENDER247" ? `T247-${id}` : id;
    const references = referenceCandidates(row);

    try {
      const existing = await findExistingTender({
        client,
        sourcePortal,
        sourceTenderId: id,
        references,
      });

      options.logger?.info(
        `[${label}] Existing record found=${Boolean(existing)}`,
      );

      const qualificationStatus = mapScreeningToQualificationStatus(status);
      const rawMetadata = {
        ...(existing?.raw_metadata &&
        typeof existing.raw_metadata === "object" &&
        !Array.isArray(existing.raw_metadata)
          ? existing.raw_metadata
          : {}),
        phase1Screening: true,
        screeningSource: "CHATGPT_RUN_EXCEL",
        screeningWorkbook: RUN_SCREENED_FILE,
        companyId,
        runDate: options.runDate,
        screeningStatus: status,
        screeningReason: row.screeningReason,
        source: row.source,
        sourceRefs: row.sourceRefs || null,
      };

      const closingDate = excelDeadlineIso(row);
      const emdAmount = excelEmdAmount(row);

      const incoming = {
        source_portal: sourcePortal,
        source_tender_id: existing?.source_tender_id || id,
        folder_id: existing?.folder_id || row.tender247Id || row.bidAssistId || null,
        title: row.tenderName || id,
        organization: row.organization || null,
        location_text: row.location || null,
        closing_date: closingDate,
        bid_submission_date: closingDate,
        tender_value_text: row.estimatedCost || null,
        emd_text: row.emdAmount || null,
        emd_amount: emdAmount,
        currency: "INR",
        qualification_status: qualificationStatus,
        project_category: "Other",
        raw_metadata: rawMetadata,
        metadata_version: 1,
        content_hash: `phase1-gpt:${sourcePortal}:${id}:${options.runDate}:${status}`,
        last_seen_at: now,
        supabase_synced_at: now,
        scraped_date: options.runDate,
        download_status: existing ? undefined : ("DISCOVERED" as const),
        ai_summary_available: existing ? undefined : false,
        document_archive_available: existing ? undefined : false,
        local_folder_path: existing ? undefined : null,
        crawled_at: existing ? undefined : null,
      };

      const alwaysUpdate: Array<keyof typeof incoming> = [
        "qualification_status",
        "raw_metadata",
        "content_hash",
        "last_seen_at",
        "supabase_synced_at",
        "scraped_date",
      ];

      const { next, updatedKeys } = mergeNullOnlyRecord(
        existing as Record<string, unknown> | null,
        incoming as Record<string, unknown>,
        alwaysUpdate as string[],
      );

      // Always force screening fields from GPT Excel.
      next.qualification_status = qualificationStatus;
      next.raw_metadata = rawMetadata;
      if (!updatedKeys.includes("qualification_status")) {
        updatedKeys.push("qualification_status");
      }

      const fieldLabels: Record<string, string> = {
        title: "Tender Title",
        organization: "Organization",
        location_text: "Location",
        tender_value_text: "Estimated Value",
        emd_text: "EMD",
        closing_date: "Deadline",
        qualification_status: "Status",
      };
      const humanUpdated = updatedKeys
        .map((key) => fieldLabels[key] || key)
        .filter((key) => key !== "raw_metadata" && key !== "content_hash");

      if (humanUpdated.length > 0) {
        options.logger?.info(
          `[${label}] Missing fields updated:\n${humanUpdated.join("\n")}`,
        );
      }
      options.logger?.info(
        `[${label}] Status updated:\n${qualificationStatus}`,
      );

      if (existing) {
        const { error: updateError } = await client
          .from("agenttender_tenders")
          .update({ ...next, updated_at: now })
          .eq("id", existing.id);
        if (updateError) {
          result.errors.push(`${id}: ${updateError.message}`);
          continue;
        }
        result.updated += 1;
      } else {
        const { error: insertError } = await client
          .from("agenttender_tenders")
          .upsert(
            {
              source_portal: sourcePortal,
              source_tender_id: id,
              folder_id: row.tender247Id || row.bidAssistId || null,
              title: row.tenderName || id,
              organization: row.organization || null,
              location_text: row.location || null,
              closing_date: excelDeadlineIso(row),
              bid_submission_date: excelDeadlineIso(row),
              tender_value_text: row.estimatedCost || null,
              emd_text: row.emdAmount || null,
              emd_amount: excelEmdAmount(row),
              currency: "INR",
              local_folder_path: null,
              ai_summary_available: false,
              document_archive_available: false,
              download_status: "DISCOVERED",
              qualification_status: qualificationStatus,
              project_category: "Other",
              raw_metadata: rawMetadata,
              metadata_version: 1,
              content_hash: incoming.content_hash,
              last_seen_at: now,
              crawled_at: null,
              supabase_synced_at: now,
              scraped_date: options.runDate,
            },
            { onConflict: "source_portal,source_tender_id" },
          );
        if (insertError) {
          result.errors.push(`${id}: ${insertError.message}`);
          continue;
        }
        result.created += 1;
      }

      const qual = qualificationPayloadForStatus(
        status,
        row.screeningReason || "",
      );
      const upserted = await upsertQualificationResult({
        sourcePortal,
        sourceTenderId: existing?.source_tender_id || id,
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
        requiresDetailedTenderReview: status !== "GO" && status !== "NO_GO",
        evidenceFiles: ["CHATGPT_RUN_EXCEL", RUN_SCREENED_FILE],
        rawResponse: row.screeningReason,
        rawResult: rawMetadata,
        chatUrl: null,
        promptVersion: PHASE1_SCREENING_POLICY_VERSION,
        modelName: "chatgpt-project-run-screening",
      });
      if (!upserted.ok) {
        result.errors.push(
          `${id}: ${upserted.error || "qualification upsert failed"}`,
        );
        continue;
      }

      result.stored += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${id}: ${message}`);
    }
  }

  options.logger?.info("GPT_EXCEL_DATABASE_SYNC_COMPLETE=true");
  options.logger?.info(`TENDERS_UPDATED=${result.stored}`);
  options.logger?.info(`TENDERS_CREATED=${result.created}`);
  options.logger?.info(`TENDERS_PATCHED=${result.updated}`);
  if (result.errors.length > 0) {
    options.logger?.warn?.(
      `GPT_EXCEL_DB_SYNC_ERRORS=${result.errors.length}`,
    );
  }

  return result;
}

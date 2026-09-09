/**
 * Persist Phase-1 GPT screened workbook → Supabase.
 * Source of truth: run-screened-siyana.xlsx (NOT a local pre-filter workbook).
 *
 * Rules:
 * - Create/update tender rows from every GPT Excel row
 * - Match by (source_portal, source_tender_id, scraped_date) — daily snapshot identity
 * - Same Tender247 ID on a new scraped_date inserts a NEW row (never moves prior dates)
 * - Historical prior-date matches → INSERT today + qualification_status DUPLICATE
 * - Fill missing fields only within the same-day snapshot; never rewrite scraped_date of another day
 */
import path from "node:path";
import { AutomationError } from "../browserUtils.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "../supabase/client.js";
import { upsertQualificationResult } from "../supabase/qualificationResultStore.js";
import { mergeNullOnlyRecord } from "../supabase/mergeTenderNullOnly.js";
import { agentQualificationStatusForDatabase } from "../supabase/persistQualification.js";
import { resolveRunCompanyId } from "../company/siyanaCompany.js";
import type { RunWorkbookRow } from "./runWorkbook.js";
import {
  isPhase1NoBid,
  isPhase1Duplicate,
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
import { referenceNoForWorkbookRow } from "../excel/referenceNumber.js";
import { parseDuplicateReferenceFromReason } from "./parseDuplicateReference.js";
import {
  isValidTender247NumericId,
  normalizeTender247Id,
} from "./duplicateScreening.js";

export type Phase1PersistResult = {
  attempted: number;
  stored: number;
  skipped: number;
  created: number;
  updated: number;
  errors: string[];
};

/** Postgres btree index on lower(title) fails above ~2704 bytes — cap indexed text. */
const INDEX_SAFE_TEXT_MAX_CHARS = 512;

function truncateForDatabaseIndex(
  value: string | null | undefined,
  maxChars = INDEX_SAFE_TEXT_MAX_CHARS,
): { text: string | null; truncated: boolean } {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { text: null, truncated: false };
  if (raw.length <= maxChars) return { text: raw, truncated: false };
  return { text: `${raw.slice(0, maxChars).trimEnd()}…`, truncated: true };
}

export function assertPhase1PersistComplete(
  result: Phase1PersistResult,
  expectedRows: number,
): void {
  const accounted = result.stored + result.skipped;
  if (accounted === expectedRows && result.errors.length === 0) return;
  throw new AutomationError(
    "PHASE1_SUPABASE_UPSERT_INCOMPLETE",
    `PHASE1_SUPABASE_UPSERT_INCOMPLETE: expected ${expectedRows} rows, stored ${result.stored}, skipped ${result.skipped}, errors ${result.errors.length}${result.errors.length ? ` — ${result.errors.slice(0, 3).join("; ")}` : ""}`,
  );
}

function portalForRow(row: RunWorkbookRow): "TENDER247" | "BIDASSIST" {
  if (row.tender247Id) return "TENDER247";
  return "BIDASSIST";
}

function sourceTenderId(row: RunWorkbookRow): string {
  if (row.tender247Id) {
    return normalizeTender247Id(row.tender247Id) || row.tender247Id;
  }
  return row.bidAssistId || row.canonicalId;
}

function referenceCandidates(row: RunWorkbookRow): string[] {
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const text = String(value ?? "").trim();
    if (text && !out.includes(text)) out.push(text);
  };
  push(row.tender247Id);
  push(row.referenceNo);
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

function excelTenderValue(row: RunWorkbookRow): number | null {
  return parsePhase1Amount(row.estimatedCost);
}

function mapScreeningToQualificationStatus(
  status: Phase1ScreeningStatus,
  existingStatus?: string | null,
  options?: { preserveWillBid?: boolean },
): Phase1ScreeningStatus {
  if (options?.preserveWillBid) {
    if (String(existingStatus || "").trim().toUpperCase() === "GO") {
      return "GO";
    }
    return status;
  }
  return agentQualificationStatusForDatabase(
    status,
    existingStatus,
  ) as Phase1ScreeningStatus;
}

function qualificationPayloadForStatus(
  status: Phase1ScreeningStatus,
  reason: string,
) {
  const label = PHASE1_STATUS_DISPLAY[status];
  if (status === "DUPLICATE") {
    return {
      status: "DUPLICATE" as const,
      decisionLabel: label,
      verdict: "DUPLICATE",
      reason: reason || "Duplicate or already-reviewed tender",
      requiredAction: null as string | null,
      confidence: 1,
      matchedCriteria: [] as string[],
      failedCriteria: [] as string[],
      unclearCriteria: [] as string[],
      missingDocuments: [] as string[],
      manualReviewRequired: false,
    };
  }
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
  category: string | null;
  project_category: string | null;
  scraped_date: string | null;
  raw_metadata: Record<string, unknown> | null;
  ai_summary_url?: string | null;
  documents_zip_url?: string | null;
};

const EXISTING_TENDER_SELECT =
  "id, source_portal, source_tender_id, folder_id, title, organization, location_text, closing_date, tender_value_text, emd_text, qualification_status, category, project_category, scraped_date, raw_metadata, ai_summary_url, documents_zip_url";

/**
 * Same-day snapshot lookup only.
 * Never returns a row from another scraped_date.
 */
async function findSameDayTender(options: {
  client: ReturnType<typeof getSupabaseAdminClient>;
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  scrapedDate: string;
  references: string[];
}): Promise<ExistingTenderRow | null> {
  const { client, sourcePortal, sourceTenderId, scrapedDate, references } =
    options;

  const byId = await client
    .from("agenttender_tenders")
    .select(EXISTING_TENDER_SELECT)
    .eq("source_portal", sourcePortal)
    .eq("source_tender_id", sourceTenderId)
    .eq("scraped_date", scrapedDate)
    .maybeSingle();
  if (byId.data) return byId.data as ExistingTenderRow;

  for (const reference of references) {
    if (!reference || reference === sourceTenderId) continue;
    const byFolder = await client
      .from("agenttender_tenders")
      .select(EXISTING_TENDER_SELECT)
      .eq("source_portal", sourcePortal)
      .eq("folder_id", reference)
      .eq("scraped_date", scrapedDate)
      .maybeSingle();
    if (byFolder.data) return byFolder.data as ExistingTenderRow;

    const byAltId = await client
      .from("agenttender_tenders")
      .select(EXISTING_TENDER_SELECT)
      .eq("source_portal", sourcePortal)
      .eq("source_tender_id", reference)
      .eq("scraped_date", scrapedDate)
      .maybeSingle();
    if (byAltId.data) return byAltId.data as ExistingTenderRow;
  }

  return null;
}

/**
 * Earliest prior-day occurrence of the same portal tender id (historical duplicate).
 */
async function findHistoricalPriorTender(options: {
  client: ReturnType<typeof getSupabaseAdminClient>;
  sourcePortal: "TENDER247" | "BIDASSIST";
  sourceTenderId: string;
  scrapedDate: string;
}): Promise<{ id: string; scraped_date: string; source_tender_id: string } | null> {
  const { data, error } = await options.client
    .from("agenttender_tenders")
    .select("id, scraped_date, source_tender_id")
    .eq("source_portal", options.sourcePortal)
    .eq("source_tender_id", options.sourceTenderId)
    .lt("scraped_date", options.scrapedDate)
    .order("scraped_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    scraped_date: String(data.scraped_date).slice(0, 10),
    source_tender_id: String(data.source_tender_id),
  };
}

function historicalDuplicateReason(
  sourceTenderId: string,
  priorScrapedDate: string,
): string {
  return `Duplicate Tender247 ID – previously seen on ${priorScrapedDate}`;
}

async function resolveDuplicateOfTenderId(options: {
  client: ReturnType<typeof getSupabaseAdminClient>;
  sourcePortal: "TENDER247" | "BIDASSIST";
  matchedSourceTenderId: string;
  excludeTenderId?: string | null;
  /** Prefer the prior historical snapshot UUID when known. */
  preferredTenderId?: string | null;
}): Promise<string | null> {
  if (options.preferredTenderId) {
    return options.preferredTenderId;
  }
  let query = options.client
    .from("agenttender_tenders")
    .select("id")
    .eq("source_portal", options.sourcePortal)
    .eq("source_tender_id", options.matchedSourceTenderId)
    .order("scraped_date", { ascending: true })
    .order("first_seen_at", { ascending: true })
    .limit(1);
  if (options.excludeTenderId) {
    query = query.neq("id", options.excludeTenderId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return data?.id ? String(data.id) : null;
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
  /** Override raw_metadata.screeningSource (default CHATGPT_RUN_EXCEL). */
  screeningSource?: string;
  /** Qualification model_name (default chatgpt-project-run-screening). */
  modelName?: string;
  /**
   * When true (or when screeningSource is AI_SUMMARY_DAILY_EXCEL /
   * REUPSERT_DAILY_EXCEL), same-day updates never touch qualification_status,
   * category, project_category, or qualification_results — only new inserts
   * may set status. Scheduler owns decisions on existing rows.
   */
  preserveExistingQualificationStatus?: boolean;
}): Promise<Phase1PersistResult> {
  const workbookLabel =
    options.screenedWorkbookPath ||
    (options.dateFolder
      ? path.join(options.dateFolder, "screening", RUN_SCREENED_FILE)
      : RUN_SCREENED_FILE);

  const screeningSource =
    options.screeningSource || "CHATGPT_RUN_EXCEL";
  /** Non-ChatGPT ingest must not wipe statuses ChatGPT / scheduler already wrote. */
  const protectExistingScreeningFields =
    options.preserveExistingQualificationStatus === true ||
    screeningSource === "AI_SUMMARY_DAILY_EXCEL" ||
    screeningSource === "REUPSERT_DAILY_EXCEL";

  options.logger?.info(`GPT_SCREENED_WORKBOOK=${workbookLabel}`);
  options.logger?.info(`GPT_ROWS_FOUND=${options.rows.length}`);
  if (protectExistingScreeningFields) {
    options.logger?.info(
      "GPT_EXCEL_PROTECT_EXISTING_STATUS=true (existing rows: never set qualification_status/category; inserts only)",
    );
  }

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

    if (sourcePortal === "TENDER247" && !isValidTender247NumericId(id)) {
      result.skipped += 1;
      result.errors.push(
        `${label || row.canonicalId || "(blank)"}: invalid Tender247 id`,
      );
      options.logger?.warn?.(
        `GPT_EXCEL_SKIP_INVALID_T247_ID=${label || row.canonicalId || "(blank)"}`,
      );
      continue;
    }

    try {
      // STEP 1 — same-day snapshot only
      const existing = await findSameDayTender({
        client,
        sourcePortal,
        sourceTenderId: id,
        scrapedDate: options.runDate,
        references,
      });

      // AI-summary ingest: skip rewrite only when BOTH artifact URLs exist.
      if (
        protectExistingScreeningFields &&
        existing &&
        String(existing.ai_summary_url || "").trim() &&
        String(existing.documents_zip_url || "").trim()
      ) {
        result.skipped += 1;
        options.logger?.info(
          `[${label}] SKIP_EXISTING_ARTIFACT_URLS ai=true zip=true`,
        );
        continue;
      }

      options.logger?.info(
        `[${label}] Same-day snapshot found=${Boolean(existing)} scraped_date=${options.runDate}`,
      );

      // STEP 2 — historical prior-day check (only when inserting a new day)
      const historicalPrior =
        existing
          ? null
          : await findHistoricalPriorTender({
              client,
              sourcePortal,
              sourceTenderId: id,
              scrapedDate: options.runDate,
            });

      let effectiveStatus = status;
      let effectiveReason = row.screeningReason || "";
      if (!existing && historicalPrior && !isPhase1Duplicate(status)) {
        effectiveStatus = "DUPLICATE";
        effectiveReason = historicalDuplicateReason(
          id,
          historicalPrior.scraped_date,
        );
        options.logger?.info(
          `[${label}] HISTORICAL_DUPLICATE prior_scraped_date=${historicalPrior.scraped_date}`,
        );
      }

      const existingStatusNonNull = Boolean(
        String(existing?.qualification_status || "").trim(),
      );
      const existingCategoryNonNull = Boolean(
        String(existing?.category || "").trim(),
      );
      // Protect mode: any existing same-day row keeps status/category (scheduler).
      const preserveStatus = Boolean(protectExistingScreeningFields && existing);
      const preserveCategory = Boolean(protectExistingScreeningFields && existing);
      if (preserveStatus && existingStatusNonNull) {
        const priorStatus = normalizePhase1ScreeningStatus(
          existing?.qualification_status || null,
        );
        if (priorStatus) {
          effectiveStatus = priorStatus;
          effectiveReason =
            String(
              (existing?.raw_metadata as { screeningReason?: unknown } | null)
                ?.screeningReason || "",
            ).trim() || effectiveReason;
          options.logger?.info(
            `[${label}] PRESERVE_EXISTING_STATUS=${priorStatus}`,
          );
        }
      } else if (preserveStatus) {
        options.logger?.info(
          `[${label}] PRESERVE_EXISTING_STATUS=unchanged (existing row; leave blank/scheduler value)`,
        );
      }
      if (preserveCategory && existingCategoryNonNull) {
        options.logger?.info(
          `[${label}] PRESERVE_EXISTING_CATEGORY=${String(existing?.category).trim()}`,
        );
      }

      const qualificationStatus = isPhase1Duplicate(effectiveStatus)
        ? "DUPLICATE"
        : mapScreeningToQualificationStatus(
            effectiveStatus,
            existing?.qualification_status,
            {
              // Phase-1 Excel Status is authoritative — keep Will Bid as written.
              preserveWillBid: true,
            },
          );
      const closingDate = excelDeadlineIso(row);
      const emdAmount = excelEmdAmount(row);
      const tenderValue = excelTenderValue(row);
      const titleParts = truncateForDatabaseIndex(row.tenderName || id);
      const orgParts = truncateForDatabaseIndex(row.organization || null);

      const duplicateRef = isPhase1Duplicate(effectiveStatus)
        ? parseDuplicateReferenceFromReason(effectiveReason)
        : { matchedSourceTenderId: null, matchKind: null };
      const matchedHistoricalId =
        historicalPrior?.source_tender_id ||
        duplicateRef.matchedSourceTenderId ||
        (isPhase1Duplicate(effectiveStatus) ? id : null);
      const duplicateOfTenderId =
        matchedHistoricalId && isPhase1Duplicate(effectiveStatus)
          ? await resolveDuplicateOfTenderId({
              client,
              sourcePortal,
              matchedSourceTenderId: matchedHistoricalId,
              excludeTenderId: existing?.id ?? null,
              preferredTenderId: historicalPrior?.id ?? null,
            })
          : null;

      const priorRaw =
        existing?.raw_metadata &&
        typeof existing.raw_metadata === "object" &&
        !Array.isArray(existing.raw_metadata)
          ? (existing.raw_metadata as Record<string, unknown>)
          : {};
      const priorScreeningSource =
        preserveStatus && priorRaw.screeningSource
          ? String(priorRaw.screeningSource)
          : null;
      const preservedTenderCategory =
        preserveCategory && priorRaw.tenderCategory != null
          ? priorRaw.tenderCategory
          : preserveCategory && existing?.category
            ? existing.category
            : row.tenderCategory || null;
      const rawMetadata = {
        ...priorRaw,
        phase1Screening: true,
        screeningSource:
          priorScreeningSource ||
          screeningSource ||
          "CHATGPT_RUN_EXCEL",
        screeningWorkbook:
          preserveStatus && priorRaw.screeningWorkbook
            ? priorRaw.screeningWorkbook
            : RUN_SCREENED_FILE,
        companyId,
        runDate: options.runDate,
        screeningStatus: preserveStatus
          ? priorRaw.screeningStatus ?? effectiveStatus
          : effectiveStatus,
        screeningReason: preserveStatus
          ? priorRaw.screeningReason ?? effectiveReason
          : effectiveReason,
        source: row.source,
        sourceRefs: row.sourceRefs || null,
        tenderCategory: preservedTenderCategory,
        msmeExemption:
          row.msmeExemption != null ? row.msmeExemption : null,
        startupExemption:
          row.startupExemption != null ? row.startupExemption : null,
        ...(titleParts.truncated
          ? { fullTitle: String(row.tenderName || "").trim() }
          : {}),
        ...(orgParts.truncated
          ? { fullOrganization: String(row.organization || "").trim() }
          : {}),
        ...(matchedHistoricalId
          ? {
              duplicateOfSourceTenderId: matchedHistoricalId,
              duplicateMatchKind:
                duplicateRef.matchKind ||
                (historicalPrior ? "historical" : null),
              duplicatePriorScrapedDate: historicalPrior?.scraped_date ?? null,
            }
          : {}),
      };

      const incoming = {
        source_portal: sourcePortal,
        source_tender_id: existing?.source_tender_id || id,
        folder_id: existing?.folder_id || row.tender247Id || row.bidAssistId || null,
        reference_no: referenceNoForWorkbookRow(row),
        title: titleParts.text || id,
        organization: orgParts.text,
        location_text: row.location || null,
        closing_date: closingDate,
        bid_submission_date: closingDate,
        tender_value: tenderValue,
        tender_value_text: row.estimatedCost || null,
        emd_text: row.emdAmount || null,
        emd_amount: emdAmount,
        currency: "INR",
        qualification_status: qualificationStatus,
        category: preserveCategory
          ? existing?.category || null
          : row.tenderCategory || null,
        project_category: preserveCategory
          ? existing?.project_category || "Other"
          : "Other",
        duplicate_of_source_tender_id: matchedHistoricalId,
        duplicate_of_tender_id: duplicateOfTenderId,
        duplicate_match_kind:
          duplicateRef.matchKind ||
          (historicalPrior ? "historical" : null),
        raw_metadata: rawMetadata,
        metadata_version: 1,
        content_hash: `phase1-gpt:${sourcePortal}:${id}:${options.runDate}:${effectiveStatus}`,
        last_seen_at: now,
        supabase_synced_at: now,
        // Never rewrite another day's scraped_date. Same-day updates keep runDate.
        scraped_date: options.runDate,
        download_status: existing ? undefined : ("DISCOVERED" as const),
        ai_summary_available: existing ? undefined : false,
        document_archive_available: existing ? undefined : false,
        local_folder_path: existing ? undefined : null,
        crawled_at: existing ? undefined : null,
      };

      const alwaysUpdate: Array<keyof typeof incoming> =
        protectExistingScreeningFields
          ? [
              "reference_no",
              "raw_metadata",
              "content_hash",
              "last_seen_at",
              "supabase_synced_at",
              // Never force qualification_status / category when protecting.
            ]
          : [
              "qualification_status",
              "reference_no",
              "raw_metadata",
              "content_hash",
              "last_seen_at",
              "supabase_synced_at",
              "duplicate_of_source_tender_id",
              "duplicate_of_tender_id",
              "duplicate_match_kind",
            ];

      const { next, updatedKeys } = mergeNullOnlyRecord(
        existing as Record<string, unknown> | null,
        incoming as Record<string, unknown>,
        alwaysUpdate as string[],
      );

      // ChatGPT Phase-1 may overwrite status. AI-summary / protect mode:
      // only set status/category on INSERT. Existing same-day rows keep
      // whatever the scheduler (or prior screening) already wrote.
      if (!protectExistingScreeningFields) {
        next.qualification_status = qualificationStatus;
        if (!updatedKeys.includes("qualification_status")) {
          updatedKeys.push("qualification_status");
        }
      } else if (!existing) {
        next.qualification_status = qualificationStatus;
      } else {
        delete next.qualification_status;
        delete next.category;
        delete next.project_category;
      }

      // Final hard guard: never send status/category on protected updates.
      if (protectExistingScreeningFields && existing) {
        delete next.qualification_status;
        delete next.category;
        delete next.project_category;
      }

      next.raw_metadata = rawMetadata;
      // Keep existing scraped_date on update; set only for insert path below.
      if (existing) {
        next.scraped_date = existing.scraped_date || options.runDate;
      } else {
        next.scraped_date = options.runDate;
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
        preserveStatus
          ? `[${label}] Status left unchanged (existing same-day row):\n${existing?.qualification_status ?? "(blank)"}`
          : `[${label}] Status updated:\n${qualificationStatus}`,
      );

      let persistedTenderId: string | null = existing?.id ?? null;
      let statusAlreadyInDb = existingStatusNonNull;
      let insertedNewRow = false;

      if (existing) {
        const updatePayload: Record<string, unknown> = {
          ...next,
          updated_at: now,
        };
        if (protectExistingScreeningFields) {
          delete updatePayload.qualification_status;
          delete updatePayload.category;
          delete updatePayload.project_category;
        }
        const { error: updateError } = await client
          .from("agenttender_tenders")
          .update(updatePayload)
          .eq("id", existing.id)
          .eq("scraped_date", options.runDate);
        if (updateError) {
          result.errors.push(`${id}: ${updateError.message}`);
          continue;
        }
        result.updated += 1;
      } else {
        // Re-check before insert — avoid onConflict upsert overwriting status.
        const raced = await findSameDayTender({
          client,
          sourcePortal,
          sourceTenderId: id,
          scrapedDate: options.runDate,
          references,
        });
        if (raced) {
          statusAlreadyInDb = Boolean(
            String(raced.qualification_status || "").trim(),
          );
          const racedPayload: Record<string, unknown> = {
            ...next,
            scraped_date: raced.scraped_date || options.runDate,
            updated_at: now,
          };
          if (protectExistingScreeningFields || statusAlreadyInDb) {
            delete racedPayload.qualification_status;
          }
          if (
            protectExistingScreeningFields ||
            String(raced.category || "").trim()
          ) {
            delete racedPayload.category;
            delete racedPayload.project_category;
          }
          const { error: racedUpdateError } = await client
            .from("agenttender_tenders")
            .update(racedPayload)
            .eq("id", raced.id)
            .eq("scraped_date", options.runDate);
          if (racedUpdateError) {
            result.errors.push(`${id}: ${racedUpdateError.message}`);
            continue;
          }
          persistedTenderId = raced.id;
          result.updated += 1;
        } else {
          const { data: inserted, error: insertError } = await client
            .from("agenttender_tenders")
            .insert({
              source_portal: sourcePortal,
              source_tender_id: id,
              folder_id: row.tender247Id || row.bidAssistId || null,
              reference_no: referenceNoForWorkbookRow(row),
              title: titleParts.text || id,
              organization: orgParts.text,
              location_text: row.location || null,
              closing_date: excelDeadlineIso(row),
              bid_submission_date: excelDeadlineIso(row),
              tender_value: excelTenderValue(row),
              tender_value_text: row.estimatedCost || null,
              emd_text: row.emdAmount || null,
              emd_amount: excelEmdAmount(row),
              currency: "INR",
              local_folder_path: null,
              ai_summary_available: false,
              document_archive_available: false,
              download_status: "DISCOVERED",
              qualification_status: qualificationStatus,
              category: row.tenderCategory || null,
              project_category: "Other",
              duplicate_of_source_tender_id: matchedHistoricalId,
              duplicate_of_tender_id: duplicateOfTenderId,
              duplicate_match_kind:
                duplicateRef.matchKind ||
                (historicalPrior ? "historical" : null),
              raw_metadata: rawMetadata,
              metadata_version: 1,
              content_hash: incoming.content_hash,
              last_seen_at: now,
              crawled_at: null,
              supabase_synced_at: now,
              scraped_date: options.runDate,
            })
            .select("id")
            .maybeSingle();
          if (insertError) {
            const afterConflict = await findSameDayTender({
              client,
              sourcePortal,
              sourceTenderId: id,
              scrapedDate: options.runDate,
              references,
            });
            if (afterConflict) {
              statusAlreadyInDb = Boolean(
                String(afterConflict.qualification_status || "").trim(),
              );
              const conflictPayload: Record<string, unknown> = {
                last_seen_at: now,
                supabase_synced_at: now,
                updated_at: now,
              };
              const { error: conflictErr } = await client
                .from("agenttender_tenders")
                .update(conflictPayload)
                .eq("id", afterConflict.id)
                .eq("scraped_date", options.runDate);
              if (conflictErr) {
                result.errors.push(`${id}: ${insertError.message}`);
                continue;
              }
              persistedTenderId = afterConflict.id;
              result.updated += 1;
            } else {
              result.errors.push(`${id}: ${insertError.message}`);
              continue;
            }
          } else {
            persistedTenderId = inserted?.id ? String(inserted.id) : null;
            insertedNewRow = true;
            result.created += 1;
          }
        }
      }

      // Do not upsert qualification for existing same-day rows under protect
      // mode — scheduler owns status/decisions; DB triggers would sync back.
      const skipQualUpsert = Boolean(
        protectExistingScreeningFields && !insertedNewRow,
      );
      if (!skipQualUpsert) {
        const qual = qualificationPayloadForStatus(
          effectiveStatus,
          effectiveReason || "",
        );
        const upserted = await upsertQualificationResult({
          sourcePortal,
          sourceTenderId: existing?.source_tender_id || id,
          scrapedDate: options.runDate,
          tenderId: persistedTenderId,
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
            !isPhase1Duplicate(effectiveStatus) &&
            effectiveStatus !== "GO" &&
            effectiveStatus !== "NO_GO",
          evidenceFiles: [screeningSource, RUN_SCREENED_FILE],
          rawResponse: effectiveReason,
          rawResult: rawMetadata,
          chatUrl: null,
          promptVersion: PHASE1_SCREENING_POLICY_VERSION,
          modelName:
            options.modelName ||
            (screeningSource !== "CHATGPT_RUN_EXCEL"
              ? screeningSource
              : "chatgpt-project-run-screening"),
        });
        if (!upserted.ok) {
          result.errors.push(
            `${id}: ${upserted.error || "qualification upsert failed"}`,
          );
          continue;
        }
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
    for (const err of result.errors.slice(0, 10)) {
      options.logger?.warn?.(`GPT_EXCEL_DB_SYNC_ERROR=${err}`);
    }
  }
  options.logger?.info(
    `GPT_EXCEL_DB_SYNC_STORED=${result.stored}/${result.attempted} skipped=${result.skipped}`,
  );

  if (options.dateFolder) {
    writeJson(
      path.join(screeningDir(options.dateFolder), "gpt-excel-db-sync.json"),
      {
        screeningRunId: runCorrelationIdForDate(options.runDate),
        source: RUN_SCREENED_FILE,
        sourcePath: options.screenedWorkbookPath ?? null,
        rowCount: options.rows.length,
        stored: result.stored,
        skipped: result.skipped,
        created: result.created,
        updated: result.updated,
        errors: result.errors,
        updatedAt: new Date().toISOString(),
      },
    );
  }

  return result;
}

/**
 * Tender247 daily Excel + documents pipeline (AI Summary when available).
 *
 * Indian (`--region=INDIAN`, default): queue until both AI Summary URL and
 * documents ZIP URL exist.
 * Global (`--region=GLOBAL`): separate Excel (`Tender247_GLOBAL_*.xlsx`) and
 * documents-first — AI Summary is skipped because Global portal rarely has it.
 *
 * 1. Download Tender247 daily Excel for --date (unless --skip-upsert)
 * 2. Upsert Excel rows into Supabase (scraped_date = date); new rows default VERIFY.
 *    Existing same-day rows keep qualification_status / category / decisions
 *    (scheduler-owned); only metadata and other null-fill fields are patched.
 * 3. Queue tenders for that date still missing AI Summary URL and/or documents zip URL
 * 4. Open each tender via Tender Filters → Search By T247 ID
 * 5. Download AI Summary and always download all documents
 * 6. Upload artifacts to Azure and persist public URLs
 *
 * Same-day scheduled re-runs re-download Excel so newly listed tenders are
 * inserted, then only process rows still missing either artifact URL.
 *
 * When a prior ai-summary-pipeline-summary.json lists failedIds, the next run
 * auto-resumes without --only-failed:
 *   - Excel row count == Supabase row count for the date → retry failedIds only
 *   - Counts differ → retry failedIds plus Excel IDs not yet stored in Supabase
 *
 * Usage:
 *   npm run pipeline:tender247:ai-summary
 *   npm run pipeline:tender247:ai-summary -- --date=2026-09-06
 *   npm run pipeline:tender247:ai-summary -- --date=2026-09-06 --account-id=2
 *   npm run pipeline:tender247:ai-summary -- --date=2026-09-06 --force
 *   npm run pipeline:tender247:ai-summary -- --date=2026-09-06 --skip-upsert
 *   npm run pipeline:tender247:ai-summary -- --date=2026-09-06 --dry-run
 *   npm run pipeline:tender247:ai-summary -- --date=2026-09-06 --skip-upsert --only-failed
 *   npm run pipeline:tender247:ai-summary -- --date=2026-09-06 --skip-upsert --ids=104046893,104046932
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutomationError,
  closeBrowserSession,
  launchBrowserSession,
} from "../browserUtils.js";
import {
  getArgValue,
  hasBooleanFlag,
  resolveRequestedDate,
} from "../cli/requestedDate.js";
import { getNpmConfigValue } from "../prescreen/prescreenBackfillArgs.js";
import {
  finishPipelineRun,
  markTender247AccountUsed,
  resolveTender247RunAccount,
  startPipelineRun,
  withTender247AccountContextAsync,
} from "../company/tender247Accounts.js";
import { resolveRunCompanyId } from "../company/siyanaCompany.js";
import { loadConfig, resolveTender247AuthPath } from "../config.js";
import { getIndiaTodayIsoDate } from "../dateUtils.js";
import { ensureDir } from "../fileUtils.js";
import { Logger, safeErrorMessage } from "../logger.js";
import { dailyScreeningOutputFilename } from "../runScreening/buildDailyScreeningOperatorPrompt.js";
import {
  assertPhase1PersistComplete,
  persistGptScreenedWorkbookToDatabase,
} from "../runScreening/persistPhase1Results.js";
import { normalizePhase1CrawlStatus } from "../runScreening/phase1Statuses.js";
import {
  parseSourceWorkbook,
  type RunWorkbookRow,
} from "../runScreening/runWorkbook.js";
import { resolveExistingScreenedWorkbook } from "../runScreening/screeningManifest.js";
import { getSupabaseAdminClient, isSupabaseConfigured } from "../supabase/client.js";
import { ensureTender247FreshListForDate } from "../tender247Batch/ensureTender247FreshListForDate.js";
import { processSurvivorsInParallel } from "../tender247Batch/processSurvivorsInParallel.js";
import {
  createTender247RunContext,
  ensureTender247DateScopedDir,
  logTender247RunContext,
  resolveSeedExcelDir,
  withTender247RunContextAsync,
} from "../tender247Batch/tender247RunContext.js";
import { downloadTodayExcel } from "../tender247Excel/testTender247ExcelFilter.js";
import {
  DEFAULT_TENDER247_SOURCE_REGION,
  parseTender247SourceRegion,
  type Tender247SourceRegion,
} from "../tender247/sourceRegion.js";
import {
  loginToTender247,
  persistAuthState,
} from "../tenderDetails/ensureTender247LoggedIn.js";
import { dismissTender247Interruptions } from "../tenderDetails/dismissTender247Interruptions.js";
import { assertMailDateReadyForExcel } from "../tenderDetails/selectTender247MailDate.js";

/**
 * AI Summary downloads every tender for the mail date — including NO_GO / No Bid.
 * Detail-crawl shortlist filters do NOT apply here.
 */
const QUEUE_STATUSES = [
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
  "VERIFY",
  "NO_GO",
  "DUPLICATE",
] as const;

export type AiSummaryQueueRow = {
  id: string;
  sourceTenderId: string;
  qualificationStatus: string;
  title: string | null;
  documentsZipUrl: string | null;
  aiSummaryUrl: string | null;
};

/** Supabase URL–driven resume mode (local downloads/ are cache only). */
export type AiSummaryArtifactMode =
  | "SKIP_ALREADY_COMPLETE"
  | "RESUME_SUMMARY_ONLY"
  | "RESUME_DOCUMENTS_ONLY"
  | "PROCESS_FULL";

export function resolveAiSummaryArtifactMode(options: {
  documentsZipUrl?: string | null;
  aiSummaryUrl?: string | null;
  force?: boolean;
  /**
   * Indian AI-summary runs require both URLs.
   * Global runs treat documents as sufficient (portal rarely has AI Summary).
   */
  aiSummaryRequired?: boolean;
}): AiSummaryArtifactMode {
  if (options.force) return "PROCESS_FULL";
  const hasDocs = Boolean(String(options.documentsZipUrl || "").trim());
  const hasSummary = Boolean(String(options.aiSummaryUrl || "").trim());
  const aiRequired = options.aiSummaryRequired !== false;
  if (aiRequired) {
    if (hasDocs && hasSummary) return "SKIP_ALREADY_COMPLETE";
    if (hasDocs && !hasSummary) return "RESUME_SUMMARY_ONLY";
    if (!hasDocs && hasSummary) return "RESUME_DOCUMENTS_ONLY";
    return "PROCESS_FULL";
  }
  // Global / documents-first: docs ZIP is enough to skip.
  if (hasDocs) return "SKIP_ALREADY_COMPLETE";
  return "PROCESS_FULL";
}

export type AiSummaryPipelineSummary = {
  date: string;
  region: Tender247SourceRegion;
  excelDownloaded: boolean;
  excelPath: string | null;
  upsertAttempted: boolean;
  upsertStored: number;
  upsertCreated: number;
  upsertUpdated: number;
  selected: number;
  skippedExistingAi: number;
  skippedLocalArtifacts: number;
  attempted: number;
  fullSuccess: number;
  partialSuccess: number;
  failed: number;
  failedIds: string[];
  dryRun: boolean;
};

function rejectMistypedAccountFlags(argv: string[]): void {
  const mistyped = argv.find(
    (token) =>
      /^--accountid(=|$)/i.test(token) ||
      /^--tender247accountid(=|$)/i.test(token),
  );
  if (!mistyped) return;
  throw new AutomationError(
    "INVALID_ACCOUNT_FLAG",
    `Unrecognized account flag "${mistyped}". Use --account-id=2 (with hyphen), not --accountid=2.`,
  );
}

function normalizeTenderIdDigits(raw: string): string {
  return String(raw || "")
    .replace(/^T247-/i, "")
    .replace(/\D/g, "");
}

/** Parse `--ids=a,b` / `--ids a,b` into digit-only Tender247 IDs. */
function parseIdsFilter(argv: string[]): string[] | null {
  // PowerShell + npm often drops `--ids=...`; npm still sets npm_config_ids.
  const raw = getArgValue(argv, "ids") || getNpmConfigValue("ids");
  if (!raw) return null;
  const ids = raw
    .split(/[,\s]+/)
    .map((part) => normalizeTenderIdDigits(part))
    .filter(Boolean);
  return ids.length ? [...new Set(ids)] : null;
}

function loadFailedIdsFromSummary(dateFolder: string): string[] {
  const ids = loadPriorSummaryFailedIds(dateFolder);
  const summaryPath = path.join(dateFolder, "ai-summary-pipeline-summary.json");
  if (!fs.existsSync(summaryPath)) {
    throw new AutomationError(
      "AI_SUMMARY_FAILED_SUMMARY_MISSING",
      `Missing ${summaryPath}. Run a full AI-summary pipeline first, or pass --ids=...`,
    );
  }
  if (!ids.length) {
    throw new AutomationError(
      "AI_SUMMARY_FAILED_IDS_EMPTY",
      `${summaryPath} has no failedIds to retry`,
    );
  }
  return ids;
}

/** Prior run failures; empty when no summary or no failedIds. */
export function loadPriorSummaryFailedIds(dateFolder: string): string[] {
  const summaryPath = path.join(dateFolder, "ai-summary-pipeline-summary.json");
  if (!fs.existsSync(summaryPath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
    failedIds?: unknown;
  };
  if (!Array.isArray(parsed.failedIds)) {
    return [];
  }
  return [
    ...new Set(
      parsed.failedIds
        .map((id) => normalizeTenderIdDigits(String(id)))
        .filter(Boolean),
    ),
  ];
}

export type AiSummaryResumeMode = "none" | "failed-only" | "failed-plus-gap";

export function resolveExcelPathForAiSummaryCount(options: {
  dateFolder: string;
  runDate: string;
  excelPath?: string | null;
}): string | null {
  const dailyPath = path.join(
    options.dateFolder,
    "screening",
    dailyScreeningOutputFilename(options.runDate),
  );
  return (
    options.excelPath ||
    resolveExistingScreenedWorkbook(options.dateFolder, options.runDate) ||
    (fs.existsSync(dailyPath) ? dailyPath : null)
  );
}

export function countExcelTender247Rows(excelPath: string): number {
  return parseSourceWorkbook(excelPath, "TENDER247").length;
}

export function listExcelTender247Ids(excelPath: string): string[] {
  const rows = parseSourceWorkbook(excelPath, "TENDER247");
  return [
    ...new Set(
      rows
        .map((row) => normalizeTenderIdDigits(row.tender247Id))
        .filter(Boolean),
    ),
  ];
}

/** Pure resume decision: failed-only when Excel/DB counts match, else failed + Excel gap. */
export function computeAiSummaryResumeIdFilter(options: {
  priorFailedIds: string[];
  excelRowCount: number;
  dbRowCount: number;
  excelIds: string[];
  dbIds: Set<string>;
}): { ids: string[] | null; mode: AiSummaryResumeMode } {
  if (!options.priorFailedIds.length) {
    return { ids: null, mode: "none" };
  }
  if (options.excelRowCount === options.dbRowCount) {
    return { ids: options.priorFailedIds, mode: "failed-only" };
  }
  const gapIds = options.excelIds.filter((id) => !options.dbIds.has(id));
  return {
    ids: [...new Set([...options.priorFailedIds, ...gapIds])],
    mode: "failed-plus-gap",
  };
}

export async function countT247TendersForScrapedDate(
  scrapedDate: string,
  sourceRegion: Tender247SourceRegion = DEFAULT_TENDER247_SOURCE_REGION,
): Promise<number> {
  if (!isSupabaseConfigured()) {
    throw new AutomationError(
      "SUPABASE_NOT_CONFIGURED",
      "Supabase is not configured — cannot count tenders for resume",
    );
  }
  const client = getSupabaseAdminClient();
  const { count, error } = await client
    .from("agenttender_tenders")
    .select("id", { count: "exact", head: true })
    .eq("source_portal", "TENDER247")
    .eq("source_region", sourceRegion)
    .eq("scraped_date", scrapedDate);
  if (error) {
    throw new AutomationError(
      "AI_SUMMARY_TENDER_COUNT_FAILED",
      `Failed to count tenders for ${scrapedDate}: ${error.message}`,
    );
  }
  return count ?? 0;
}

export async function listT247SourceIdsForScrapedDate(
  scrapedDate: string,
  sourceRegion: Tender247SourceRegion = DEFAULT_TENDER247_SOURCE_REGION,
): Promise<Set<string>> {
  if (!isSupabaseConfigured()) {
    throw new AutomationError(
      "SUPABASE_NOT_CONFIGURED",
      "Supabase is not configured — cannot list tender IDs for resume",
    );
  }
  const client = getSupabaseAdminClient();
  const pageSize = 1000;
  const ids = new Set<string>();
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await client
      .from("agenttender_tenders")
      .select("source_tender_id")
      .eq("source_portal", "TENDER247")
      .eq("source_region", sourceRegion)
      .eq("scraped_date", scrapedDate)
      .order("source_tender_id", { ascending: true })
      .range(from, to);
    if (error) {
      throw new AutomationError(
        "AI_SUMMARY_TENDER_IDS_FAILED",
        `Failed to list tender IDs for ${scrapedDate}: ${error.message}`,
      );
    }
    const batch = data || [];
    for (const row of batch) {
      const id = normalizeTenderIdDigits(String(row.source_tender_id || ""));
      if (id) ids.add(id);
    }
    if (batch.length < pageSize) {
      break;
    }
  }
  return ids;
}

export async function resolveAiSummaryResumeIdFilter(options: {
  dateFolder: string;
  runDate: string;
  excelPath?: string | null;
  sourceRegion?: Tender247SourceRegion;
}): Promise<{
  ids: string[] | null;
  mode: AiSummaryResumeMode;
  excelRowCount: number | null;
  dbRowCount: number | null;
}> {
  const sourceRegion = options.sourceRegion || DEFAULT_TENDER247_SOURCE_REGION;
  const priorFailedIds = loadPriorSummaryFailedIds(options.dateFolder);
  if (!priorFailedIds.length) {
    return {
      ids: null,
      mode: "none",
      excelRowCount: null,
      dbRowCount: null,
    };
  }

  const excelPath = resolveExcelPathForAiSummaryCount({
    dateFolder: options.dateFolder,
    runDate: options.runDate,
    excelPath: options.excelPath,
  });
  if (!excelPath) {
    return {
      ids: priorFailedIds,
      mode: "failed-only",
      excelRowCount: null,
      dbRowCount: null,
    };
  }

  const excelRowCount = countExcelTender247Rows(excelPath);
  const dbRowCount = await countT247TendersForScrapedDate(
    options.runDate,
    sourceRegion,
  );
  const excelIds = listExcelTender247Ids(excelPath);
  const dbIds = await listT247SourceIdsForScrapedDate(
    options.runDate,
    sourceRegion,
  );
  const resolved = computeAiSummaryResumeIdFilter({
    priorFailedIds,
    excelRowCount,
    dbRowCount,
    excelIds,
    dbIds,
  });
  return {
    ...resolved,
    excelRowCount,
    dbRowCount,
  };
}

function parseArgs(argv: string[]): {
  date: string;
  region: Tender247SourceRegion;
  accountId: string | null;
  companyId: string | null;
  force: boolean;
  dryRun: boolean;
  skipUpsert: boolean;
  limit: number | null;
  ids: string[] | null;
  onlyFailed: boolean;
} {
  rejectMistypedAccountFlags(argv);
  const hasExplicitDate =
    Boolean(getArgValue(argv, "date")) ||
    Boolean(process.env.npm_config_date?.trim()) ||
    Boolean(process.env.TENDER247_DATE?.trim());
  const resolved = hasExplicitDate
    ? resolveRequestedDate(argv, { requireExplicit: true })
    : {
        requestedDate: getIndiaTodayIsoDate(),
        source: "india_today" as const,
      };
  const limitRaw = getArgValue(argv, "limit");
  const limit =
    limitRaw && Number.isFinite(Number(limitRaw))
      ? Math.max(0, Number.parseInt(limitRaw, 10))
      : null;
  const region = parseTender247SourceRegion(
    getArgValue(argv, "region") ||
      getNpmConfigValue("region") ||
      process.env.TENDER247_REGION ||
      DEFAULT_TENDER247_SOURCE_REGION,
  );
  return {
    date: resolved.requestedDate,
    region,
    accountId:
      getArgValue(argv, "account-id") ||
      getArgValue(argv, "tender247-account-id") ||
      getNpmConfigValue("account-id") ||
      process.env.TENDER247_ACCOUNT_ID?.trim() ||
      process.env.TENDER247_ACCOUNT?.trim() ||
      null,
    companyId:
      getArgValue(argv, "company-id") ||
      process.env.COMPANY_ID?.trim() ||
      process.env.SIYANA_COMPANY_ID?.trim() ||
      null,
    force: hasBooleanFlag(argv, "force"),
    dryRun:
      hasBooleanFlag(argv, "dry-run") || hasBooleanFlag(argv, "dry-run-date"),
    skipUpsert: hasBooleanFlag(argv, "skip-upsert"),
    limit,
    ids: parseIdsFilter(argv),
    onlyFailed: hasBooleanFlag(argv, "only-failed"),
  };
}

/** Raw Tender247 exports have no Screening Status — default VERIFY for AI ingest. */
export function withDefaultVerifyStatus(rows: RunWorkbookRow[]): RunWorkbookRow[] {
  return rows.map((row) => {
    if (row.screeningStatus) return row;
    return {
      ...row,
      screeningStatus: "VERIFY",
      screeningReason:
        row.screeningReason || "AI_SUMMARY_PIPELINE_DAILY_EXCEL",
    };
  });
}

export async function upsertScreenedTendersForDate(options: {
  runDate: string;
  dateFolder: string;
  logger: Logger;
  companyId: string;
  /** Prefer this Excel path (fresh Tender247 download). */
  excelPath?: string | null;
  sourceRegion?: Tender247SourceRegion;
}): Promise<{
  attempted: boolean;
  stored: number;
  created: number;
  updated: number;
  excelPath: string | null;
}> {
  const sourceRegion = options.sourceRegion || DEFAULT_TENDER247_SOURCE_REGION;
  const dailyName = dailyScreeningOutputFilename(options.runDate);
  const dailyPath = path.join(options.dateFolder, "screening", dailyName);
  const excelPath =
    options.excelPath ||
    resolveExistingScreenedWorkbook(options.dateFolder, options.runDate) ||
    (fs.existsSync(dailyPath) ? dailyPath : null);

  if (!excelPath) {
    options.logger.warn(
      `AI_SUMMARY_PIPELINE_UPSERT_SKIPPED no Excel under ${path.join(options.dateFolder, "screening")} (and no download path)`,
    );
    return {
      attempted: false,
      stored: 0,
      created: 0,
      updated: 0,
      excelPath: null,
    };
  }

  const rows = withDefaultVerifyStatus(
    parseSourceWorkbook(excelPath, "TENDER247"),
  );
  options.logger.info(`AI_SUMMARY_PIPELINE_UPSERT_EXCEL=${excelPath}`);
  options.logger.info(`AI_SUMMARY_PIPELINE_UPSERT_ROWS=${rows.length}`);
  options.logger.info(`AI_SUMMARY_PIPELINE_UPSERT_REGION=${sourceRegion}`);
  console.log(`AI_SUMMARY_PIPELINE_UPSERT_EXCEL=${excelPath}`);
  console.log(`AI_SUMMARY_PIPELINE_UPSERT_ROWS=${rows.length}`);
  console.log(`AI_SUMMARY_PIPELINE_UPSERT_REGION=${sourceRegion}`);

  const result = await persistGptScreenedWorkbookToDatabase({
    rows,
    runDate: options.runDate,
    dateFolder: options.dateFolder,
    screenedWorkbookPath: excelPath,
    companyId: options.companyId,
    logger: options.logger,
    screeningSource: "AI_SUMMARY_DAILY_EXCEL",
    modelName: "ai-summary-daily-excel",
    // Never overwrite scheduler/ChatGPT qualification_status / category on re-ingest.
    // Only brand-new same-day rows get VERIFY (or Excel status).
    preserveExistingQualificationStatus: true,
    sourceRegion,
  });
  // Tender rows are what the AI crawl needs. Qual verify can fail for
  // historical re-listings (same T247 ID across scraped_dates) — do not abort
  // the whole pipeline when any tenders were written.
  const tenderWrites = result.created + result.updated;
  const accounted = result.stored + result.skipped;
  if (accounted !== rows.length || result.errors.length > 0) {
    options.logger.warn?.(
      `AI_SUMMARY_PIPELINE_UPSERT_PARTIAL expected=${rows.length} stored=${result.stored} skipped=${result.skipped} created=${result.created} updated=${result.updated} errors=${result.errors.length}`,
    );
    console.log(
      `AI_SUMMARY_PIPELINE_UPSERT_PARTIAL expected=${rows.length} stored=${result.stored} skipped=${result.skipped} created=${result.created} updated=${result.updated} errors=${result.errors.length}`,
    );
    if (tenderWrites === 0 && result.stored === 0 && result.skipped === 0) {
      assertPhase1PersistComplete(result, rows.length);
    }
  } else {
    assertPhase1PersistComplete(result, rows.length);
  }
  options.logger.info(
    `AI_SUMMARY_PIPELINE_UPSERT_DONE stored=${result.stored} created=${result.created} updated=${result.updated}`,
  );
  console.log(
    `AI_SUMMARY_PIPELINE_UPSERT_DONE stored=${result.stored} created=${result.created} updated=${result.updated}`,
  );
  return {
    attempted: true,
    stored: Math.max(result.stored, tenderWrites),
    created: result.created,
    updated: result.updated,
    excelPath,
  };
}

/**
 * Download Tender247 daily Excel for the date, then upsert into Supabase.
 * Safe for mid-day re-runs: creates new same-day rows; preserves existing status/URLs.
 */
export async function downloadAndUpsertDailyExcelForAiSummary(options: {
  runDate: string;
  dateFolder: string;
  logger: Logger;
  companyId: string;
  sourceRegion?: Tender247SourceRegion;
}): Promise<{
  attempted: boolean;
  stored: number;
  created: number;
  updated: number;
  excelPath: string | null;
  excelDownloaded: boolean;
}> {
  const sourceRegion = options.sourceRegion || DEFAULT_TENDER247_SOURCE_REGION;
  options.logger.info(
    `AI_SUMMARY_PIPELINE_EXCEL_DOWNLOAD_START date=${options.runDate} region=${sourceRegion}`,
  );
  console.log(
    `AI_SUMMARY_PIPELINE_EXCEL_DOWNLOAD_START date=${options.runDate} region=${sourceRegion}`,
  );

  const excelPath = await downloadTodayExcel({
    dateFolder: options.dateFolder,
    logger: options.logger,
    dateIso: options.runDate,
    region: sourceRegion,
  });

  options.logger.info(`AI_SUMMARY_PIPELINE_EXCEL_DOWNLOADED=${excelPath}`);
  console.log(`AI_SUMMARY_PIPELINE_EXCEL_DOWNLOADED=${excelPath}`);

  const upsert = await upsertScreenedTendersForDate({
    runDate: options.runDate,
    dateFolder: options.dateFolder,
    logger: options.logger,
    companyId: options.companyId,
    excelPath,
    sourceRegion,
  });

  return {
    ...upsert,
    excelDownloaded: true,
  };
}

export async function listAiSummaryQueueForDate(options: {
  scrapedDate: string;
  force?: boolean;
  sourceRegion?: Tender247SourceRegion;
  /** When false (Global), queue only tenders missing documents_zip_url. */
  aiSummaryRequired?: boolean;
}): Promise<AiSummaryQueueRow[]> {
  if (!isSupabaseConfigured()) {
    throw new AutomationError(
      "SUPABASE_NOT_CONFIGURED",
      "Supabase is not configured — cannot build AI summary queue",
    );
  }
  const sourceRegion = options.sourceRegion || DEFAULT_TENDER247_SOURCE_REGION;
  const aiSummaryRequired = options.aiSummaryRequired !== false;
  const client = getSupabaseAdminClient();
  // All statuses for scraped_date (including NO_GO). Paginate past PostgREST max rows.
  const pageSize = 1000;
  const rawRows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await client
      .from("agenttender_tenders")
      .select(
        "id, source_tender_id, qualification_status, title, documents_zip_url, ai_summary_url",
      )
      .eq("source_portal", "TENDER247")
      .eq("source_region", sourceRegion)
      .eq("scraped_date", options.scrapedDate)
      .order("source_tender_id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new AutomationError(
        "AI_SUMMARY_QUEUE_QUERY_FAILED",
        `Failed to load AI summary queue: ${error.message}`,
      );
    }
    const batch = data || [];
    rawRows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
  }

  const rows: AiSummaryQueueRow[] = [];
  for (const row of rawRows) {
    const sourceTenderId = String(row.source_tender_id || "")
      .replace(/^T247-/i, "")
      .replace(/\D/g, "");
    if (!sourceTenderId) continue;
    const status = String(row.qualification_status || "").trim().toUpperCase();

    const documentsZipUrl = row.documents_zip_url
      ? String(row.documents_zip_url).trim() || null
      : null;
    const aiSummaryUrl = row.ai_summary_url
      ? String(row.ai_summary_url).trim() || null
      : null;

    // Supabase URLs are canonical — Global skips when docs exist (AI optional).
    const mode = resolveAiSummaryArtifactMode({
      documentsZipUrl,
      aiSummaryUrl,
      force: options.force,
      aiSummaryRequired,
    });
    if (mode === "SKIP_ALREADY_COMPLETE") {
      continue;
    }

    rows.push({
      id: String(row.id),
      sourceTenderId,
      qualificationStatus: status || "UNKNOWN",
      title: row.title ? String(row.title) : null,
      documentsZipUrl,
      aiSummaryUrl,
    });
  }
  return rows;
}

function writeQueueArtifact(
  dateFolder: string,
  payload: Record<string, unknown>,
): string {
  const dir = path.join(dateFolder, "screening");
  ensureDir(dir);
  const outPath = path.join(dir, "supabase-ai-summary-queue.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  return outPath;
}

export async function runAiSummaryFirstDocumentPipeline(
  argv: string[] = process.argv.slice(2),
): Promise<AiSummaryPipelineSummary> {
  const args = parseArgs(argv);
  const config = loadConfig();
  const dateIso = args.date;

  const account = await resolveTender247RunAccount({
    companyId: args.companyId || resolveRunCompanyId(),
    accountId: args.accountId,
  });

  process.env.TENDER247_STORAGE_STATE_PATH = account.storageStatePath;
  process.env.COMPANY_ID = account.companyId;
  if (account.username) process.env.TENDER247_EMAIL = account.username;
  if (account.password) process.env.TENDER247_PASSWORD = account.password;

  const logger = new Logger(
    config.logRoot,
    "AiSummaryFirstDocuments",
    account.logPrefix,
  );
  const runContext = createTender247RunContext(config.downloadRoot, dateIso, {
    accountId: account.accountId,
    seedExcelSubdir: account.seedExcelSubdir,
  });
  logTender247RunContext(runContext);

  logger.info(
    `AI_SUMMARY_PIPELINE_ACCOUNT_RESOLVED accountId=${account.accountId} label=${account.accountLabel || account.accountShort} companyId=${account.companyId} storageState=${account.storageStatePath}`,
  );
  console.log(
    `AI_SUMMARY_PIPELINE_ACCOUNT_RESOLVED accountId=${account.accountId} label=${account.accountLabel || account.accountShort} companyId=${account.companyId}`,
  );
  console.log(`AI_SUMMARY_PIPELINE_DATE=${dateIso}`);
  console.log(`AI_SUMMARY_PIPELINE_REGION=${args.region}`);
  logger.info(`AI_SUMMARY_PIPELINE_REGION=${args.region}`);

  const dateFolder = runContext.downloadRoot;
  ensureTender247DateScopedDir(dateFolder, dateIso);

  const summary: AiSummaryPipelineSummary = {
    date: dateIso,
    region: args.region,
    excelDownloaded: false,
    excelPath: null,
    upsertAttempted: false,
    upsertStored: 0,
    upsertCreated: 0,
    upsertUpdated: 0,
    selected: 0,
    skippedExistingAi: 0,
    skippedLocalArtifacts: 0,
    attempted: 0,
    fullSuccess: 0,
    partialSuccess: 0,
    failed: 0,
    failedIds: [],
    dryRun: args.dryRun,
  };

  if (!args.skipUpsert) {
    // Ensure account seed dir exists under the date folder (multi-account layouts).
    ensureDir(resolveSeedExcelDir(runContext));
    const upsert = await downloadAndUpsertDailyExcelForAiSummary({
      runDate: dateIso,
      dateFolder,
      logger,
      companyId: account.companyId,
      sourceRegion: args.region,
    });
    summary.excelDownloaded = upsert.excelDownloaded;
    summary.excelPath = upsert.excelPath;
    summary.upsertAttempted = upsert.attempted;
    summary.upsertStored = upsert.stored;
    summary.upsertCreated = upsert.created;
    summary.upsertUpdated = upsert.updated;
  } else {
    logger.info("AI_SUMMARY_PIPELINE_UPSERT_SKIPPED=true (--skip-upsert)");
  }

  if (args.onlyFailed && args.ids?.length) {
    throw new AutomationError(
      "AI_SUMMARY_ID_FILTER_CONFLICT",
      "Pass either --only-failed or --ids=..., not both",
    );
  }

  let idFilterSource = args.onlyFailed
    ? "ai-summary-pipeline-summary.json"
    : args.ids?.length
      ? "--ids"
      : "";
  let autoResumeMode: AiSummaryResumeMode = "none";
  let idFilter: string[] | null = args.onlyFailed
    ? loadFailedIdsFromSummary(dateFolder)
    : args.ids;

  if (!idFilter?.length && !args.force) {
    const resume = await resolveAiSummaryResumeIdFilter({
      dateFolder,
      runDate: dateIso,
      excelPath: summary.excelPath,
      sourceRegion: args.region,
    });
    autoResumeMode = resume.mode;
    if (resume.ids?.length) {
      idFilter = resume.ids;
      idFilterSource = `auto-resume:${resume.mode}`;
      logger.info(
        `AI_SUMMARY_PIPELINE_AUTO_RESUME mode=${resume.mode} excelRows=${resume.excelRowCount ?? "n/a"} dbRows=${resume.dbRowCount ?? "n/a"} count=${resume.ids.length}`,
      );
      console.log(
        `AI_SUMMARY_PIPELINE_AUTO_RESUME mode=${resume.mode} excelRows=${resume.excelRowCount ?? "n/a"} dbRows=${resume.dbRowCount ?? "n/a"} count=${resume.ids.length}`,
      );
    }
  }

  if (idFilter?.length) {
    logger.info(
      `AI_SUMMARY_PIPELINE_ID_FILTER count=${idFilter.length} source=${idFilterSource}`,
    );
    console.log(
      `AI_SUMMARY_PIPELINE_ID_FILTER count=${idFilter.length} ids=${idFilter.join(",")}`,
    );
  }

  const aiSummaryRequired = args.region !== "GLOBAL";
  console.log(
    `AI_SUMMARY_PIPELINE_AI_REQUIRED=${aiSummaryRequired} (GLOBAL=documents-first)`,
  );
  logger.info(
    `AI_SUMMARY_PIPELINE_AI_REQUIRED=${aiSummaryRequired} region=${args.region}`,
  );

  const allCandidates = await listAiSummaryQueueForDate({
    scrapedDate: dateIso,
    force: true,
    sourceRegion: args.region,
    aiSummaryRequired,
  });
  const pending = await listAiSummaryQueueForDate({
    scrapedDate: dateIso,
    // When retrying explicit failed IDs, always include them even if an AI URL
    // was partially written; otherwise --force is required for missing-AI resume.
    force: args.force || Boolean(idFilter?.length),
    sourceRegion: args.region,
    aiSummaryRequired,
  });
  const skippedExistingAi = Math.max(0, allCandidates.length - pending.length);
  summary.selected = allCandidates.length;
  summary.skippedExistingAi = idFilter?.length ? 0 : skippedExistingAi;

  let queue = pending;
  if (idFilter?.length) {
    const wanted = new Set(idFilter);
    queue = pending.filter((row) => wanted.has(row.sourceTenderId));
    const found = new Set(queue.map((row) => row.sourceTenderId));
    const missing = idFilter.filter((id) => !found.has(id));
    if (missing.length) {
      logger.warn(
        `AI_SUMMARY_PIPELINE_IDS_NOT_IN_QUEUE count=${missing.length} ids=${missing.join(",")}`,
      );
      console.log(
        `AI_SUMMARY_PIPELINE_IDS_NOT_IN_QUEUE=${missing.join(",")}`,
      );
    }
  }

  // Resume/skip is decided only from Supabase documents_zip_url / ai_summary_url.
  // Local downloads/ folders are cache and must not remove tenders from the queue.
  // Global: documents_zip_url alone is enough (AI Summary optional).
  const skippedCompleteIds: string[] = [];
  if (!args.force && !idFilter?.length) {
    for (const row of allCandidates) {
      const mode = resolveAiSummaryArtifactMode({
        documentsZipUrl: row.documentsZipUrl,
        aiSummaryUrl: row.aiSummaryUrl,
        aiSummaryRequired,
      });
      if (mode === "SKIP_ALREADY_COMPLETE") {
        skippedCompleteIds.push(row.sourceTenderId);
        logger.info(`SKIP_ALREADY_COMPLETE=T247-${row.sourceTenderId}`);
      }
    }
  }
  summary.skippedLocalArtifacts = 0;
  for (const row of queue) {
    const mode = resolveAiSummaryArtifactMode({
      documentsZipUrl: row.documentsZipUrl,
      aiSummaryUrl: row.aiSummaryUrl,
      force: args.force,
      aiSummaryRequired,
    });
    logger.info(`${mode}=T247-${row.sourceTenderId}`);
    console.log(`${mode}=T247-${row.sourceTenderId}`);
  }
  if (skippedCompleteIds.length) {
    console.log(`SKIP_ALREADY_COMPLETE count=${skippedCompleteIds.length}`);
  }

  if (args.limit != null) {
    queue = queue.slice(0, args.limit);
  }

  const queuePath = writeQueueArtifact(dateFolder, {
    runDate: dateIso,
    mode: aiSummaryRequired ? "ai-summary-first" : "global-documents-first",
    source: "agenttender_tenders (all statuses including NO_GO)",
    sourceRegion: args.region,
    aiSummaryRequired,
    statuses: [...QUEUE_STATUSES, "*"],
    force: args.force,
    dryRun: args.dryRun,
    documentsOnlyIfAiMissing: false,
    allowNoBidDetailOpen: true,
    idFilter: idFilter || null,
    onlyFailed: args.onlyFailed,
    autoResumeMode,
    totalMatching: allCandidates.length,
    skippedExistingAi: summary.skippedExistingAi,
    skippedAlreadyComplete: skippedCompleteIds.length,
    skippedLocalArtifacts: 0,
    queued: queue.length,
    ids: queue.map((r) => r.sourceTenderId),
    rows: queue,
    updatedAt: new Date().toISOString(),
  });

  logger.info(`AI_SUMMARY_PIPELINE_QUEUE_FILE=${queuePath}`);
  logger.info(
    `AI_SUMMARY_PIPELINE_SELECTED total=${allCandidates.length} queued=${queue.length} skippedAiUrls=${summary.skippedExistingAi} skippedComplete=${skippedCompleteIds.length}`,
  );
  console.log(
    `AI_SUMMARY_PIPELINE_QUEUE queued=${queue.length} skippedExistingAi=${summary.skippedExistingAi} skippedComplete=${skippedCompleteIds.length}`,
  );

  if (args.dryRun) {
    console.log("AI_SUMMARY_PIPELINE_DRY_RUN=true");
    console.log(
      `AI_SUMMARY_PIPELINE_IDS=${queue.map((r) => r.sourceTenderId).join(",")}`,
    );
    return summary;
  }

  if (queue.length === 0) {
    console.log("AI_SUMMARY_PIPELINE_EMPTY=true");
    fs.writeFileSync(
      path.join(dateFolder, "ai-summary-pipeline-summary.json"),
      JSON.stringify(summary, null, 2),
      "utf8",
    );
    return summary;
  }

  const authPath = resolveTender247AuthPath(config);
  if (!authPath) {
    throw new AutomationError(
      "TENDER247_AUTH_NOT_FOUND",
      "Missing Tender247 storage state. Run: npm run auth:tender247 -- --account-id=<uuid>",
    );
  }

  const pipelineRunId = await startPipelineRun({
    companyId: account.companyId,
    tender247AccountId: account.accountId,
    runDate: dateIso,
    mode: "ai-summary-pipeline",
    resume: !args.force,
  });
  await markTender247AccountUsed(account.accountId);

  let session: Awaited<ReturnType<typeof launchBrowserSession>> | undefined;
  try {
    await withTender247AccountContextAsync(account, async () => {
      await withTender247RunContextAsync(runContext, async () => {
        logger.info(
          `AI_SUMMARY_PIPELINE_BROWSER_LAUNCH accountId=${account.accountId}`,
        );
        session = await launchBrowserSession({
          headless: config.headless,
          storageStatePath: authPath,
          downloadPath: path.join(dateFolder, "playwright-downloads"),
          pageTimeoutMs: config.pageTimeoutMs,
        });
        const listPage = session.page;
        const { context } = session;

        await loginToTender247(listPage, context, logger, config);
        await dismissTender247Interruptions(listPage, logger, config);

        const mailDate = await ensureTender247FreshListForDate(
          listPage,
          dateIso,
          logger,
          config.pageTimeoutMs,
        );
        assertMailDateReadyForExcel(mailDate, dateIso);
        if (mailDate.selectedMailDateIso !== dateIso) {
          throw new AutomationError(
            "TENDER247_DATE_FILTER_MISMATCH",
            `AI summary pipeline mail date mismatch requested=${dateIso} selected=${mailDate.selectedMailDateIso}`,
          );
        }

        const screeningStatusById = new Map<string, string>();
        const excelValueById = new Map<
          string,
          {
            parsedTenderValueInr: number | null;
            parsedEmdInr: number | null;
            title?: string;
            deadline?: string | null;
          }
        >();
        for (const row of queue) {
          const crawl =
            normalizePhase1CrawlStatus(row.qualificationStatus) || "VERIFY";
          screeningStatusById.set(row.sourceTenderId, crawl);
          excelValueById.set(row.sourceTenderId, {
            parsedTenderValueInr: null,
            parsedEmdInr: null,
            title: row.title || undefined,
            deadline: null,
          });
        }

        const survivorIds = queue.map((r) => r.sourceTenderId);
        const existingArtifactUrlsById = new Map(
          queue.map((row) => [
            row.sourceTenderId,
            {
              documentsZipUrl: row.documentsZipUrl,
              aiSummaryUrl: row.aiSummaryUrl,
            },
          ]),
        );
        console.log(`AI_SUMMARY_PIPELINE_CRAWL_START count=${survivorIds.length}`);
        logger.info(
          `AI_SUMMARY_PIPELINE_CRAWL_START count=${survivorIds.length} documentsOnlyIfAiMissing=false aiSummaryRequired=${aiSummaryRequired}`,
        );

        const parallel = await processSurvivorsInParallel({
          listPage,
          context,
          survivorIds,
          dateFolder,
          config,
          logger,
          alreadyCompleted: new Set<string>(),
          force: args.force,
          documentsOnlyIfAiMissing: false,
          allowNoBidDetailOpen: true,
          aiSummaryRequired,
          phase1ScreeningAuthoritative: true,
          screeningStatusById,
          excelValueById,
          existingArtifactUrlsById,
          sourceRegion: args.region,
        });

        summary.attempted = parallel.attemptedIds.length;
        summary.failed = parallel.failedIds.length;
        summary.failedIds = [...parallel.failedIds];
        for (const id of summary.failedIds) {
          logger.info(`FAILED=T247-${id}`);
          console.log(`FAILED=T247-${id}`);
        }

        // Indian: AI complete = full success; docs-only = partial.
        // Global: documents complete = full success (AI optional).
        for (const result of parallel.results) {
          if (summary.failedIds.includes(result.t247Id)) continue;
          if (aiSummaryRequired) {
            if (result.aiSummaryStatus === "complete") {
              summary.fullSuccess += 1;
            } else if (
              result.allDocumentsStatus === "complete" ||
              result.allDocumentsStatus === "partial" ||
              result.status === "completed" ||
              result.status === "partial"
            ) {
              summary.partialSuccess += 1;
            }
          } else if (
            result.allDocumentsStatus === "complete" ||
            result.artifactComplete ||
            result.status === "completed"
          ) {
            summary.fullSuccess += 1;
          } else if (
            result.allDocumentsStatus === "partial" ||
            result.status === "partial"
          ) {
            summary.partialSuccess += 1;
          }
        }

        await persistAuthState(context, config, logger);
      });
    });

    await finishPipelineRun({
      runId: pipelineRunId,
      status:
        summary.failed > 0 && summary.fullSuccess + summary.partialSuccess === 0
          ? "failed"
          : summary.failed > 0
            ? "completed_with_failures"
            : "success",
      summary: {
        accountId: account.accountId,
        requestedDate: dateIso,
        ...summary,
      },
    });
  } catch (error) {
    await finishPipelineRun({
      runId: pipelineRunId,
      status: "failed",
      summary: {
        accountId: account.accountId,
        error: safeErrorMessage(error),
      },
    });
    throw error;
  } finally {
    if (session) {
      await closeBrowserSession(session).catch(() => undefined);
    }
  }

  console.log("");
  console.log("==================================");
  console.log("AI Summary–First Document Pipeline");
  console.log(`Date: ${summary.date}`);
  console.log(
    `Excel: downloaded=${summary.excelDownloaded} path=${summary.excelPath || "n/a"}`,
  );
  console.log(
    `Upsert: attempted=${summary.upsertAttempted} stored=${summary.upsertStored} created=${summary.upsertCreated} updated=${summary.upsertUpdated}`,
  );
  console.log(`Selected (DB): ${summary.selected}`);
  console.log(`Skipped (both Azure URLs already set): ${summary.skippedExistingAi}`);
  console.log(
    `Skipped (local folder completeness): ${summary.skippedLocalArtifacts} (disabled; Supabase URLs are canonical)`,
  );
  console.log(`Attempted: ${summary.attempted}`);
  console.log(`AI Summary success: ${summary.fullSuccess}`);
  console.log(`Docs fallback / partial: ${summary.partialSuccess}`);
  console.log(`Failed: ${summary.failed}`);
  if (summary.failedIds.length) {
    console.log(`Failed IDs: ${summary.failedIds.join(", ")}`);
  }
  if (summary.failed > 0) {
    console.log("Batch finished with failures — not all tenders succeeded.");
  }
  console.log("==================================");

  fs.writeFileSync(
    path.join(dateFolder, "ai-summary-pipeline-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
  return summary;
}

async function main(): Promise<void> {
  try {
    await runAiSummaryFirstDocumentPipeline();
  } catch (error) {
    const code =
      error instanceof AutomationError
        ? error.code
        : "AI_SUMMARY_PIPELINE_FAILED";
    const message = safeErrorMessage(error);
    console.error(`\n${code}\n${message}\n`);
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === thisFile) {
  void main();
}

/**
 * AI-summary Tender247 pipeline (AI Summary + all documents).
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
  inspectTenderArtifactState,
  listT247TenderDirs,
} from "../tender247Batch/tenderArtifactState.js";
import {
  createTender247RunContext,
  ensureTender247DateScopedDir,
  logTender247RunContext,
  resolveSeedExcelDir,
  withTender247RunContextAsync,
} from "../tender247Batch/tender247RunContext.js";
import { downloadTodayExcel } from "../tender247Excel/testTender247ExcelFilter.js";
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

export type AiSummaryPipelineSummary = {
  date: string;
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
  const summaryPath = path.join(dateFolder, "ai-summary-pipeline-summary.json");
  if (!fs.existsSync(summaryPath)) {
    throw new AutomationError(
      "AI_SUMMARY_FAILED_SUMMARY_MISSING",
      `Missing ${summaryPath}. Run a full AI-summary pipeline first, or pass --ids=...`,
    );
  }
  const parsed = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
    failedIds?: unknown;
  };
  const ids = Array.isArray(parsed.failedIds)
    ? parsed.failedIds
        .map((id) => normalizeTenderIdDigits(String(id)))
        .filter(Boolean)
    : [];
  if (!ids.length) {
    throw new AutomationError(
      "AI_SUMMARY_FAILED_IDS_EMPTY",
      `${summaryPath} has no failedIds to retry`,
    );
  }
  return [...new Set(ids)];
}

function parseArgs(argv: string[]): {
  date: string;
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
  return {
    date: resolved.requestedDate,
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
}): Promise<{
  attempted: boolean;
  stored: number;
  created: number;
  updated: number;
  excelPath: string | null;
}> {
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
  console.log(`AI_SUMMARY_PIPELINE_UPSERT_EXCEL=${excelPath}`);
  console.log(`AI_SUMMARY_PIPELINE_UPSERT_ROWS=${rows.length}`);

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
}): Promise<{
  attempted: boolean;
  stored: number;
  created: number;
  updated: number;
  excelPath: string | null;
  excelDownloaded: boolean;
}> {
  options.logger.info(
    `AI_SUMMARY_PIPELINE_EXCEL_DOWNLOAD_START date=${options.runDate}`,
  );
  console.log(
    `AI_SUMMARY_PIPELINE_EXCEL_DOWNLOAD_START date=${options.runDate}`,
  );

  const excelPath = await downloadTodayExcel({
    dateFolder: options.dateFolder,
    logger: options.logger,
    dateIso: options.runDate,
  });

  options.logger.info(`AI_SUMMARY_PIPELINE_EXCEL_DOWNLOADED=${excelPath}`);
  console.log(`AI_SUMMARY_PIPELINE_EXCEL_DOWNLOADED=${excelPath}`);

  const upsert = await upsertScreenedTendersForDate({
    runDate: options.runDate,
    dateFolder: options.dateFolder,
    logger: options.logger,
    companyId: options.companyId,
    excelPath,
  });

  return {
    ...upsert,
    excelDownloaded: true,
  };
}

export async function listAiSummaryQueueForDate(options: {
  scrapedDate: string;
  force?: boolean;
}): Promise<AiSummaryQueueRow[]> {
  if (!isSupabaseConfigured()) {
    throw new AutomationError(
      "SUPABASE_NOT_CONFIGURED",
      "Supabase is not configured — cannot build AI summary queue",
    );
  }
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
      ? String(row.documents_zip_url)
      : null;
    const aiSummaryUrl = row.ai_summary_url
      ? String(row.ai_summary_url)
      : null;

    // Finished only when BOTH Azure artifact URLs exist (unless --force).
    // Missing docs URL must still crawl even if AI Summary URL is already set.
    if (!options.force && aiSummaryUrl && documentsZipUrl) {
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

  const dateFolder = runContext.downloadRoot;
  ensureTender247DateScopedDir(dateFolder, dateIso);

  const summary: AiSummaryPipelineSummary = {
    date: dateIso,
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

  const idFilter: string[] | null = args.onlyFailed
    ? loadFailedIdsFromSummary(dateFolder)
    : args.ids;
  if (args.onlyFailed && args.ids?.length) {
    throw new AutomationError(
      "AI_SUMMARY_ID_FILTER_CONFLICT",
      "Pass either --only-failed or --ids=..., not both",
    );
  }
  if (idFilter?.length) {
    logger.info(
      `AI_SUMMARY_PIPELINE_ID_FILTER count=${idFilter.length} source=${
        args.onlyFailed ? "ai-summary-pipeline-summary.json" : "--ids"
      }`,
    );
    console.log(
      `AI_SUMMARY_PIPELINE_ID_FILTER count=${idFilter.length} ids=${idFilter.join(",")}`,
    );
  }

  const allCandidates = await listAiSummaryQueueForDate({
    scrapedDate: dateIso,
    force: true,
  });
  const pending = await listAiSummaryQueueForDate({
    scrapedDate: dateIso,
    // When retrying explicit failed IDs, always include them even if an AI URL
    // was partially written; otherwise --force is required for missing-AI resume.
    force: args.force || Boolean(idFilter?.length),
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

  // Skip browser reopen when local AI + docs are both present AND Azure URLs
  // already exist. If URLs are missing, keep the id in the crawl queue so
  // processTender early-skip can upload without reopening the portal.
  const localDoneIds = new Set<string>();
  if (!args.force) {
    for (const { t247Id, tenderDir } of listT247TenderDirs(dateFolder)) {
      const state = inspectTenderArtifactState(tenderDir, t247Id);
      if (!state.aiSummaryValid || !state.documentsZipValid) continue;
      const pendingRow = pending.find((row) => row.sourceTenderId === t247Id);
      const urlsComplete = Boolean(
        pendingRow?.aiSummaryUrl && pendingRow?.documentsZipUrl,
      );
      // Not in today's pending queue (already finished in DB) — safe to ignore.
      if (!pendingRow) {
        localDoneIds.add(t247Id);
        continue;
      }
      if (!urlsComplete) {
        // Local files exist; leave in queue for Azure upload via early-skip.
        continue;
      }
      localDoneIds.add(t247Id);
      const inFilter = !idFilter?.length || idFilter.includes(t247Id);
      if (inFilter) {
        summary.fullSuccess += 1;
      }
    }
    if (localDoneIds.size) {
      const beforeLocal = queue.length;
      queue = queue.filter((row) => !localDoneIds.has(row.sourceTenderId));
      summary.skippedLocalArtifacts = Math.max(0, beforeLocal - queue.length);
      logger.info(
        `AI_SUMMARY_PIPELINE_SKIP_LOCAL count=${summary.skippedLocalArtifacts} (ai_and_docs_and_urls already present)`,
      );
      console.log(
        `AI_SUMMARY_PIPELINE_SKIP_LOCAL=${summary.skippedLocalArtifacts}`,
      );
    }
  }

  if (args.limit != null) {
    queue = queue.slice(0, args.limit);
  }

  const queuePath = writeQueueArtifact(dateFolder, {
    runDate: dateIso,
    mode: "ai-summary-first",
    source: "agenttender_tenders (all statuses including NO_GO)",
    statuses: [...QUEUE_STATUSES, "*"],
    force: args.force,
    dryRun: args.dryRun,
    documentsOnlyIfAiMissing: false,
    allowNoBidDetailOpen: true,
    idFilter: idFilter || null,
    onlyFailed: args.onlyFailed,
    totalMatching: allCandidates.length,
    skippedExistingAi: summary.skippedExistingAi,
    skippedLocalArtifacts: summary.skippedLocalArtifacts,
    queued: queue.length,
    ids: queue.map((r) => r.sourceTenderId),
    rows: queue,
    updatedAt: new Date().toISOString(),
  });

  logger.info(`AI_SUMMARY_PIPELINE_QUEUE_FILE=${queuePath}`);
  logger.info(
    `AI_SUMMARY_PIPELINE_SELECTED total=${allCandidates.length} queued=${queue.length} skippedAiUrls=${summary.skippedExistingAi} skippedLocal=${summary.skippedLocalArtifacts}`,
  );
  console.log(
    `AI_SUMMARY_PIPELINE_QUEUE queued=${queue.length} skippedExistingAi=${summary.skippedExistingAi} skippedLocal=${summary.skippedLocalArtifacts}`,
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
        console.log(`AI_SUMMARY_PIPELINE_CRAWL_START count=${survivorIds.length}`);
        logger.info(
          `AI_SUMMARY_PIPELINE_CRAWL_START count=${survivorIds.length} documentsOnlyIfAiMissing=false`,
        );

        const parallel = await processSurvivorsInParallel({
          listPage,
          context,
          survivorIds,
          dateFolder,
          config,
          logger,
          alreadyCompleted: localDoneIds,
          force: args.force,
          documentsOnlyIfAiMissing: false,
          allowNoBidDetailOpen: true,
          phase1ScreeningAuthoritative: true,
          screeningStatusById,
          excelValueById,
        });

        summary.attempted = parallel.attemptedIds.length;
        summary.failed = parallel.failedIds.length;
        summary.failedIds = [...parallel.failedIds];

        // AI complete = full success for this pipeline.
        // Docs-only fallback (no AI) = partial.
        for (const result of parallel.results) {
          if (summary.failedIds.includes(result.t247Id)) continue;
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
  console.log(`Skipped (AI or zip URL already set): ${summary.skippedExistingAi}`);
  console.log(
    `Skipped (local AI or docs already present): ${summary.skippedLocalArtifacts}`,
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

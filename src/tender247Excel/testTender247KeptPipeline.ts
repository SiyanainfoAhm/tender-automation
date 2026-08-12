/**
 * Tender247 post-Excel integration test (production order).
 *
 * Flow:
 *   Download today's Excel (unless --file / --no-fresh-excel)
 *     → financial filter → 02-kept.xlsx
 *     → IT relevance scan per financial survivor (detail metadata only)
 *     → for each IT_RELEVANT (up to --limit):
 *         documents → Supabase → detailed prescreen → ChatGPT (PASSED only)
 *     → if ChatGPT status is GO and --stop-on-go (default): stop test
 *     → else continue to next IT_RELEVANT
 *
 * --limit=N = max IT_RELEVANT candidates to process — NON_IT / AMBIGUOUS do not count.
 *
 * Usage:
 *   npm run test:tender247:kept-pipeline -- --date=2026-08-12 --stop-on-go --limit=20
 *   npm run test:tender247:kept-pipeline -- --file=downloads/.../02-kept.xlsx --no-fresh-excel
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";
import {
  AutomationError,
  closeBrowserSession,
  launchBrowserSession,
} from "../browserUtils.js";
import { loadConfig, resolveTender247AuthPath, type AppConfig } from "../config.js";
import {
  createTender247RunContext,
  ensureTender247DateScopedDir,
  logTender247RunContext,
  parseCliDateOrToday,
  withTender247RunContextAsync,
} from "../tender247Batch/tender247RunContext.js";
import { Logger, safeErrorMessage } from "../logger.js";
import {
  loginToTender247,
  persistAuthState,
} from "../tenderDetails/ensureTender247LoggedIn.js";
import { dismissTender247BlockingOverlays } from "../tenderDetails/dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "../tenderDetails/dismissSupportChat.js";
import { assertMailDateReadyForExcel } from "../tenderDetails/selectTender247MailDate.js";
import { ensureTender247FreshListForDate } from "../tender247Batch/ensureTender247FreshListForDate.js";
import { processLiveTender } from "../tender247Batch/processTender.js";
import {
  cleanOrphanUuidFilesInDayFolder,
  cleanPlaywrightDownloadTemp,
} from "../tender247Batch/createTenderZip.js";
import { assertPrescreenAllowsChatgpt } from "../prescreen/chatgptGate.js";
import { selectPassedForChatgpt } from "../prescreen/selectPassedForChatgpt.js";
import {
  closeChatGptSession,
  ensureChatGptLoggedIn,
  launchChatGptPersistentSession,
} from "../chatgptQualification/ensureChatGptLoggedIn.js";
import { openChatGptProject } from "../chatgptQualification/openProject.js";
import { qualifySingleTender } from "../chatgptQualification/processTenderQualification.js";
import { waitForSharedSubmissionInterval } from "../chatgptQualification/submissionThrottle.js";
import { verifySourceTenderMetadataRow } from "../supabase/tenderMetadataStore.js";
import { classifyKeptCandidateRelevance } from "./classifyKeptRelevance.js";
import {
  downloadTodayExcel,
  runExcelFilterDryRunOnFile,
} from "./testTender247ExcelFilter.js";
import {
  loadFinancialFilterSummaryCounts,
  readAllKeptCandidatesFromExcel,
  resolveDefaultKeptExcelPath,
  resolveExcelFilterReviewDir,
  type KeptExcelCandidate,
} from "./parseKeptExcelRows.js";
import {
  filterItRelevantWithinFinancialKeep,
  selectFirstItRelevantCandidates,
  type RelevanceScanRecord,
} from "./selectItRelevantCandidates.js";
import {
  printFilteredPipelineSummary,
  printKeptPipelineCandidatePaths,
  writeExcelFilterRelevanceReview,
  writeKeptPipelineAudit,
  type KeptPipelinePathResult,
} from "./writeKeptPipelineAudit.js";

export type KeptPipelineArgs = {
  date: string;
  limit: number;
  file: string | null;
  /** Download today's Excel and run financial filter before IT scan (default when --file omitted). */
  freshExcel: boolean;
  /** Stop after first ChatGPT qualification with status GO (default true). */
  stopOnGo: boolean;
};

export function parseKeptPipelineArgs(argv: string[]): KeptPipelineArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      values.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(body, next);
      i += 1;
    } else {
      values.set(body, "true");
    }
  }

  const date = parseCliDateOrToday(values.get("date") || null);

  const limitRaw = values.get("limit") ?? "20";
  const limit = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`Invalid --limit=${limitRaw}; expected positive integer`);
  }
  if (limit > 50) {
    throw new Error(
      `KEPT_PIPELINE_LIMIT_TOO_HIGH=${limit}; max allowed for this test is 50`,
    );
  }

  const fileRaw = values.get("file")?.trim() || null;
  const file = fileRaw && fileRaw.length > 0 ? fileRaw : null;
  const freshExcel = values.has("no-fresh-excel")
    ? false
    : values.has("fresh-excel") || file === null;
  const stopOnGo = !values.has("no-stop-on-go");

  return {
    date,
    limit,
    file,
    freshExcel,
    stopOnGo,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorCode: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function logRelevanceDecision(
  record: RelevanceScanRecord,
  logger: Logger,
): void {
  const id = record.candidate.sourceTenderId;
  console.log(`T247-${id}`);
  console.log(`DETAIL_RESOLVED=${record.detailResolved}`);
  console.log(`IT_RELEVANCE=${record.relevance}`);
  logger.info(`T247-${id}`);
  logger.info(`DETAIL_RESOLVED=${record.detailResolved}`);
  logger.info(`IT_RELEVANCE=${record.relevance}`);

  if (!record.detailResolved) {
    console.log(`TENDER247_DETAIL_RESOLVE_FAILED=${id}`);
    logger.info(`TENDER247_DETAIL_RESOLVE_FAILED=${id}`);
    console.log("SKIP");
    logger.info("SKIP");
    return;
  }

  if (record.relevance === "NON_IT") {
    console.log("DOCUMENT_DOWNLOAD_SKIPPED=true");
    console.log("SUPABASE_WRITE_SKIPPED=true");
    console.log("CHATGPT_SKIPPED=true");
    console.log("SKIP");
    logger.info("DOCUMENT_DOWNLOAD_SKIPPED=true");
    logger.info("SUPABASE_WRITE_SKIPPED=true");
    logger.info("CHATGPT_SKIPPED=true");
    logger.info("SKIP");
    return;
  }

  if (record.relevance === "AMBIGUOUS") {
    console.log("MANUAL_REVIEW_REQUIRED=true");
    console.log("DOCUMENT_DOWNLOAD_SKIPPED=true");
    console.log("SUPABASE_WRITE_SKIPPED=true");
    console.log("CHATGPT_SKIPPED=true");
    console.log("SKIP");
    logger.info("MANUAL_REVIEW_REQUIRED=true");
    logger.info("DOCUMENT_DOWNLOAD_SKIPPED=true");
    logger.info("SUPABASE_WRITE_SKIPPED=true");
    logger.info("CHATGPT_SKIPPED=true");
    logger.info("SKIP");
    return;
  }

  if (record.candidateOrdinal != null) {
    console.log(`IT_CANDIDATE=${record.candidateOrdinal}`);
    logger.info(`IT_CANDIDATE=${record.candidateOrdinal}`);
  }
}

function createPathResult(
  record: RelevanceScanRecord,
): KeptPipelinePathResult {
  return {
    sourceTenderId: record.candidate.sourceTenderId,
    title: record.candidate.title,
    financialStatus: "KEEP",
    itRelevance: "IT_RELEVANT",
    itRelevanceReasonCode: record.reasonCode,
    documentsDownloaded: false,
    supabaseStored: false,
    prescreenStatus: null,
    chatgptSubmitted: false,
    chatgptCompleted: false,
    chatgptResult: null,
    error: null,
  };
}

async function processKeptCandidateDownstream(options: {
  listPage: Page;
  context: BrowserContext;
  candidate: KeptExcelCandidate;
  index: number;
  total: number;
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  pathResult: KeptPipelinePathResult;
}): Promise<void> {
  const {
    listPage,
    context,
    candidate,
    index,
    total,
    dateFolder,
    config,
    logger,
    pathResult,
  } = options;

  await listPage.bringToFront().catch(() => undefined);
  await dismissTender247BlockingOverlays(listPage, logger, config).catch(
    () => undefined,
  );

  const processResult = await withTimeout(
    processLiveTender({
      listPage,
      context,
      t247Id: candidate.sourceTenderId,
      index,
      total,
      dateFolder,
      config,
      logger,
      titleHint: candidate.title,
      excelTenderValue: candidate.parsedTenderValueInr,
      excelEmd: candidate.parsedEmdInr,
      openViaSingleTenderDirect: true,
    }),
    config.perTenderTimeoutMs,
    `PER_TENDER_TIMEOUT T247-${candidate.sourceTenderId}`,
  );

  if (
    processResult.status === "dropped_non_it" ||
    processResult.itRelevance === "NON_IT"
  ) {
    pathResult.itRelevance = "NON_IT";
    pathResult.error = "IT gate rejected during process (unexpected)";
    logger.info("DOCUMENT_DOWNLOAD_SKIPPED=true");
    logger.info("SUPABASE_WRITE_SKIPPED=true");
    logger.info("CHATGPT_SKIPPED=true");
    return;
  }
  if (
    processResult.status === "ambiguous_manual_review" ||
    processResult.itRelevance === "AMBIGUOUS"
  ) {
    pathResult.itRelevance = "AMBIGUOUS";
    pathResult.error = "IT gate ambiguous during process (unexpected)";
    logger.info("CHATGPT_SKIPPED=true");
    return;
  }

  pathResult.documentsDownloaded = Boolean(processResult.allDocumentsDownloaded);
  if (processResult.error) {
    pathResult.error = processResult.error;
  }

  if (!processResult.allDocumentsDownloaded) {
    pathResult.error =
      pathResult.error ||
      "Required Tender_All_Documents.zip missing/corrupt — ChatGPT blocked";
    logger.warn(`KEPT_PIPELINE_DOCS_MISSING=T247-${candidate.sourceTenderId}`);
    return;
  }

  const verified = await verifySourceTenderMetadataRow(
    "TENDER247",
    candidate.sourceTenderId,
  );
  if (!verified.ok) {
    pathResult.error =
      pathResult.error ||
      `Supabase verify failed: ${verified.error ?? "unknown"}`;
    return;
  }

  pathResult.supabaseStored = true;
  logger.info(
    `SUPABASE_TENDER_UPSERTED=${verified.id ?? candidate.sourceTenderId}`,
  );
  logger.info(
    `SUPABASE_TENDER_VERIFIED=${verified.id ?? `T247-${candidate.sourceTenderId}`}`,
  );
  console.log(`SUPABASE_TENDER_UPSERTED=${verified.id ?? candidate.sourceTenderId}`);
  console.log(
    `SUPABASE_TENDER_VERIFIED=${verified.id ?? `T247-${candidate.sourceTenderId}`}`,
  );

  console.log(`PRESCREEN_START=${candidate.sourceTenderId}`);
  logger.info(`PRESCREEN_START=${candidate.sourceTenderId}`);
  const gate = await assertPrescreenAllowsChatgpt({
    sourcePortal: "TENDER247",
    sourceTenderId: candidate.sourceTenderId,
    logger,
  });
  pathResult.prescreenStatus = gate.status;
  console.log(`PRESCREEN_STATUS=${gate.status}`);
  logger.info(`PRESCREEN_STATUS=${gate.status}`);
  if (!gate.allowed) {
    logger.info(
      `CHATGPT_SKIPPED=true PRESCREEN=${gate.status} REASON=${gate.reasonCode}`,
    );
  }
}

async function runChatgptForSingleCandidate(options: {
  sourceTenderId: string;
  pathResult: KeptPipelinePathResult;
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  gptSession: Awaited<ReturnType<typeof launchChatGptPersistentSession>>;
}): Promise<string | null> {
  const { sourceTenderId, pathResult, dateFolder, config, logger, gptSession } =
    options;

  const selection = await selectPassedForChatgpt({
    sourcePortal: "TENDER247",
    sourceTenderIds: [sourceTenderId],
    logger,
  });

  if (selection.passedIds.length === 0) {
    const skip = selection.skipped[0];
    if (skip) {
      pathResult.prescreenStatus = skip.status;
    }
    return null;
  }

  pathResult.prescreenStatus = "PASSED";

  await waitForSharedSubmissionInterval({
    minIntervalMs: config.chatgptMinSubmissionIntervalMs,
    logger,
  });

  console.log(`CHATGPT_QUALIFICATION_START=${sourceTenderId}`);
  logger.info(`CHATGPT_QUALIFICATION_START=${sourceTenderId}`);

  const outcome = await qualifySingleTender({
    page: gptSession.page,
    dateFolder,
    t247Id: sourceTenderId,
    config,
    logger,
    manifestTotals: {
      expectedTender247: 1,
      readyForChatGpt: 1,
      selected: 1,
    },
  });

  if (
    outcome.submittedAt ||
    outcome.status === "completed" ||
    outcome.status === "response_pending" ||
    outcome.status === "skipped"
  ) {
    pathResult.chatgptSubmitted = true;
    console.log("CHATGPT_PROMPT_SUBMITTED");
    logger.info("CHATGPT_PROMPT_SUBMITTED");
  }

  if (outcome.status === "completed" || outcome.status === "skipped") {
    pathResult.chatgptCompleted = true;
    console.log("CHATGPT_RESPONSE_COMPLETE");
    logger.info("CHATGPT_RESPONSE_COMPLETE");
  }

  if (outcome.qualification?.status) {
    pathResult.chatgptResult = String(outcome.qualification.status);
    console.log(`CHATGPT_STATUS=${pathResult.chatgptResult}`);
    logger.info(`CHATGPT_STATUS=${pathResult.chatgptResult}`);
  }
  if (outcome.error && !pathResult.error) {
    pathResult.error = outcome.error;
  }

  return pathResult.chatgptResult;
}

async function prepareKeptExcelInput(options: {
  args: KeptPipelineArgs;
  dateFolder: string;
  downloadRoot: string;
  logger: Logger;
}): Promise<string> {
  const { args, dateFolder, downloadRoot, logger } = options;

  if (args.file) {
    logger.info(`KEPT_EXCEL_FILE=${args.file}`);
    console.log(`KEPT_EXCEL_FILE=${args.file}`);
    return args.file;
  }

  if (args.freshExcel) {
    logger.info("TENDER247_FRESH_EXCEL_START");
    console.log("TENDER247_FRESH_EXCEL_START");
    const excelPath = await downloadTodayExcel({
      dateFolder,
      logger,
      dateIso: args.date,
    });
    runExcelFilterDryRunOnFile({
      dateIso: args.date,
      excelPath,
      dateFolder,
    });
    logger.info("TENDER247_FINANCIAL_FILTER_COMPLETE");
    console.log("TENDER247_FINANCIAL_FILTER_COMPLETE");
  }

  const keptExcel = resolveDefaultKeptExcelPath(downloadRoot, args.date);
  logger.info(`KEPT_EXCEL=${keptExcel}`);
  console.log(`KEPT_EXCEL=${keptExcel}`);
  return keptExcel;
}

async function runKeptPipelineTest(): Promise<void> {
  const args = parseKeptPipelineArgs(process.argv.slice(2));
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "Tender247KeptPipeline");
  const runContext = createTender247RunContext(config.downloadRoot, args.date);
  logTender247RunContext(runContext);
  logger.info(`TENDER247_RUN_REQUESTED_DATE=${runContext.requestedDate}`);
  logger.info(`TENDER247_RUN_DOWNLOAD_ROOT=${runContext.downloadRoot}`);

  await withTender247RunContextAsync(runContext, async () => {
    await runKeptPipelineTestBody({ args, config, logger, runContext });
  });
}

async function runKeptPipelineTestBody(options: {
  args: ReturnType<typeof parseKeptPipelineArgs>;
  config: ReturnType<typeof loadConfig>;
  logger: Logger;
  runContext: ReturnType<typeof createTender247RunContext>;
}): Promise<void> {
  const { args, config, logger, runContext } = options;
  const dateFolder = runContext.downloadRoot;
  ensureTender247DateScopedDir(dateFolder, args.date);

  const reviewDir = resolveExcelFilterReviewDir(config.downloadRoot, args.date);

  logger.info("KEPT_PIPELINE_TEST_START");
  console.log("KEPT_PIPELINE_TEST_START");
  console.log(`STOP_ON_GO=${args.stopOnGo}`);
  logger.info(`STOP_ON_GO=${args.stopOnGo}`);

  const keptExcel = await prepareKeptExcelInput({
    args,
    dateFolder,
    downloadRoot: config.downloadRoot,
    logger,
  });

  const financialSurvivors = readAllKeptCandidatesFromExcel(keptExcel);
  if (financialSurvivors.length === 0) {
    throw new Error(`KEPT_PIPELINE_NO_ROWS=${keptExcel}`);
  }

  const financialIds = new Set(
    financialSurvivors.map((c) => c.sourceTenderId),
  );
  const financialCounts = loadFinancialFilterSummaryCounts(
    reviewDir,
    financialSurvivors.length,
  );

  logger.info(`FINANCIAL_SURVIVORS=${financialSurvivors.length}`);
  console.log(`FINANCIAL_SURVIVORS=${financialSurvivors.length}`);

  const authPath = resolveTender247AuthPath(config);
  if (!authPath) {
    throw new AutomationError(
      "TENDER247_AUTH_NOT_FOUND",
      "Missing auth/tender247.json. Run: npm run auth:tender247",
    );
  }

  const playwrightTemp = path.join(dateFolder, "playwright-downloads");
  ensureTender247DateScopedDir(playwrightTemp, args.date);
  const session = await launchBrowserSession({
    headless: config.headless,
    storageStatePath: authPath,
    downloadPath: playwrightTemp,
    pageTimeoutMs: config.pageTimeoutMs,
  });

  const listPage = session.page;
  const context = session.context;

  const scan: RelevanceScanRecord[] = [];
  const selectedIt: RelevanceScanRecord[] = [];
  const results: KeptPipelinePathResult[] = [];
  let stopPipeline = false;
  let gptSession: Awaited<ReturnType<typeof launchChatGptPersistentSession>> | null =
    null;

  try {
    await loginToTender247(listPage, context, logger, config);
    await dismissTender247BlockingOverlays(listPage, logger, config);
    await dismissTender247SupportChat(listPage, logger).catch(() => undefined);
    const mailDate = await ensureTender247FreshListForDate(
      listPage,
      args.date,
      logger,
      config.pageTimeoutMs,
    );
    assertMailDateReadyForExcel(mailDate, args.date);

    logger.info("TENDER247_RELEVANCE_SCAN_START");
    console.log("TENDER247_RELEVANCE_SCAN_START");

    for (const survivor of financialSurvivors) {
      if (stopPipeline) break;
      if (selectedIt.length >= args.limit) break;

      await listPage.bringToFront().catch(() => undefined);
      await dismissTender247BlockingOverlays(listPage, logger, config).catch(
        () => undefined,
      );
      await dismissTender247SupportChat(listPage, logger).catch(() => undefined);

      let record: RelevanceScanRecord;
      try {
        record = await classifyKeptCandidateRelevance({
          listPage,
          context,
          candidate: survivor,
          config,
          logger,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`TENDER247_DETAIL_RESOLVE_FAILED=${survivor.sourceTenderId}`);
        logger.warn(
          `RELEVANCE_SCAN_UNCAUGHT=T247-${survivor.sourceTenderId} ${message}`,
        );
        record = {
          candidate: survivor,
          relevance: "AMBIGUOUS",
          reasonCode: "INSUFFICIENT_SCOPE_EVIDENCE",
          matchedTerms: [],
          negativeTerms: [],
          evidenceFields: [],
          explanation: message,
          candidateOrdinal: null,
          detailOpened: false,
          detailResolved: false,
          error: message,
        };
      }
      scan.push(record);

      if (
        record.relevance !== "IT_RELEVANT" ||
        !record.detailResolved ||
        !financialIds.has(survivor.sourceTenderId)
      ) {
        logRelevanceDecision(record, logger);
        continue;
      }

      const ordinal = selectedIt.length + 1;
      const selectedRecord: RelevanceScanRecord = {
        ...record,
        candidateOrdinal: ordinal,
      };
      scan[scan.length - 1] = selectedRecord;
      selectedIt.push(selectedRecord);
      logRelevanceDecision(selectedRecord, logger);

      logger.info("DOCUMENT_DOWNLOAD_START");
      console.log("DOCUMENT_DOWNLOAD_START");
      logger.info(
        `KEPT_PIPELINE_PROCESS=${ordinal}/${args.limit} T247-${survivor.sourceTenderId}`,
      );

      const pathResult = createPathResult(selectedRecord);
      results.push(pathResult);

      try {
        await processKeptCandidateDownstream({
          listPage,
          context,
          candidate: survivor,
          index: ordinal,
          total: args.limit,
          dateFolder,
          config,
          logger,
          pathResult,
        });

        if (pathResult.supabaseStored && config.chatgptQualificationEnabled) {
          if (!gptSession) {
            gptSession = await launchChatGptPersistentSession({ config, logger });
            await ensureChatGptLoggedIn({
              page: gptSession.page,
              context: gptSession.context,
              config,
              logger,
            });
            await openChatGptProject({
              page: gptSession.page,
              projectName: config.chatgptProjectName,
              projectUrl: config.chatgptProjectUrl,
              projectMatch: config.chatgptProjectMatch,
              config,
              logger,
            });
          }

          const qualStatus = await runChatgptForSingleCandidate({
            sourceTenderId: survivor.sourceTenderId,
            pathResult,
            dateFolder,
            config,
            logger,
            gptSession,
          });

          if (args.stopOnGo && qualStatus === "GO") {
            console.log("KEPT_PIPELINE_STOP_ON_GO=true");
            logger.info("KEPT_PIPELINE_STOP_ON_GO=true");
            stopPipeline = true;
          }
        } else if (!config.chatgptQualificationEnabled) {
          logger.warn(
            "CHATGPT_QUALIFICATION_ENABLED=false — skipping ChatGPT stage",
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pathResult.error = message;
        logger.error(
          `KEPT_PIPELINE_CANDIDATE_FAILED=T247-${survivor.sourceTenderId}: ${message}`,
        );
        await listPage.bringToFront().catch(() => undefined);
        for (const p of context.pages()) {
          if (p !== listPage && !p.isClosed()) {
            await p.close({ runBeforeUnload: false }).catch(() => undefined);
          }
        }
      } finally {
        cleanPlaywrightDownloadTemp(dateFolder, logger);
        cleanOrphanUuidFilesInDayFolder(dateFolder, logger);
      }
    }

    const withinKeep = filterItRelevantWithinFinancialKeep(
      scan.filter((r) => r.detailResolved),
      financialIds,
    );
    const selectedFromScan = selectFirstItRelevantCandidates(
      withinKeep,
      args.limit,
    );
    if (selectedFromScan.length !== selectedIt.length) {
      logger.warn(
        `KEPT_PIPELINE_SELECTION_MISMATCH scan=${selectedFromScan.length} processed=${selectedIt.length}`,
      );
    }

    logger.info(`FILTERED_IT_CANDIDATES_SELECTED=${selectedIt.length}`);
    console.log(`FILTERED_IT_CANDIDATES_SELECTED=${selectedIt.length}`);

    await persistAuthState(context, config, logger);
    await closeBrowserSession(session);
    logger.info("Tender247 browser closed");
  } finally {
    if (gptSession) {
      await closeChatGptSession(gptSession);
    }
    try {
      await closeBrowserSession(session);
    } catch {
      // already closed
    }
  }

  if (selectedIt.length === 0) {
    logger.warn("KEPT_PIPELINE_NO_IT_RELEVANT_CANDIDATES");
    console.log("KEPT_PIPELINE_NO_IT_RELEVANT_CANDIDATES");
  }

  finalizeAndPrint({
    dateFolder,
    reviewDir,
    financialCounts,
    scan,
    selectedIt,
    results,
    argsLimit: args.limit,
    logger,
  });
}

function finalizeAndPrint(options: {
  dateFolder: string;
  reviewDir: string;
  financialCounts: ReturnType<typeof loadFinancialFilterSummaryCounts>;
  scan: RelevanceScanRecord[];
  selectedIt: RelevanceScanRecord[];
  results: KeptPipelinePathResult[];
  argsLimit: number;
  logger: Logger;
}): void {
  const {
    dateFolder,
    reviewDir,
    financialCounts,
    scan,
    selectedIt,
    results,
    argsLimit,
    logger,
  } = options;

  writeExcelFilterRelevanceReview({
    reviewDir,
    scan,
    selectedItRelevant: selectedIt,
  });

  const audit = writeKeptPipelineAudit({
    dateFolder,
    selected: selectedIt.map((r) => r.candidate),
    selectedOrdinals: selectedIt.map((r) => r.candidateOrdinal ?? 0),
    scan,
    results,
  });
  logger.info(`KEPT_PIPELINE_AUDIT=${audit.auditDir}`);
  console.log(`KEPT_PIPELINE_AUDIT=${audit.auditDir}`);

  printFilteredPipelineSummary({
    excelRows: financialCounts.excelRows,
    financialKeep: financialCounts.financialKeep,
    financialDrop: financialCounts.financialDrop,
    relevanceChecked: scan.length,
    itRelevantFound: scan.filter((r) => r.relevance === "IT_RELEVANT").length,
    nonItDropped: scan.filter((r) => r.relevance === "NON_IT").length,
    ambiguous: scan.filter((r) => r.relevance === "AMBIGUOUS").length,
    itCandidatesSelected: selectedIt.length,
    documentsDownloaded: results.filter((r) => r.documentsDownloaded).length,
    supabaseStored: results.filter((r) => r.supabaseStored).length,
    prescreenPassed: results.filter((r) => r.prescreenStatus === "PASSED")
      .length,
    chatgptSubmitted: results.filter((r) => r.chatgptSubmitted).length,
    chatgptCompleted: results.filter((r) => r.chatgptCompleted).length,
  });

  printKeptPipelineCandidatePaths(results);

  if (selectedIt.length < argsLimit) {
    logger.warn(
      `KEPT_PIPELINE_PARTIAL_IT_SELECTION requested=${argsLimit} got=${selectedIt.length}`,
    );
  }
}

async function main(): Promise<void> {
  try {
    await runKeptPipelineTest();
  } catch (error) {
    const code =
      error instanceof AutomationError ? error.code : "UNEXPECTED_ERROR";
    const message = safeErrorMessage(error);
    console.error(`${code}: ${message}`);
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  void main();
}

/** Pure helper for unit tests — IT_RELEVANT-only limit semantics. */
export function selectKeptCandidatesForTest(
  scanLike: Array<{
    sourceTenderId: string;
    relevance: "IT_RELEVANT" | "NON_IT" | "AMBIGUOUS";
    candidate: KeptExcelCandidate;
  }>,
  limit: number,
): KeptExcelCandidate[] {
  const records: RelevanceScanRecord[] = scanLike.map((s) => ({
    candidate: s.candidate,
    relevance: s.relevance,
    reasonCode: "TEST",
    matchedTerms: [],
    negativeTerms: [],
    evidenceFields: [],
    candidateOrdinal: null,
    detailOpened: false,
    detailResolved: true,
    error: null,
  }));
  return selectFirstItRelevantCandidates(records, limit).map((r) => r.candidate);
}

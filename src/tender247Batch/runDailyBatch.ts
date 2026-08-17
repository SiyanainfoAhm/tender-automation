/**
 * Tender247 daily batch — Excel-first early financial gate, then live list:
 * Download today's Excel → DROP over-limit rows (no detail/docs/Supabase) →
 * process only KEEP survivors from Fresh cards (detail tab → docs → ZIP).
 *
 * security_code is captured from real detail navigation/network only —
 * never invented.
 *
 * BidAssist is not part of this batch.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutomationError,
  closeBrowserSession,
  launchBrowserSession,
} from "../browserUtils.js";
import { loadConfig, resolveTender247AuthPath } from "../config.js";
import {
  createTender247RunContext,
  ensureTender247DateScopedDir,
  logTender247RunContext,
  withTender247RunContextAsync,
} from "./tender247RunContext.js";
import {
  assertDatePropagationAgreement,
  hasBooleanFlag,
  resolveRequestedDate,
} from "../cli/requestedDate.js";
import { Logger, safeErrorMessage } from "../logger.js";
import {
  formatProductionLimit,
  resolveProductionLimit,
} from "../productionLimit.js";
import {
  loginToTender247,
  persistAuthState,
} from "../tenderDetails/ensureTender247LoggedIn.js";
import { dismissTender247Interruptions } from "../tenderDetails/dismissTender247Interruptions.js";
import { assertMailDateReadyForExcel } from "../tenderDetails/selectTender247MailDate.js";
import { ensureTender247FreshListForDate } from "./ensureTender247FreshListForDate.js";
import {
  createEmptyManifest,
  loadManifest,
  saveManifest,
  upsertTenderEntry,
} from "./batchManifest.js";
import { downloadTender247DailyExcel } from "../sources/tender247.js";
import { loadPrescreenConfig } from "../prescreen/prescreenConfig.js";
import {
  applyExcelEarlyFinancialFilter,
  printExcelEarlyFilterSummary,
} from "./excelEarlyFinancialFilter.js";
import { writeExcelFilterAudit } from "./excelFilterAudit.js";
import { parseTender247DailyExcelRows } from "./parseDailyExcelRows.js";
import {
  applyTender247ExcelPrescreen,
  printTender247PrescreenCounts,
  writeTender247PrescreenArtifacts,
} from "./tender247ExcelPrescreen.js";
import { createDailyMasterZip, cleanOrphanUuidFilesInDayFolder, cleanPlaywrightDownloadTemp, playwrightDownloadsDir } from "./createTenderZip.js";
import { readFreshExpectedCount } from "./liveListCards.js";
import { processSurvivorsInParallel } from "./processSurvivorsInParallel.js";
import { inspectTenderResumeState } from "./resumeArtifacts.js";
import { loadTender247ConcurrencyConfig } from "./tender247ConcurrencyConfig.js";
import {
  printTender247ScreeningSummary,
  writeItRelevanceAuditOutputs,
  type ItRelevanceAuditRecord,
} from "./itRelevanceAudit.js";
import type { Tender247ItRelevance } from "../prescreen/tender247ItRelevanceClassifier.js";

// HARD GUARD: runDailyBatch must NEVER import or call ensureTodayTendersSelected.
// Calling it stalls on dashboard card diagnostics. Throw BUG_BATCH_CALLED_ENSURE_TODAY
// if that regression is reintroduced.

function acquireLock(lockFilePath: string): void {
  try {
    const fd = fs.openSync(lockFilePath, "wx");
    fs.writeFileSync(
      fd,
      JSON.stringify(
        { pid: process.pid, startedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    fs.closeSync(fd);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "EEXIST") {
      throw new AutomationError(
        "DUPLICATE_EXECUTION",
        `Another crawl/batch is already running (lock: ${lockFilePath})`,
      );
    }
    throw error;
  }
}

function releaseLock(lockFilePath: string): void {
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch {
    // ignore
  }
}

function parseDailyBatchArgs(argv: string[]): {
  date: string;
  dryRunDate: boolean;
  resume: boolean;
} {
  const resolved = resolveRequestedDate(argv);
  const dryRunDate = hasBooleanFlag(argv, "dry-run-date");
  const resume =
    hasBooleanFlag(argv, "resume") ||
    String(process.env.TENDER247_RESUME || "").toLowerCase() === "true";
  return { date: resolved.requestedDate, dryRunDate, resume };
}

async function runDailyBatch(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "Tender247Batch");
  const batchArgs = parseDailyBatchArgs(process.argv.slice(2));
  const dateIso = batchArgs.date;
  const runContext = createTender247RunContext(config.downloadRoot, dateIso);
  logTender247RunContext(runContext);
  logger.info(`TENDER247_RUN_REQUESTED_DATE=${runContext.requestedDate}`);
  logger.info(`TENDER247_RUN_DOWNLOAD_ROOT=${runContext.downloadRoot}`);
  if (batchArgs.dryRunDate) {
    console.log("TENDER247_DRY_RUN_DATE=true");
  }
  if (batchArgs.resume) {
    console.log("TENDER247_RESUME=true");
    logger.info(
      "TENDER247_RESUME=true — reuse existing ZIPs/docs; skip completed detail crawls",
    );
  }

  await withTender247RunContextAsync(runContext, async () => {
    await runDailyBatchBody({
      config,
      logger,
      dateIso,
      runContext,
      dryRunDate: batchArgs.dryRunDate,
    });
  });
}

async function runDailyBatchBody(options: {
  config: ReturnType<typeof loadConfig>;
  logger: Logger;
  dateIso: string;
  runContext: ReturnType<typeof createTender247RunContext>;
  dryRunDate?: boolean;
}): Promise<void> {
  const { config, logger, dateIso, runContext } = options;
  const dryRunDate = options.dryRunDate === true;
  const dateFolder = runContext.downloadRoot;
  ensureTender247DateScopedDir(dateFolder, dateIso);

  if (config.tenderBatchConcurrency !== 1) {
    logger.warn(
      `TENDER_BATCH_CONCURRENCY=${config.tenderBatchConcurrency} overridden to 1`,
    );
  }

  const authPath = resolveTender247AuthPath(config);
  if (!authPath) {
    throw new AutomationError(
      "TENDER247_AUTH_NOT_FOUND",
      "Missing auth/tender247.json. Run: npm run auth:tender247",
    );
  }

  const manifestPath = path.join(dateFolder, "crawl-manifest.json");
  acquireLock(config.crawlLockFilePath);
  let session: Awaited<ReturnType<typeof launchBrowserSession>> | undefined;

  try {
    logger.info("=== Tender247 daily batch started (live-list) ===");
    logger.info(`DATE=${dateIso}`);
    logger.info(`TENDER247_LIMIT=${formatProductionLimit(config.maxTenders)}`);
    logger.info(
      `MAX_TENDERS=${formatProductionLimit(config.maxTenders)}`,
    );
    logger.info(`TENDER_DELAY_MS=${config.tenderDelayMs}`);
    logger.info(`PER_TENDER_TIMEOUT_MS=${config.perTenderTimeoutMs}`);
    logger.info(
      `KEEP_UNZIPPED_TENDER_FOLDERS=${config.keepUnzippedTenderFolders}`,
    );

    const playwrightTemp = playwrightDownloadsDir(dateFolder);
    ensureTender247DateScopedDir(playwrightTemp, dateIso);
    cleanOrphanUuidFilesInDayFolder(dateFolder, logger);

    session = await launchBrowserSession({
      headless: config.headless,
      storageStatePath: authPath,
      downloadPath: playwrightTemp,
      pageTimeoutMs: config.pageTimeoutMs,
    });
    logger.info(`PLAYWRIGHT_DOWNLOADS_PATH=${playwrightTemp}`);

    const listPage = session.page;
    const { context } = session;

    // Auth only — do NOT call ensureTodayTendersSelected (stalls on dashboard cards).
    // Dashboard already loads Today's Fresh list after TENDER247_DASHBOARD_AUTHENTICATED.
    await loginToTender247(listPage, context, logger, config);
    await dismissTender247Interruptions(listPage, logger, config);
    const mailDate = await ensureTender247FreshListForDate(
      listPage,
      dateIso,
      logger,
      config.pageTimeoutMs,
    );
    assertMailDateReadyForExcel(mailDate, dateIso);

    // -------- Excel-first deterministic pre-screen --------
    logger.info("TENDER247_DAILY_EXCEL_DOWNLOAD_START");
    logger.info(`TENDER247_EXCEL_REQUESTED_DATE=${dateIso}`);
    logger.info(`TENDER247_EXCEL_SOURCE_DATE=${mailDate.selectedMailDateIso}`);
    assertDatePropagationAgreement(dateIso, {
      TENDER247_RUN_REQUESTED_DATE: runContext.requestedDate,
      TENDER247_SELECTED_MAIL_DATE: mailDate.selectedMailDateIso,
      TENDER247_EXCEL_REQUESTED_DATE: dateIso,
      TENDER247_EXCEL_SOURCE_DATE: mailDate.selectedMailDateIso,
    });
    if (mailDate.selectedMailDateIso !== dateIso) {
      throw new AutomationError(
        "TENDER247_DATE_FILTER_MISMATCH",
        `TENDER247_DATE_FILTER_MISMATCH requested=${dateIso} selected=${mailDate.selectedMailDateIso}`,
      );
    }
    const excelPath = await downloadTender247DailyExcel(
      listPage,
      config,
      dateFolder,
      logger,
      dateIso,
    );
    logger.info(`TENDER247_DAILY_EXCEL_DOWNLOADED=${excelPath}`);

    const parsedExcel = parseTender247DailyExcelRows(excelPath, logger);
    const prescreenCfg = loadPrescreenConfig();
    const excelFilter = applyExcelEarlyFinancialFilter(parsedExcel.rows, {
      tenderValueMaxInr: prescreenCfg.tenderValueMaxInr,
      tender247EmdMaxInr: prescreenCfg.tender247EmdMaxInr,
    });
    const excelPrescreen = applyTender247ExcelPrescreen(parsedExcel.rows, {
      businessDateIso: dateIso,
      tenderValueMaxInr: prescreenCfg.tenderValueMaxInr,
      tender247EmdMaxInr: prescreenCfg.tender247EmdMaxInr,
    });
    printTender247PrescreenCounts(excelPrescreen);
    const prescreenArtifacts = writeTender247PrescreenArtifacts(
      dateFolder,
      excelPrescreen,
    );
    logger.info(
      `TENDER247_PRESCREEN_ARTIFACTS=${prescreenArtifacts.prescreenJson}`,
    );

    for (const decision of excelFilter.decisions) {
      logger.info(`TENDER247_EXCEL_FILTER=${decision.sourceTenderId}`);
      logger.info(`EXCEL_FILTER_STATUS=${decision.status}`);
      if (decision.status === "DROP") {
        logger.info(`EXCEL_FILTER_REASON=${decision.reasonCode}`);
      } else {
        if (decision.excelTenderValueUnavailable) {
          logger.info("EXCEL_TENDER_VALUE_UNAVAILABLE=true");
        }
        if (decision.excelEmdUnavailable) {
          logger.info("EXCEL_EMD_UNAVAILABLE=true");
        }
        if (decision.reasonCode !== "WITHIN_FINANCIAL_LIMITS") {
          logger.info(`EXCEL_FILTER_REASON=${decision.reasonCode}`);
        }
      }
    }

    const auditPath = writeExcelFilterAudit(dateFolder, excelFilter);
    logger.info(`TENDER247_EXCEL_FILTER_AUDIT=${auditPath}`);
    printExcelEarlyFilterSummary(excelFilter);

    // Detail crawl only for full pre-screen survivors (financial + scope + deadline).
    const survivingIds = new Set(excelPrescreen.survivingTenderIds);

    if (dryRunDate) {
      console.log("TENDER247_DRY_RUN_DATE_COMPLETE=true");
      console.log(`REQUESTED_DATE=${dateIso}`);
      console.log(`DOWNLOAD_ROOT=${dateFolder}`);
      console.log(
        `TENDER247_MAIL_DATE_INPUT_VALUE=${mailDate.mailDateInputValue}`,
      );
      console.log(
        `TENDER247_SELECTED_MAIL_DATE=${mailDate.selectedMailDateIso}`,
      );
      await persistAuthState(context, config, logger);
      return;
    }

    if (survivingIds.size === 0) {
      logger.warn(
        "TENDER247_EXCEL_FILTER_NO_SURVIVORS — skipping detail crawler",
      );
      printExcelEarlyFilterSummary(excelFilter);
      writeItRelevanceAuditOutputs({ dateFolder, records: [] });
      printTender247ScreeningSummary({
        excelRows: excelPrescreen.dailyRowsDeduped,
        droppedFinancialGate:
          excelPrescreen.filterDropEmd + excelPrescreen.filterDropValue,
        financialSurvivors: excelPrescreen.filterPassed,
        itRelevant: 0,
        nonItDropped: excelPrescreen.filterDropNonIt,
        ambiguousManualReview: 0,
        documentDownloads: 0,
        supabaseStored: 0,
        detailedPrescreenPassed: 0,
        detailedPrescreenRejected: 0,
        chatgptSubmitted: 0,
      });
      console.log("");
      console.log("==================================");
      console.log("Tender247 Daily Batch Complete");
      console.log(`Excel rows: ${excelPrescreen.dailyRowsDeduped}`);
      console.log("Detail crawled: 0 (no Excel survivors)");
      console.log("==================================");
      await persistAuthState(context, config, logger);
      return;
    }

    const expectedCount = await readFreshExpectedCount(
      listPage,
      logger,
      dateIso,
    );
    logger.info(`EXPECTED_TODAY_COUNT=${expectedCount}`);
    logger.info(
      `TENDER247_EXCEL_SURVIVORS=${survivingIds.size} detail crawls required`,
    );

    let manifest =
      loadManifest(manifestPath) ??
      createEmptyManifest(dateIso, expectedCount, 0);
    manifest.expectedCount = expectedCount;
    saveManifest(manifestPath, manifest);

    const processedIds = new Set<string>();
    const attemptedIds = new Set<string>();
    const failedIds = new Set<string>();
    const createdZips: string[] = [];
    const itRelevanceAuditRecords: ItRelevanceAuditRecord[] = [];
    const excelDecisionById = new Map(
      excelFilter.decisions.map((d) => [d.sourceTenderId, d]),
    );
    let itRelevantCount = 0;
    let nonItDroppedCount = 0;
    let ambiguousCount = 0;
    let documentDownloadCount = 0;

    // Seed from completed tenders that already have a valid canonical documents ZIP.
    // An outer T247-<id>.zip without documents/Tender_All_Documents.zip is NOT complete.
    for (const name of fs.readdirSync(dateFolder)) {
      const match = name.match(/^T247-(\d+)\.zip$/i);
      if (!match) {
        continue;
      }
      const zipPath = path.join(dateFolder, name);
      if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size <= 0) {
        continue;
      }
      const id = match[1]!;
      const resume = inspectTenderResumeState(dateFolder, id);
      if (!resume.allDocumentsValid) {
        logger.info(
          `T247_RESUME_INCOMPLETE_DOCUMENTS=T247-${id} (outer zip present; canonical documents zip missing)`,
        );
        continue;
      }
      processedIds.add(id);
      createdZips.push(zipPath);
      if (!manifest.tenders[id] || manifest.tenders[id]!.status !== "completed") {
        upsertTenderEntry(manifest, id, {
          status: "completed",
          zipPath,
          zipSize: fs.statSync(zipPath).size,
          documentsDownloaded: manifest.tenders[id]?.documentsDownloaded ?? 0,
          corrigendaDownloaded: manifest.tenders[id]?.corrigendaDownloaded ?? 0,
          aiSummaryDownloaded: manifest.tenders[id]?.aiSummaryDownloaded,
          allDocumentsDownloaded: manifest.tenders[id]?.allDocumentsDownloaded,
          securityCodeCaptured: manifest.tenders[id]?.securityCodeCaptured,
          error: null,
          updatedAt: new Date().toISOString(),
        });
      }
      logger.info(`TENDER247_ALREADY_COMPLETED_SKIP=T247-${id}`);
    }
    saveManifest(manifestPath, manifest);

    const maxTenders = resolveProductionLimit(config.maxTenders);
    let lastKnownVisibleIds = new Set<string>([...survivingIds]);
    let batchIncomplete = false;
    const concurrencyCfg = loadTender247ConcurrencyConfig();

    // Sequential detail/download for Excel survivors (one tender at a time).
    let survivorQueue = [...survivingIds].filter((id) => !processedIds.has(id));
    if (maxTenders < Infinity) {
      survivorQueue = survivorQueue.slice(0, Math.max(0, maxTenders - processedIds.size));
    }

    logger.info("T247_PHASE=ARTIFACT_ACQUISITION");
    logger.info(
      `TENDER247_DETAIL_CONCURRENCY=${concurrencyCfg.detailConcurrency}`,
    );
    logger.info(
      `TENDER247_DOWNLOAD_CONCURRENCY=${concurrencyCfg.downloadConcurrency}`,
    );
    logger.info(
      `TENDER247_ARTIFACT_CONCURRENCY=${concurrencyCfg.artifactConcurrency}`,
    );
    console.log(
      `TENDER247_DETAIL_CONCURRENCY=${concurrencyCfg.detailConcurrency}`,
    );
    console.log(
      `PIPELINE_FINANCIAL_SURVIVORS=${survivingIds.size}`,
    );
    console.log(`PIPELINE_DETAIL_QUEUE=${survivorQueue.length}`);

    const parallel = await processSurvivorsInParallel({
      listPage,
      context,
      survivorIds: survivorQueue,
      dateFolder,
      config,
      logger,
      alreadyCompleted: processedIds,
      concurrency: concurrencyCfg.detailConcurrency,
      excelValueById: new Map(
        [...excelDecisionById.entries()].map(([id, d]) => [
          id,
          {
            parsedTenderValueInr: d.parsedTenderValueInr,
            parsedEmdInr: d.parsedEmdInr,
            title: d.title,
          },
        ]),
      ),
    });

    for (const id of parallel.attemptedIds) {
      attemptedIds.add(id);
    }
    for (const id of parallel.failedIds) {
      failedIds.add(id);
    }
    for (const id of parallel.processedIds) {
      processedIds.add(id);
    }

    for (const result of parallel.results) {
      const t247Id = result.t247Id;
      const zipOk = Boolean(
        result.zipPath &&
          fs.existsSync(result.zipPath) &&
          fs.statSync(result.zipPath).size > 0,
      );

      if (result.itRelevance) {
        const excelRow = excelDecisionById.get(t247Id);
        itRelevanceAuditRecords.push({
          sourceTenderId: t247Id,
          title: result.titleForAudit || excelRow?.title || "",
          excelTenderValue: excelRow?.parsedTenderValueInr ?? null,
          excelEmd: excelRow?.parsedEmdInr ?? null,
          relevance: result.itRelevance as Tender247ItRelevance,
          reasonCode: result.itRelevanceReasonCode || "UNKNOWN",
          matchedTerms: result.itRelevanceMatchedTerms ?? [],
          negativeTerms: result.itRelevanceNegativeTerms ?? [],
          evidenceFields: result.itRelevanceEvidenceFields ?? [],
          explanation: result.itRelevanceExplanation ?? undefined,
        });
        if (result.itRelevance === "IT_RELEVANT") {
          itRelevantCount += 1;
        } else if (result.itRelevance === "NON_IT") {
          nonItDroppedCount += 1;
        } else if (result.itRelevance === "AMBIGUOUS") {
          ambiguousCount += 1;
        }
      }

      if (result.allDocumentsDownloaded) {
        documentDownloadCount += 1;
      }

      upsertTenderEntry(manifest, t247Id, {
        status: result.status,
        zipPath: result.zipPath,
        zipSize:
          result.zipSize ??
          (zipOk && result.zipPath ? fs.statSync(result.zipPath).size : 0),
        documentsDownloaded: result.documentsDownloaded,
        corrigendaDownloaded: result.corrigendaDownloaded,
        aiSummaryDownloaded: Boolean(result.aiSummaryDownloaded),
        allDocumentsDownloaded: Boolean(result.allDocumentsDownloaded),
        securityCodeCaptured: Boolean(result.securityCodeCaptured),
        metadataStatus: result.metadataStatus,
        aiSummaryStatus: result.aiSummaryStatus,
        allDocumentsStatus: result.allDocumentsStatus,
        metadataPath: result.metadataPath,
        aiSummaryPath: result.aiSummaryPath,
        allDocumentsPath: result.allDocumentsPath,
        lastCompletedStep: result.lastCompletedStep,
        error: result.error,
        failedDocuments: result.failedDocuments,
        updatedAt: new Date().toISOString(),
      });

      if (result.zipPath && fs.existsSync(result.zipPath)) {
        createdZips.push(result.zipPath);
      }
    }
    saveManifest(manifestPath, manifest);
    cleanPlaywrightDownloadTemp(dateFolder, logger);
    cleanOrphanUuidFilesInDayFolder(dateFolder, logger);

    const missingSurvivors = [...survivingIds].filter(
      (id) =>
        !processedIds.has(id) &&
        !failedIds.has(id) &&
        !attemptedIds.has(id),
    );
    if (missingSurvivors.length > 0 && maxTenders === Infinity) {
      batchIncomplete = true;
      logger.error("TENDER247_BATCH_INCOMPLETE");
      logger.error(
        `Missing Excel survivors not processed: ${missingSurvivors.join(", ")}`,
      );
    }

    logger.info("TENDER247_EXCEL_SURVIVORS_COMPLETE");
    console.log(`PIPELINE_IT_RELEVANT=${itRelevantCount}`);
    console.log(`PIPELINE_NON_IT_DROPPED=${nonItDroppedCount}`);
    console.log(`PIPELINE_AMBIGUOUS=${ambiguousCount}`);
    console.log(`PIPELINE_DOWNLOAD_COMPLETED=${documentDownloadCount}`);

    if (config.createDailyMasterZip) {
      await createDailyMasterZip({
        dateFolder,
        dateIso,
        zipPaths: createdZips,
        logger,
      });
    }

    const itAudit = writeItRelevanceAuditOutputs({
      dateFolder,
      records: itRelevanceAuditRecords,
    });
    logger.info(`TENDER247_IT_RELEVANCE_AUDIT=${itAudit.jsonPath}`);

    await persistAuthState(context, config, logger);

    const finalManifest = loadManifest(manifestPath) ?? manifest;
    finalManifest.discoveredCount = Math.max(
      finalManifest.discoveredCount,
      lastKnownVisibleIds.size,
      processedIds.size,
    );
    saveManifest(manifestPath, finalManifest);

    const zipCount = createdZips.filter(
      (p) => fs.existsSync(p) && fs.statSync(p).size > 0,
    ).length;

    console.log("");
    console.log("==================================");
    console.log("Tender247 Daily Batch Complete");
    console.log(`Excel rows: ${excelFilter.excelRows}`);
    console.log(
      `Excel early filtered (DROP): ${excelFilter.droppedByTenderValue + excelFilter.droppedByEmd}`,
    );
    console.log(`Excel survivors (KEEP): ${excelFilter.detailCrawlsRequired}`);
    console.log(`Expected Fresh count: ${finalManifest.expectedCount}`);
    console.log(`Detail crawled / processed: ${attemptedIds.size}`);
    console.log(`IT relevant: ${itRelevantCount || itAudit.summary.itRelevant}`);
    console.log(`Non-IT dropped: ${nonItDroppedCount || itAudit.summary.nonItDropped}`);
    console.log(
      `Ambiguous/manual review: ${ambiguousCount || itAudit.summary.ambiguousManualReview}`,
    );
    console.log(`Completed: ${finalManifest.successCount}`);
    console.log(`Partial: ${finalManifest.partialCount}`);
    console.log(`Failed: ${finalManifest.failedCount}`);
    console.log(`ZIP files created: ${zipPathCount(createdZips)}`);
    console.log("==================================");
    printTender247ScreeningSummary({
      excelRows: excelFilter.excelRows,
      droppedFinancialGate:
        excelFilter.droppedByTenderValue + excelFilter.droppedByEmd,
      financialSurvivors: excelFilter.detailCrawlsRequired,
      itRelevant: itAudit.summary.itRelevant,
      nonItDropped: itAudit.summary.nonItDropped,
      ambiguousManualReview: itAudit.summary.ambiguousManualReview,
      documentDownloads: documentDownloadCount,
      supabaseStored: itAudit.summary.itRelevant,
      detailedPrescreenPassed: finalManifest.successCount,
      detailedPrescreenRejected: 0,
      chatgptSubmitted: 0,
    });
    printExcelEarlyFilterSummary(excelFilter, {
      supabaseCandidates: processedIds.size,
      chatgptEligible: undefined,
    });
    if (batchIncomplete) {
      console.log("");
      console.log("TENDER247_BATCH_INCOMPLETE");
      const missingSurvivors = [...survivingIds].filter(
        (id) => !processedIds.has(id) && !failedIds.has(id) && !attemptedIds.has(id),
      );
      console.log(`Missing survivors: ${missingSurvivors.length}`);
      console.log("");
    }

    logger.info(
      `BATCH_SUMMARY excelRows=${excelFilter.excelRows} excelDropped=${
        excelFilter.droppedByTenderValue + excelFilter.droppedByEmd
      } excelKept=${excelFilter.detailCrawlsRequired} itRelevant=${itAudit.summary.itRelevant} nonIt=${itAudit.summary.nonItDropped} ambiguous=${itAudit.summary.ambiguousManualReview} expectedFresh=${finalManifest.expectedCount} processed=${processedIds.size} failedIds=${failedIds.size} completed=${finalManifest.successCount} partial=${finalManifest.partialCount} failed=${finalManifest.failedCount} zipCount=${zipCount} incomplete=${batchIncomplete}`,
    );

    if (
      finalManifest.failedCount > 0 &&
      finalManifest.successCount === 0 &&
      finalManifest.partialCount === 0
    ) {
      process.exitCode = 1;
    }
    if (batchIncomplete) {
      process.exitCode = 1;
    }
  } finally {
    cleanPlaywrightDownloadTemp(dateFolder, logger);
    cleanOrphanUuidFilesInDayFolder(dateFolder, logger);
    await closeBrowserSession(session);
    releaseLock(config.crawlLockFilePath);
    logger.info("Batch browser closed; lock released");
  }
}

function zipPathCount(paths: string[]): number {
  return paths.filter((p) => fs.existsSync(p) && fs.statSync(p).size > 0).length;
}

async function main(): Promise<void> {
  const logger = new Logger(loadConfig().logRoot, "Tender247Batch");
  try {
    await runDailyBatch();
  } catch (error) {
    const code =
      error instanceof AutomationError ? error.code : "UNEXPECTED_ERROR";
    const message = safeErrorMessage(error);
    logger.error(`[${code}] ${message}`);
    console.error(`\n${code}\n${message}\n`);
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  void main();
}

/**
 * Tender247 until-GO validation orchestrator.
 *
 * Downloads today's Excel from scratch, applies financial + IT relevance filters,
 * then processes IT_RELEVANT candidates sequentially until ChatGPT returns GO.
 *
 * Usage:
 *   npm run test:tender247:until-go -- --date=2026-08-12
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
import { loadConfig, resolveTender247AuthPath } from "../config.js";
import {
  createTender247RunContext,
  ensureTender247DateScopedDir,
  logTender247RunContext,
  parseCliDateOrToday,
  resolvePlaywrightDownloadsDir,
  withTender247RunContextAsync,
} from "../tender247Batch/tender247RunContext.js";
import { Logger, safeErrorMessage } from "../logger.js";
import {
  loginToTender247,
  persistAuthState,
} from "../tenderDetails/ensureTender247LoggedIn.js";
import { dismissTender247BlockingOverlays } from "../tenderDetails/dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "../tenderDetails/dismissSupportChat.js";
import { ensureTender247FreshListForDate } from "../tender247Batch/ensureTender247FreshListForDate.js";
import {
  cleanOrphanUuidFilesInDayFolder,
  cleanPlaywrightDownloadTemp,
} from "../tender247Batch/createTenderZip.js";
import type { AttachmentManifestAudit } from "../chatgptQualification/tender247AttachmentManifest.js";
import { isSupabaseConfigured } from "../supabase/client.js";
import { classifyKeptCandidateRelevance } from "./classifyKeptRelevance.js";
import {
  closeChatGptSession,
  createPipelinePathResult,
  ensureChatGptSession,
  logRelevanceDecision,
  processKeptCandidateDownstream,
  runChatgptForPipelineCandidate,
} from "./keptPipelineShared.js";
import {
  loadFinancialFilterSummaryCounts,
  readAllKeptCandidatesFromExcel,
  resolveDefaultKeptExcelPath,
  resolveExcelFilterReviewDir,
} from "./parseKeptExcelRows.js";
import {
  downloadTodayExcel,
  runExcelFilterDryRunOnFile,
} from "./testTender247ExcelFilter.js";
import type { RelevanceScanRecord } from "./selectItRelevantCandidates.js";
import {
  writeExcelFilterRelevanceReview,
  type KeptPipelinePathResult,
} from "./writeKeptPipelineAudit.js";
import {
  printUntilGoSummary,
  writeUntilGoCandidateAudit,
  type UntilGoSummaryStats,
} from "./writeUntilGoAudit.js";

export type UntilGoArgs = {
  date: string;
};

/**
 * Reject npm/tsx forwarding failures such as a lone `--` before any date default.
 */
export function assertUntilGoArgvSane(argv: string[]): void {
  const meaningful = argv.filter((token) => token.trim().length > 0);
  if (meaningful.length === 1 && meaningful[0] === "--") {
    throw new AutomationError(
      "UNTIL_GO_INVALID_CLI_ARGS",
      'Received standalone "--" with no forwarded arguments. Fix package.json (no trailing "--" in the script) and run: npm run test:tender247:until-go -- --date=YYYY-MM-DD',
    );
  }
  if (meaningful.some((token) => token === "--")) {
    throw new AutomationError(
      "UNTIL_GO_INVALID_CLI_ARGS",
      'Received bare "--" mixed with other args; expected --date=YYYY-MM-DD (npm may have failed to forward arguments)',
    );
  }
}

export function parseUntilGoArgs(argv: string[]): UntilGoArgs {
  assertUntilGoArgvSane(argv);

  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    if (body.length === 0) {
      throw new AutomationError(
        "UNTIL_GO_INVALID_CLI_ARGS",
        'Received standalone "--" with no forwarded arguments.',
      );
    }
    const eq = body.indexOf("=");
    if (eq >= 0) {
      const key = body.slice(0, eq);
      const value = body.slice(eq + 1);
      values.set(key, value);
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

  // Prefer explicit --date; also accept DATE= from env for npm/Windows edge cases.
  const fromArgRaw = values.has("date") ? values.get("date") : undefined;
  if (values.has("date") && (fromArgRaw === undefined || fromArgRaw.trim() === "")) {
    throw new AutomationError(
      "UNTIL_GO_INVALID_CLI_ARGS",
      "Invalid --date=; expected YYYY-MM-DD",
    );
  }
  const fromArg = fromArgRaw?.trim();
  const fromEnv = process.env.TENDER247_DATE?.trim() || process.env.DATE?.trim();
  // Explicit CLI --date wins over env defaults.
  const date = parseCliDateOrToday(fromArg || fromEnv || null);
  return { date };
}

function readAttachmentManifestFromTenderFolder(
  tenderFolder: string,
): AttachmentManifestAudit | null {
  const manifestPath = path.join(tenderFolder, "03-attachment-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as AttachmentManifestAudit;
  } catch {
    return null;
  }
}

function bumpResultStat(
  stats: UntilGoSummaryStats,
  status: string | null | undefined,
): void {
  switch (status) {
    case "NO_GO":
      stats.noGo += 1;
      break;
    case "VERIFY":
      stats.verify += 1;
      break;
    case "CONDITIONAL_GO":
      stats.conditionalGo += 1;
      break;
    case "PARTNER_BID":
      stats.partnerBid += 1;
      break;
    case "GO":
      stats.go += 1;
      break;
    default:
      break;
  }
}

async function prepareUntilGoExcelInput(options: {
  date: string;
  dateFolder: string;
  downloadRoot: string;
  logger: Logger;
}): Promise<string> {
  const { date, dateFolder, downloadRoot, logger } = options;

  const excelPath = await downloadTodayExcel({
    dateFolder,
    logger,
    dateIso: date,
  });
  console.log(`TENDER247_DAILY_EXCEL_DOWNLOADED=${excelPath}`);
  logger.info(`TENDER247_DAILY_EXCEL_DOWNLOADED=${excelPath}`);

  runExcelFilterDryRunOnFile({
    dateIso: date,
    excelPath,
    dateFolder,
  });
  logger.info("TENDER247_FINANCIAL_FILTER_COMPLETE");
  console.log("TENDER247_FINANCIAL_FILTER_COMPLETE");

  const keptExcel = resolveDefaultKeptExcelPath(downloadRoot, date);
  logger.info(`KEPT_EXCEL=${keptExcel}`);
  console.log(`KEPT_EXCEL=${keptExcel}`);
  return keptExcel;
}

export async function runUntilGoValidation(): Promise<UntilGoSummaryStats> {
  console.log(`UNTIL_GO_RAW_ARGV=${JSON.stringify(process.argv.slice(2))}`);
  const args = parseUntilGoArgs(process.argv.slice(2));
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "Tender247UntilGo");

  console.log(`UNTIL_GO_CLI_DATE=${args.date}`);
  logger.info(`UNTIL_GO_CLI_DATE=${args.date}`);

  const runContext = createTender247RunContext(config.downloadRoot, args.date);
  logTender247RunContext(runContext);
  logger.info(`TENDER247_RUN_REQUESTED_DATE=${runContext.requestedDate}`);
  logger.info(`TENDER247_RUN_DOWNLOAD_ROOT=${runContext.downloadRoot}`);

  return withTender247RunContextAsync(runContext, async () => {
    const dateFolder = runContext.downloadRoot;
    if (path.basename(path.resolve(dateFolder)) !== args.date) {
      throw new Error(
        `OUTPUT_DIRECTORY_DATE mismatch folder=${dateFolder} requested=${args.date}`,
      );
    }
    ensureTender247DateScopedDir(dateFolder, args.date);
    console.log(`OUTPUT_DIRECTORY_DATE=${args.date}`);
    logger.info(`OUTPUT_DIRECTORY_DATE=${args.date}`);

    const reviewDir = resolveExcelFilterReviewDir(config.downloadRoot, args.date);

    console.log("TENDER247_UNTIL_GO_TEST_START");
    logger.info("TENDER247_UNTIL_GO_TEST_START");
    console.log(`DATE=${args.date}`);
    logger.info(`DATE=${args.date}`);
    console.log(`SUPABASE_WRITES=${isSupabaseConfigured() ? "ENABLED" : "DISABLED"}`);
    logger.info(`SUPABASE_WRITES=${isSupabaseConfigured() ? "ENABLED" : "DISABLED"}`);
    console.log(
      `CHATGPT=${config.chatgptQualificationEnabled ? "ENABLED" : "DISABLED"}`,
    );
    logger.info(
      `CHATGPT=${config.chatgptQualificationEnabled ? "ENABLED" : "DISABLED"}`,
    );
    console.log("STOP_CONDITION=GO");
    logger.info("STOP_CONDITION=GO");

    const keptExcel = await prepareUntilGoExcelInput({
      date: args.date,
      dateFolder,
      downloadRoot: config.downloadRoot,
      logger,
    });

    return runUntilGoAfterExcel({
      args,
      config,
      logger,
      dateFolder,
      reviewDir,
      keptExcel,
      runContext,
    });
  });
}

async function runUntilGoAfterExcel(options: {
  args: UntilGoArgs;
  config: ReturnType<typeof loadConfig>;
  logger: Logger;
  dateFolder: string;
  reviewDir: string;
  keptExcel: string;
  runContext: ReturnType<typeof createTender247RunContext>;
}): Promise<UntilGoSummaryStats> {
  const { args, config, logger, dateFolder, reviewDir, keptExcel, runContext } =
    options;

  const financialSurvivors = readAllKeptCandidatesFromExcel(keptExcel);
  if (financialSurvivors.length === 0) {
    throw new Error(`UNTIL_GO_NO_FINANCIAL_SURVIVORS=${keptExcel}`);
  }

  const financialIds = new Set(
    financialSurvivors.map((c) => c.sourceTenderId),
  );
  const financialCounts = loadFinancialFilterSummaryCounts(
    reviewDir,
    financialSurvivors.length,
  );

  console.log(`FINANCIAL_SURVIVORS=${financialSurvivors.length}`);
  logger.info(`FINANCIAL_SURVIVORS=${financialSurvivors.length}`);
  console.log(`FINANCIAL_DROPPED=${financialCounts.financialDrop}`);
  logger.info(`FINANCIAL_DROPPED=${financialCounts.financialDrop}`);

  const stats: UntilGoSummaryStats = {
    excelRows: financialCounts.excelRows,
    financialDropped: financialCounts.financialDrop,
    financialSurvivors: financialSurvivors.length,
    relevanceChecked: 0,
    itRelevant: 0,
    nonIt: 0,
    ambiguous: 0,
    prescreenPassed: 0,
    prescreenRejected: 0,
    manualReview: 0,
    chatgptSubmitted: 0,
    noGo: 0,
    verify: 0,
    conditionalGo: 0,
    partnerBid: 0,
    go: 0,
    goFound: false,
    goTenderId: null,
    goChatUrl: null,
    goAuditFolder: null,
  };

  const authPath = resolveTender247AuthPath(config);
  if (!authPath) {
    throw new AutomationError(
      "TENDER247_AUTH_NOT_FOUND",
      "Missing auth/tender247.json. Run: npm run auth:tender247",
    );
  }

  const playwrightTemp = resolvePlaywrightDownloadsDir(runContext);
  ensureTender247DateScopedDir(playwrightTemp, runContext.requestedDate);
  const session = await launchBrowserSession({
    headless: config.headless,
    storageStatePath: authPath,
    downloadPath: playwrightTemp,
    pageTimeoutMs: config.pageTimeoutMs,
  });

  const listPage = session.page;
  const context = session.context;
  const scan: RelevanceScanRecord[] = [];
  const processedIt: RelevanceScanRecord[] = [];
  const results: KeptPipelinePathResult[] = [];
  let stopPipeline = false;
  let gptSession: Awaited<
    ReturnType<typeof ensureChatGptSession>
  > | null = null;
  let itOrdinal = 0;

  try {
    await loginToTender247(listPage, context, logger, config);
    await dismissTender247BlockingOverlays(listPage, logger, config);
    await dismissTender247SupportChat(listPage, logger).catch(() => undefined);
    // Re-apply requested mail date AFTER this second browser session's login/nav.
    await ensureTender247FreshListForDate(
      listPage,
      args.date,
      logger,
      config.pageTimeoutMs,
    );

    logger.info("TENDER247_RELEVANCE_SCAN_START");
    console.log("TENDER247_RELEVANCE_SCAN_START");

    for (const survivor of financialSurvivors) {
      if (stopPipeline) break;

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
      stats.relevanceChecked += 1;
      if (record.relevance === "IT_RELEVANT") stats.itRelevant += 1;
      if (record.relevance === "NON_IT") stats.nonIt += 1;
      if (record.relevance === "AMBIGUOUS") stats.ambiguous += 1;

      if (
        record.relevance !== "IT_RELEVANT" ||
        !record.detailResolved ||
        !financialIds.has(survivor.sourceTenderId)
      ) {
        logRelevanceDecision(record, logger);
        continue;
      }

      itOrdinal += 1;
      const selectedRecord: RelevanceScanRecord = {
        ...record,
        candidateOrdinal: itOrdinal,
      };
      scan[scan.length - 1] = selectedRecord;
      processedIt.push(selectedRecord);
      logRelevanceDecision(selectedRecord, logger);

      console.log("DOCUMENT_DOWNLOAD_START");
      logger.info("DOCUMENT_DOWNLOAD_START");
      logger.info(
        `UNTIL_GO_PROCESS=${itOrdinal} T247-${survivor.sourceTenderId}`,
      );
      console.log(`TENDER_PROCESS_START=${survivor.sourceTenderId}`);
      logger.info(`TENDER_PROCESS_START=${survivor.sourceTenderId}`);

      const pathResult = createPipelinePathResult(selectedRecord);
      results.push(pathResult);

      let supabaseExisting = false;
      try {
        const downstream = await processKeptCandidateDownstream({
          listPage,
          context,
          candidate: survivor,
          index: itOrdinal,
          total: itOrdinal,
          dateFolder,
          config,
          logger,
          pathResult,
        });
        supabaseExisting = downstream.supabaseExisting;

        if (pathResult.prescreenStatus === "PASSED") {
          stats.prescreenPassed += 1;
        } else if (pathResult.prescreenStatus === "REJECTED") {
          stats.prescreenRejected += 1;
        } else if (pathResult.prescreenStatus === "MANUAL_REVIEW") {
          stats.manualReview += 1;
        }

        if (pathResult.supabaseStored && config.chatgptQualificationEnabled) {
          gptSession = await ensureChatGptSession({
            gptSession,
            config,
            logger,
          });

          const chatgptRun = await runChatgptForPipelineCandidate({
            sourceTenderId: survivor.sourceTenderId,
            pathResult,
            dateFolder,
            config,
            logger,
            gptSession,
            forceReprocess: true,
          });

          if (pathResult.chatgptSubmitted) {
            stats.chatgptSubmitted += 1;
            bumpResultStat(stats, chatgptRun.qualStatus);

            const tenderFolder = path.join(
              dateFolder,
              `T247-${survivor.sourceTenderId}`,
            );
            const attachmentManifest =
              readAttachmentManifestFromTenderFolder(tenderFolder);
            const auditDir = await writeUntilGoCandidateAudit({
              dateFolder,
              sourceTenderId: survivor.sourceTenderId,
              candidate: survivor,
              tenderFolder,
              supabaseExisting,
              documentsDownloaded: pathResult.documentsDownloaded,
              prescreenStatus: pathResult.prescreenStatus,
              attachmentManifest,
              chatUrl: chatgptRun.chatUrl,
            });
            logger.info(`UNTIL_GO_AUDIT=${auditDir}`);

            if (chatgptRun.qualStatus === "GO") {
              stats.goFound = true;
              stats.goTenderId = `T247-${survivor.sourceTenderId}`;
              stats.goChatUrl = chatgptRun.chatUrl;
              stats.goAuditFolder = auditDir;
              console.log("GO_FOUND=true");
              logger.info("GO_FOUND=true");
              console.log(`GO_TENDER_ID=T247-${survivor.sourceTenderId}`);
              logger.info(`GO_TENDER_ID=T247-${survivor.sourceTenderId}`);
              console.log(`GO_CHAT_URL=${chatgptRun.chatUrl ?? ""}`);
              logger.info(`GO_CHAT_URL=${chatgptRun.chatUrl ?? ""}`);
              console.log(`GO_AUDIT_FOLDER=${auditDir}`);
              logger.info(`GO_AUDIT_FOLDER=${auditDir}`);
              stopPipeline = true;
            }
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
          `UNTIL_GO_CANDIDATE_FAILED=T247-${survivor.sourceTenderId}: ${message}`,
        );
        if (
          /TENDER247_AUTH|CHATGPT_AUTH|browserContext\.waitForEvent|browser has been closed/i.test(
            message,
          )
        ) {
          throw error;
        }
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

    writeExcelFilterRelevanceReview({
      reviewDir,
      scan,
      selectedItRelevant: processedIt,
    });

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

  printUntilGoSummary(stats);
  return stats;
}

async function main(): Promise<void> {
  try {
    await runUntilGoValidation();
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

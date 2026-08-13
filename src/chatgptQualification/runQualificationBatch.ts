/**
 * Phase 1 ChatGPT tender qualification batch.
 * Resume-capable ready-only queue — no Supabase / database writes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutomationError } from "../browserUtils.js";
import { loadConfig } from "../config.js";
import { getIndiaTodayIsoDate } from "../dateUtils.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import { Logger, safeErrorMessage } from "../logger.js";
import {
  chatgptSelectionLimit,
  formatProductionLimit,
} from "../productionLimit.js";
import { resolveRequestedDate } from "../cli/requestedDate.js";
import {
  loadQualificationManifest,
  upsertQualificationManifestEntry,
  writeQualificationManifest,
} from "./chatgptState.js";
import {
  cleanupStaleGptUploadFolders,
} from "./chatInteraction.js";
import {
  closeChatGptSession,
  ensureChatGptLoggedIn,
  launchChatGptPersistentSession,
  type ChatGptBrowserSession,
} from "./ensureChatGptLoggedIn.js";
import { closeUnusedBootstrapPages } from "./freshTenderTab.js";
import {
  tryRecoverFromExistingRawResponse,
  type QualifyTenderOutcome,
} from "./processTenderQualification.js";
import { runDualChatGptWorkers } from "./dualChatGptWorkers.js";
import {
  shouldExitBatchWhileQueueRemains,
  shouldLeaveBrowserOpenSolelyForResponsePending,
} from "./batchLifecyclePolicy.js";
import { loadTender247ConcurrencyConfig } from "../tender247Batch/tender247ConcurrencyConfig.js";
import { selectPassedForChatgpt } from "../prescreen/selectPassedForChatgpt.js";
import {
  isValidSavedQualificationResult,
  migrateLegacyResultsInDateFolder,
} from "./qualificationSchema.js";
import {
  buildGptReadinessReport,
  getMissingPhase1Files,
  listDownloadedTenderIds,
  saveGptReadinessReport,
  tryResolvePhase1TenderUploadFiles,
} from "./readiness.js";

export interface QualificationBatchSummary {
  expected: number;
  ready: number;
  selected: number;
  completed: number;
  skipped: number;
  pending: number;
  rateLimited: number;
  failed: number;
  notReady: number;
  remainingQueued: number;
  pendingChatUrl: string | null;
  browserOpened: boolean;
  dateIso?: string;
  statusCounts?: Record<string, number>;
  completedTenderIds?: string[];
  failedTenderIds?: string[];
  retryPendingTenderIds?: string[];
  canonicalStatusCounts?: Record<string, number>;
}

export type QualificationBatchOptions = {
  /** Immutable business date (YYYY-MM-DD). Defaults to Asia/Kolkata today. */
  dateIso?: string;
  /** Optional ChatGPT cap override (0/undefined = use config / unlimited). */
  maxGptTenders?: number;
};

export async function runQualificationBatch(
  options: QualificationBatchOptions = {},
): Promise<QualificationBatchSummary> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "ChatGptQualification");

  if (!config.chatgptQualificationEnabled) {
    throw new AutomationError(
      "CHATGPT_DISABLED",
      "Set CHATGPT_QUALIFICATION_ENABLED=true to run Phase 1 qualification",
    );
  }

  const dateIso =
    options.dateIso?.trim() ||
    resolveRequestedDate(process.argv.slice(2)).requestedDate ||
    getIndiaTodayIsoDate();
  const dateFolder = path.join(
    resolveProjectPath(config.downloadRoot),
    dateIso,
  );
  ensureDir(dateFolder);

  const effectiveMaxGpt =
    typeof options.maxGptTenders === "number" &&
    Number.isFinite(options.maxGptTenders)
      ? options.maxGptTenders
      : config.maxGptTenders;

  cleanupStaleGptUploadFolders(dateFolder, logger);

  logger.info("=== ChatGPT qualification Phase 1 batch started ===");
  logger.info(`DATE=${dateIso}`);
  logger.info(`REQUESTED_DATE=${dateIso}`);
  logger.info(
    `CHATGPT_QUALIFICATION_LIMIT=${formatProductionLimit(effectiveMaxGpt)}`,
  );
  logger.info(
    `MAX_GPT_TENDERS=${formatProductionLimit(effectiveMaxGpt)}`,
  );
  logger.info(
    `CHATGPT_PROCESS_READY_ONLY=${config.chatgptProcessReadyOnly}`,
  );
  logger.info(
    `CHATGPT_CONTINUE_ON_ERROR=${config.chatgptContinueOnError}`,
  );
  logger.info(`CHATGPT_PROJECT_NAME=${config.chatgptProjectName}`);
  logger.info(
    `CHATGPT_RESPONSE_TIMEOUT_MS=${config.chatgptResponseTimeoutMs}`,
  );
  logger.info(`CHATGPT_UPLOAD_TIMEOUT_MS=${config.chatgptUploadTimeoutMs}`);
  logger.info(
    `CHATGPT_INTER_TENDER_DELAY_MS=${config.chatgptInterTenderDelayMs}`,
  );
  logger.info(
    `CHATGPT_MIN_SUBMISSION_INTERVAL_MS=${config.chatgptMinSubmissionIntervalMs}`,
  );
  logger.info(
    `CHATGPT_RATE_LIMIT_INITIAL_BACKOFF_MS=${config.chatgptRateLimitInitialBackoffMs}`,
  );
  logger.info(
    "CHATGPT_PROJECT_SOURCE_ASSUMED — consolidated Siyana credentials already in Project",
  );

  if (
    process.env.CHATGPT_TEST_TENDER_ID?.trim() &&
    !config.chatgptTestTenderId
  ) {
    logger.warn(
      `CHATGPT_TEST_TENDER_ID rejected (non-numeric): ${process.env.CHATGPT_TEST_TENDER_ID.trim()}`,
    );
  }

  const readiness = buildGptReadinessReport(dateFolder, dateIso);
  const readinessPath = saveGptReadinessReport(dateFolder, readiness);
  logger.info(`GPT_READINESS saved=${readinessPath}`);
  logger.info(
    `GPT_READINESS expected=${readiness.expected} ready=${readiness.ready}`,
  );

  const migratedCount = migrateLegacyResultsInDateFolder(dateFolder);
  if (migratedCount > 0) {
    logger.info(
      `CHATGPT_LEGACY_RESULTS_MIGRATED=${migratedCount}`,
    );
  }

  const allDownloadedIds = listDownloadedTenderIds(dateFolder);
  const notReadyIds = allDownloadedIds.filter(
    (id) => !tryResolvePhase1TenderUploadFiles(dateFolder, id),
  );

  let selectedIds: string[] = [];
  if (config.chatgptTestTenderId) {
    logger.warn(
      `CHATGPT_TEST_TENDER_ID=${config.chatgptTestTenderId} — single-tender override`,
    );
    selectedIds = [config.chatgptTestTenderId];
  } else if (config.chatgptProcessReadyOnly || readiness.ready > 0) {
    selectedIds = [...readiness.readyTenderIds];
  } else {
    selectedIds = [...readiness.readyTenderIds];
  }

  // Keep only pre-screen PASSED tenders before opening ChatGPT.
  const passedSelection = await selectPassedForChatgpt({
    sourcePortal: "TENDER247",
    sourceTenderIds: selectedIds,
    logger,
    limit: chatgptSelectionLimit(effectiveMaxGpt),
  });
  logger.info(
    `CHATGPT_PRESCREEN_PASSED=${passedSelection.passedIds.length} skipped=${passedSelection.skipped.length}`,
  );
  selectedIds = passedSelection.passedIds;

  logger.info(
    `CHATGPT_READY_ONLY_BATCH expected=${readiness.expected} ready=${readiness.ready} selected=${selectedIds.length}`,
  );

  const manifestTotals = {
    expectedTender247: readiness.expected,
    readyForChatGpt: readiness.ready,
    selected: selectedIds.length,
  };

  // Record not_ready tenders without opening ChatGPT
  for (const id of notReadyIds) {
    const missingFiles = getMissingPhase1Files(dateFolder, id);
    upsertQualificationManifestEntry(
      dateFolder,
      dateIso,
      {
        t247Id: id,
        status: "not_ready",
        missingFiles,
        updatedAt: new Date().toISOString(),
        error: `Missing: ${missingFiles.join(", ")}`,
      },
      manifestTotals,
    );
  }

  if (selectedIds.length === 0) {
    logger.warn("CHATGPT_NO_READY_TENDERS — nothing to qualify");
    console.log("");
    console.log("==================================");
    console.log("ChatGPT Qualification Batch");
    console.log(`Tender247 expected: ${readiness.expected}`);
    console.log(`GPT ready: ${readiness.ready}`);
    console.log("Selected: 0");
    console.log(`Not ready: ${notReadyIds.length}`);
    console.log("==================================");
    console.log("");
    writeQualificationManifest(
      dateFolder,
      loadQualificationManifest(dateFolder, dateIso),
    );
    return {
      expected: readiness.expected,
      ready: readiness.ready,
      selected: 0,
      completed: 0,
      skipped: 0,
      pending: 0,
      rateLimited: 0,
      failed: 0,
      notReady: notReadyIds.length,
      remainingQueued: 0,
      pendingChatUrl: null,
      browserOpened: false,
    };
  }

  logger.info(
    `CHATGPT_QUEUE=${selectedIds.map((id) => `T247-${id}`).join(",")}`,
  );

  // Phase A: local recovery / skip without browser
  const needsBrowser: string[] = [];
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  let pending = 0;
  let notReady = notReadyIds.length;
  let rateLimited = 0;
  let remainingQueued = 0;
  let lastFailureError: string | null = null;
  let pendingChatUrl: string | null = null;
  const completedTenderIds: string[] = [];
  const failedTenderIds: string[] = [];
  const retryPendingTenderIds: string[] = [];

  for (let i = 0; i < selectedIds.length; i += 1) {
    const t247Id = selectedIds[i]!;
    const tenderFolder = path.join(dateFolder, `T247-${t247Id}`);
    const resultPath = path.join(tenderFolder, "qualification-result.json");
    const responsePath = path.join(tenderFolder, "qualification-response.txt");

    if (isValidSavedQualificationResult(resultPath)) {
      logger.info(
        `CHATGPT_QUALIFICATION_ALREADY_COMPLETE_SKIP=T247-${t247Id}`,
      );
      skipped += 1;
      completedTenderIds.push(t247Id);
      const qualification = JSON.parse(
        fs.readFileSync(resultPath, "utf8"),
      ) as { status?: string };
      upsertQualificationManifestEntry(
        dateFolder,
        dateIso,
        {
          t247Id,
          status: "skipped",
          qualificationStatus: qualification.status ?? null,
          resultPath,
          responsePath: fs.existsSync(responsePath) ? responsePath : null,
          updatedAt: new Date().toISOString(),
          error: null,
        },
        manifestTotals,
      );
      continue;
    }

    const recovered = tryRecoverFromExistingRawResponse({
      t247Id,
      tenderFolder,
      dateFolder,
      dateIso,
      resultPath,
      responsePath,
      logger,
      totals: manifestTotals,
    });
    if (recovered?.status === "completed") {
      completed += 1;
      completedTenderIds.push(t247Id);
      logger.info(
        `[local ${i + 1}/${selectedIds.length}] COMPLETE T247-${t247Id} status=completed`,
      );
      continue;
    }

    needsBrowser.push(t247Id);
  }

  let session: ChatGptBrowserSession | undefined;
  let hasResponsePending = false;
  let shouldCloseBrowser = true;

  try {
    if (needsBrowser.length === 0) {
      logger.info(
        "CHATGPT_BROWSER_SKIPPED — all selected tenders resolved locally",
      );
    } else {
      session = await launchChatGptPersistentSession({
        config,
        logger,
        downloadPath: dateFolder,
      });

      let { page, context } = session;

      await ensureChatGptLoggedIn({ page, context, config, logger });

      const pages = context.pages().filter((p) => !p.isClosed());
      for (const p of pages) {
        if (p.url().toLowerCase().includes("chatgpt.com")) {
          page = p;
          await page.bringToFront().catch(() => undefined);
          break;
        }
      }
      session.page = page;
      logger.info(`CHATGPT_CURRENT_URL=${page.url()}`);
      logger.info(
        "CHATGPT_SKIP_ANCHOR_PROJECT_NAV=true — each tender opens its own tab with ONE project goto",
      );

      // Do NOT openChatGptProject / ensureProjectHome on the bootstrap page.
      // That created a second project tab + reload loops. Workers own navigation.

      const concurrencyCfg = loadTender247ConcurrencyConfig();
      console.log(`CHATGPT_CONCURRENCY=${concurrencyCfg.chatgptConcurrency}`);
      logger.info(`CHATGPT_CONCURRENCY=${concurrencyCfg.chatgptConcurrency}`);
      console.log(
        `CHATGPT_MIN_SUBMISSION_INTERVAL_MS=${concurrencyCfg.chatgptMinSubmissionIntervalMs}`,
      );
      console.log(
        `CHATGPT_INTER_TENDER_DELAY_MS=${config.chatgptInterTenderDelayMs}`,
      );
      console.log(
        `CHATGPT_PROJECT_READY_TIMEOUT_MS=${process.env.CHATGPT_PROJECT_READY_TIMEOUT_MS || "120000"}`,
      );

      // Always use the worker runner (concurrency 1 or 2): one new tab per tender,
      // shared Send scheduler, no batch exit on response_pending / rate_limit.
      const dual = await runDualChatGptWorkers({
        context,
        primaryPage: page,
        tenderIds: needsBrowser,
        dateFolder,
        dateIso,
        config,
        logger,
        stopOnGo: false,
        manifestTotals,
      });

      // After workers finish, close leftover non-anchor blanks if any.
      await closeUnusedBootstrapPages({
        context,
        keepPages: context.pages().filter((p) => !p.isClosed()),
        logger,
      }).catch(() => undefined);

      console.log(`PIPELINE_GPT_SUBMITTED=${dual.outcomes.length}`);
      remainingQueued = dual.remainingQueued;
      for (const row of dual.outcomes) {
        applyOutcomeCounters(row.outcome, {
          onCompleted: () => {
            completed += 1;
            completedTenderIds.push(row.t247Id);
          },
          onSkipped: () => {
            skipped += 1;
            completedTenderIds.push(row.t247Id);
          },
          onPending: (url) => {
            pending += 1;
            hasResponsePending = true;
            pendingChatUrl = url ?? pendingChatUrl;
            retryPendingTenderIds.push(row.t247Id);
          },
          onNotReady: () => {
            notReady += 1;
          },
          onFailed: (error) => {
            failed += 1;
            failedTenderIds.push(row.t247Id);
            lastFailureError = error;
          },
          onRateLimited: (url) => {
            rateLimited += 1;
            pendingChatUrl = url ?? pendingChatUrl;
            retryPendingTenderIds.push(row.t247Id);
          },
        });
      }
      if (remainingQueued > 0) {
        logger.warn(
          `CHATGPT_BATCH_REMAINING_QUEUED=${remainingQueued} — workers returned early (fatal/cancel)`,
        );
      }
    }

    // Refresh manifest totals
    const manifest = loadQualificationManifest(dateFolder, dateIso);
    manifest.expectedTender247 = readiness.expected;
    manifest.readyForChatGpt = readiness.ready;
    manifest.selected = selectedIds.length;
    writeQualificationManifest(dateFolder, manifest);

    console.log("");
    console.log("==================================");
    console.log("ChatGPT Qualification Batch");
    console.log(`Tender247 expected: ${readiness.expected}`);
    console.log(`GPT ready: ${readiness.ready}`);
    console.log(`Selected: ${selectedIds.length}`);
    console.log(`Completed: ${completed}`);
    console.log(`Skipped existing: ${skipped}`);
    console.log(`Pending: ${pending}`);
    console.log(`Rate limited: ${rateLimited}`);
    console.log(`Failed: ${failed}`);
    console.log(`Not ready: ${notReady}`);
    if (remainingQueued > 0) {
      console.log(`Remaining queued: ${remainingQueued}`);
    }
    if (lastFailureError) {
      console.log(`Last error: ${lastFailureError}`);
    }
    if (pendingChatUrl) {
      console.log(`Resume chat: ${pendingChatUrl}`);
    }
    const finalRetryPending = [
      ...new Set(
        retryPendingTenderIds.filter(
          (id) =>
            !completedTenderIds.includes(id) && !failedTenderIds.includes(id),
        ),
      ),
    ];
    const finalFailed = [...new Set(failedTenderIds)];
    const finalCompleted = [...new Set(completedTenderIds)];
    console.log(
      `CHATGPT_FAILED_TENDER_IDS=${JSON.stringify(finalFailed)}`,
    );
    console.log(
      `CHATGPT_RETRY_PENDING_TENDER_IDS=${JSON.stringify(finalRetryPending)}`,
    );
    console.log(
      `CHATGPT_COMPLETED_TENDER_IDS=${JSON.stringify(finalCompleted)}`,
    );
    console.log("==================================");
    console.log("");

    logger.info(
      `CHATGPT_BATCH_SUMMARY expected=${readiness.expected} ready=${readiness.ready} selected=${selectedIds.length} completed=${completed} skipped=${skipped} pending=${pending} rateLimited=${rateLimited} failed=${failed} notReady=${notReady} remainingQueued=${remainingQueued}`,
    );

    if (failed > 0 && completed === 0 && pending === 0) {
      process.exitCode = 1;
    }

    // RESPONSE_PENDING is candidate-specific recovery — never batch-terminal.
    // Do NOT leave the browser open / exit early merely because one chat is pending.
    if (
      shouldLeaveBrowserOpenSolelyForResponsePending({
        hasResponsePending,
        remainingQueued,
      })
    ) {
      shouldCloseBrowser = false;
    }
    if (hasResponsePending) {
      logger.warn(
        `CHATGPT_RESPONSE_PENDING_RECOVERY_COUNT=${pending} — queue continued; browser will close when batch ends`,
      );
      if (pendingChatUrl) {
        logger.info(`CHATGPT_CHAT_CAN_BE_RESUMED=${pendingChatUrl}`);
        console.log(`Pending chat URL (saved for resume): ${pendingChatUrl}`);
      }
    }
    if (
      !shouldExitBatchWhileQueueRemains({
        remainingQueued,
        status: remainingQueued > 0 ? "RUNNING" : "COMPLETE",
      })
    ) {
      logger.error(
        `CHATGPT_BATCH_INCOMPLETE remainingQueued=${remainingQueued} — not a clean terminal state`,
      );
      process.exitCode = process.exitCode || 1;
    } else if (
      failed > 0 &&
      config.chatgptKeepBrowserOpenOnFailure &&
      !config.chatgptHeadless
    ) {
      shouldCloseBrowser = false;
      logger.warn(
        "CHATGPT_KEEP_BROWSER_OPEN_ON_FAILURE — browser left open for inspection (10 minutes)",
      );
      if (session?.page) {
        await session.page.waitForTimeout(600_000).catch(() => undefined);
      }
      shouldCloseBrowser = true;
    }
  } finally {
    // Close browser at normal batch end (queue drained). Pending recovery
    // URLs are persisted in tender state — do not keep the whole browser open.
    if (shouldCloseBrowser && session) {
      await closeChatGptSession(session);
      logger.info("ChatGPT browser closed");
    } else if (session && !shouldCloseBrowser) {
      logger.info(
        "ChatGPT browser left open (operator keep-open / inspection)",
      );
    }
  }

  return {
    expected: readiness.expected,
    ready: readiness.ready,
    selected: selectedIds.length,
    completed,
    skipped,
    pending,
    rateLimited,
    failed,
    notReady,
    remainingQueued,
    pendingChatUrl,
    browserOpened: Boolean(session) || needsBrowser.length > 0,
    completedTenderIds: [...new Set(completedTenderIds)],
    failedTenderIds: [...new Set(failedTenderIds)],
    retryPendingTenderIds: [
      ...new Set(
        retryPendingTenderIds.filter(
          (id) =>
            !completedTenderIds.includes(id) && !failedTenderIds.includes(id),
        ),
      ),
    ],
  };
}

function applyOutcomeCounters(
  outcome: QualifyTenderOutcome,
  handlers: {
    onCompleted: () => void;
    onSkipped: () => void;
    onPending: (url: string | null) => void;
    onNotReady: () => void;
    onFailed: (error: string | null) => void;
    onRateLimited?: (url: string | null) => void;
  },
): void {
  switch (outcome.status) {
    case "completed":
      handlers.onCompleted();
      break;
    case "skipped":
      handlers.onSkipped();
      break;
    case "response_pending":
      handlers.onPending(outcome.chatUrl);
      break;
    case "not_ready":
      handlers.onNotReady();
      break;
    case "rate_limited":
      handlers.onRateLimited?.(outcome.chatUrl);
      break;
    case "failed":
      handlers.onFailed(outcome.error);
      break;
    default:
      handlers.onFailed(outcome.error);
      break;
  }
}

async function main(): Promise<void> {
  const logger = new Logger(loadConfig().logRoot, "ChatGptQualification");
  try {
    await runQualificationBatch();
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

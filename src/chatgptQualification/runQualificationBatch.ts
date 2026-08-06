/**
 * Phase 1 ChatGPT tender qualification batch.
 * Resume-capable ready-only queue — no Supabase / database writes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import { loadConfig, type AppConfig } from "../config.js";
import { getTodayIsoDate } from "../dateUtils.js";
import { downloadDirForToday, ensureDir } from "../fileUtils.js";
import { Logger, safeErrorMessage } from "../logger.js";
import {
  loadQualificationManifest,
  upsertQualificationManifestEntry,
  writeQualificationManifest,
} from "./chatgptState.js";
import {
  cleanupStaleGptUploadFolders,
  handleRateLimitModal,
  saveUploadFailureDiagnostics,
} from "./chatInteraction.js";
import {
  closeChatGptSession,
  ensureChatGptLoggedIn,
  launchChatGptPersistentSession,
  type ChatGptBrowserSession,
} from "./ensureChatGptLoggedIn.js";
import {
  ensureProjectHome,
  logProjectHomeDiagnostics,
  openChatGptProject,
  assertProjectHomeOpen,
} from "./openProject.js";
import {
  qualifySingleTender,
  tryRecoverFromExistingRawResponse,
  type QualifyTenderOutcome,
} from "./processTenderQualification.js";
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
}

export async function runQualificationBatch(): Promise<QualificationBatchSummary> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "ChatGptQualification");

  if (!config.chatgptQualificationEnabled) {
    throw new AutomationError(
      "CHATGPT_DISABLED",
      "Set CHATGPT_QUALIFICATION_ENABLED=true to run Phase 1 qualification",
    );
  }

  const dateIso = getTodayIsoDate();
  const dateFolder = downloadDirForToday(config.downloadRoot);
  ensureDir(dateFolder);

  cleanupStaleGptUploadFolders(dateFolder, logger);

  logger.info("=== ChatGPT qualification Phase 1 batch started ===");
  logger.info(`DATE=${dateIso}`);
  logger.info(`MAX_GPT_TENDERS=${config.maxGptTenders || "ALL"}`);
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

  if (config.maxGptTenders > 0) {
    selectedIds = selectedIds.slice(0, config.maxGptTenders);
  }

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

      await openChatGptProject({
        page,
        projectName: config.chatgptProjectName,
        projectUrl: config.chatgptProjectUrl,
        projectMatch: config.chatgptProjectMatch,
        config,
        logger,
      });

      try {
        await ensureProjectHome({
          page,
          projectName: config.chatgptProjectName,
          projectMatch: config.chatgptProjectMatch,
          projectUrl: config.chatgptProjectUrl,
          config,
          logger,
        });
      } catch (homeError) {
        const homeMessage =
          homeError instanceof Error ? homeError.message : String(homeError);
        await logProjectHomeDiagnostics(
          page,
          config.chatgptProjectName,
          logger,
        );
        await saveUploadFailureDiagnostics({
          page,
          screenshotRoot: config.screenshotRoot,
          t247Id: "project-home",
          logger,
        });
        logger.error(`CHATGPT_PROJECT_HOME_FAILED=${homeMessage}`);
        throw homeError;
      }

      assertProjectHomeOpen(page);
      logger.info(`CHATGPT_CURRENT_URL=${page.url()}`);

      const attemptedTenderIds = new Set<string>();
      let lastSubmissionAt: number | null = null;

      for (let i = 0; i < needsBrowser.length; i += 1) {
        const t247Id = needsBrowser[i]!;
        if (attemptedTenderIds.has(t247Id)) {
          logger.warn(
            `CHATGPT_DUPLICATE_TENDER_SKIPPED_SAME_RUN=T247-${t247Id}`,
          );
          continue;
        }
        attemptedTenderIds.add(t247Id);

        // Pace submissions: wait before opening/uploading the next tender
        if (lastSubmissionAt != null) {
          const minimumSubmissionIntervalMs =
            config.chatgptMinSubmissionIntervalMs;
          const minimumCompletionCooldownMs = config.chatgptInterTenderDelayMs;
          const jitterMs = Math.floor(
            Math.random() * config.chatgptInterTenderJitterMs,
          );
          const elapsedSinceLastSubmission = Date.now() - lastSubmissionAt;
          const intervalWait = Math.max(
            0,
            minimumSubmissionIntervalMs - elapsedSinceLastSubmission,
          );
          const finalWait =
            Math.max(minimumCompletionCooldownMs, intervalWait) + jitterMs;

          logger.info(`CHATGPT_NEXT_TENDER_DELAY_MS=${finalWait}`);
          logger.info(
            `CHATGPT_LAST_SUBMISSION_ELAPSED_MS=${elapsedSinceLastSubmission}`,
          );
          if (finalWait > 0) {
            console.log(
              `Waiting ${Math.round(finalWait / 1000)}s before next tender (elapsed since last submission ${Math.round(elapsedSinceLastSubmission / 1000)}s)`,
            );
            await page.waitForTimeout(finalWait);
          }
        }

        logger.info(
          `[${i + 1}/${needsBrowser.length}] START T247-${t247Id}`,
        );
        if (i > 0) {
          logger.info(`CHATGPT_NEXT_TENDER_START=T247-${t247Id}`);
        }

        let outcome: QualifyTenderOutcome;
        let rateLimitRetries = 0;

        // Process this tender, pausing/retrying on rate limit without advancing
        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            outcome = await qualifySingleTender({
              page,
              dateFolder,
              t247Id,
              config,
              logger,
              manifestTotals,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            logger.error(
              `CHATGPT_TENDER_UNCAUGHT=T247-${t247Id}: ${message}`,
            );
            outcome = {
              t247Id,
              status: "failed",
              resultPath: null,
              responsePath: null,
              qualification: null,
              chatUrl: null,
              error: message,
            };
            if (!config.chatgptContinueOnError) {
              throw error;
            }
          }

          if (outcome.status !== "rate_limited") {
            break;
          }

          rateLimitRetries += 1;
          const backoffMs = Math.min(
            config.chatgptRateLimitMaxBackoffMs,
            config.chatgptRateLimitInitialBackoffMs *
              Math.pow(2, rateLimitRetries - 1),
          );
          const jitter = Math.floor(
            Math.random() * Math.min(30_000, backoffMs * 0.1),
          );
          const waitMs = backoffMs + jitter;
          logger.warn(
            `CHATGPT_RATE_LIMIT_BACKOFF_SECONDS=${Math.round(waitMs / 1000)} retry=${rateLimitRetries}/${config.chatgptRateLimitMaxRetries}`,
          );
          console.log(
            `Rate limited — pausing batch ${Math.round(waitMs / 1000)}s (retry ${rateLimitRetries}/${config.chatgptRateLimitMaxRetries})`,
          );

          if (rateLimitRetries >= config.chatgptRateLimitMaxRetries) {
            rateLimited += 1;
            remainingQueued = needsBrowser.length - i - 1;
            hasResponsePending = true;
            pendingChatUrl = outcome.chatUrl;
            logger.error(
              `CHATGPT_RATE_LIMIT_BATCH_EXIT tender=T247-${t247Id} chatUrl=${outcome.chatUrl || "none"} remainingQueued=${remainingQueued}`,
            );
            // Stop the whole queue — do not mark remaining tenders failed
            i = needsBrowser.length;
            break;
          }

          await page.waitForTimeout(waitMs);
          // Re-open the same chat after backoff (qualifySingleTender will resume)
          continue;
        }

        if (typeof outcome!.submittedAt === "number") {
          lastSubmissionAt = outcome!.submittedAt;
        }

        if (outcome!.status === "rate_limited") {
          // Batch exited due to exhausted retries
          break;
        }

        applyOutcomeCounters(outcome!, {
          onCompleted: () => {
            completed += 1;
          },
          onSkipped: () => {
            skipped += 1;
          },
          onPending: (url) => {
            pending += 1;
            hasResponsePending = true;
            pendingChatUrl = url;
          },
          onNotReady: () => {
            notReady += 1;
          },
          onFailed: (err) => {
            failed += 1;
            lastFailureError = err;
            if (err) {
              if (
                /parse|JSON|control character|SyntaxError|No JSON object/i.test(
                  err,
                )
              ) {
                logger.error(`CHATGPT_RESPONSE_PARSE_ERROR=${err}`);
              } else {
                logger.error(`CHATGPT_UPLOAD_OR_QUALIFY_ERROR=${err}`);
              }
            }
          },
          onRateLimited: (url) => {
            rateLimited += 1;
            hasResponsePending = true;
            pendingChatUrl = url;
          },
        });

        logger.info(
          `[${i + 1}/${needsBrowser.length}] COMPLETE T247-${t247Id} status=${outcome!.status}`,
        );

        // Return to Project Home between tenders (delay already applied before next start)
        if (
          i < needsBrowser.length - 1 &&
          (outcome!.status === "completed" ||
            outcome!.status === "failed" ||
            outcome!.status === "response_pending")
        ) {
          try {
            await returnToProjectHome(page, config, logger);
          } catch (navError) {
            const navCode =
              navError instanceof AutomationError ? navError.code : "";
            if (navCode === "CHATGPT_RATE_LIMITED") {
              remainingQueued = needsBrowser.length - i - 1;
              hasResponsePending = true;
              pendingChatUrl = outcome!.chatUrl;
              logger.error(
                `CHATGPT_RATE_LIMIT_BATCH_EXIT during navigation remainingQueued=${remainingQueued}`,
              );
              break;
            }
            throw navError;
          }
        }
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
    console.log("==================================");
    console.log("");

    logger.info(
      `CHATGPT_BATCH_SUMMARY expected=${readiness.expected} ready=${readiness.ready} selected=${selectedIds.length} completed=${completed} skipped=${skipped} pending=${pending} rateLimited=${rateLimited} failed=${failed} notReady=${notReady} remainingQueued=${remainingQueued}`,
    );

    if (failed > 0 && completed === 0 && pending === 0) {
      process.exitCode = 1;
    }

    if (hasResponsePending) {
      shouldCloseBrowser = false;
      logger.warn(
        "CHATGPT_RESPONSE_PENDING — leaving browser open; chat can be resumed",
      );
      if (pendingChatUrl) {
        logger.info(`CHATGPT_CHAT_CAN_BE_RESUMED=${pendingChatUrl}`);
        console.log(`Pending chat URL: ${pendingChatUrl}`);
      }
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
    if (shouldCloseBrowser && !hasResponsePending) {
      await closeChatGptSession(session);
      logger.info("ChatGPT browser closed");
    } else if (hasResponsePending) {
      logger.info(
        "ChatGPT browser left open due to response_pending (close manually when done)",
      );
    } else if (session) {
      await closeChatGptSession(session);
      logger.info("ChatGPT browser closed");
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

async function returnToProjectHome(
  page: Page,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  // Do not navigate to another tender while rate-limited
  if (await handleRateLimitModal(page, logger)) {
    throw new AutomationError(
      "CHATGPT_RATE_LIMITED",
      "ChatGPT temporarily limited requests",
    );
  }

  const projectUrl = config.chatgptProjectUrl?.trim();
  try {
    if (projectUrl) {
      await page.goto(projectUrl, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      await page.waitForTimeout(1500);
      logger.info("CHATGPT_PROJECT_DIRECT_NAVIGATION_COMPLETE");
    }
    if (await handleRateLimitModal(page, logger)) {
      throw new AutomationError(
        "CHATGPT_RATE_LIMITED",
        "ChatGPT temporarily limited requests",
      );
    }
    await ensureProjectHome({
      page,
      projectName: config.chatgptProjectName,
      projectMatch: config.chatgptProjectMatch,
      projectUrl: config.chatgptProjectUrl,
      config,
      logger,
    });
    logger.info("CHATGPT_RETURNED_TO_PROJECT_HOME");
  } catch (error) {
    if (error instanceof AutomationError && error.code === "CHATGPT_RATE_LIMITED") {
      throw error;
    }
    logger.warn(
      `Failed to return to Project Home: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
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

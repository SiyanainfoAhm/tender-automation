/**
 * Dual ChatGPT worker runner — shared BrowserContext, fresh Page per candidate.
 *
 * CRITICAL: candidate failure may close ONLY its own Page.
 * Never close BrowserContext / browser / another worker's page.
 *
 * RESPONSE_PENDING / RATE_LIMITED on one candidate must NOT terminate the batch.
 */
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { AutomationError } from "../browserUtils.js";
import { createBoundedQueue } from "../concurrency/boundedQueue.js";
import { getSharedChatGptSubmissionScheduler } from "../concurrency/chatGptSubmissionScheduler.js";
import { loadTender247ConcurrencyConfig } from "../tender247Batch/tender247ConcurrencyConfig.js";
import { openFreshTenderPage } from "./freshTenderTab.js";
import {
  closeOwnedCandidatePage,
  markPageProtectedUntilTerminal,
  probeSharedContextHealth,
  releasePageProtection,
} from "./ownedCandidatePage.js";
import {
  qualifySingleTender,
  type QualifyTenderOutcome,
} from "./processTenderQualification.js";
import {
  isGlobalChatGptRateLimited,
  tripGlobalChatGptRateLimit,
  waitWhileGlobalChatGptRateLimited,
} from "./globalChatGptRateLimit.js";

export type ChatGptWorkerState =
  | "IDLE"
  | "SUBMITTING"
  | "WAITING_FOR_SEND_SLOT"
  | "WAITING_RESPONSE"
  | "DONE"
  | "RATE_LIMITED"
  | "FAILED"
  | "RESPONSE_PENDING_RECOVERY";

export type DualChatGptRunResult = {
  outcomes: Array<{
    t247Id: string;
    workerId: number;
    outcome: QualifyTenderOutcome;
  }>;
  workerStates: Record<1 | 2, ChatGptWorkerState>;
  goStopTenderId: string | null;
  remainingQueued: number;
  /** Updated shared handles if recovery replaced them. */
  context: BrowserContext;
  primaryPage: Page;
};

export type SharedContextHandles = {
  context: BrowserContext;
  primaryPage: Page;
};

/**
 * Run up to 2 ChatGPT workers against a shared tender queue.
 * Fresh Page per candidate; shared BrowserContext for the whole batch.
 */
export async function runDualChatGptWorkers(options: {
  context: BrowserContext;
  /** Anchor page kept alive so persistent context never goes page-less. */
  primaryPage: Page;
  tenderIds: string[];
  dateFolder: string;
  dateIso: string;
  config: AppConfig;
  logger: Logger;
  stopOnGo?: boolean;
  /** Fresh runs force reprocess; resume may reuse valid matching results. */
  resumeMode?: boolean;
  forceReprocess?: boolean;
  manifestTotals?: {
    expectedTender247: number;
    readyForChatGpt: number;
    selected: number;
  };
  onCurrentRunGo?: (t247Id: string) => void;
  /**
   * Bounded recovery when the shared context dies mid-batch.
   * Must relaunch authenticated persistent ChatGPT and return new handles.
   */
  recoverSharedContext?: () => Promise<SharedContextHandles>;
  /** Optional Tender247 session for bounded document acquisition. */
  tender247EvidenceContext?: import("playwright").BrowserContext;
  tender247ListPage?: import("playwright").Page;
}): Promise<DualChatGptRunResult> {
  const concurrencyCfg = loadTender247ConcurrencyConfig();
  const workerCount = Math.min(2, Math.max(1, concurrencyCfg.chatgptConcurrency));
  const queue = createBoundedQueue<string>(
    Math.max(
      concurrencyCfg.chatgptReadyQueueMax,
      options.tenderIds.length || 1,
    ),
  );
  for (const id of options.tenderIds) {
    queue.tryEnqueue(id, 0);
  }

  getSharedChatGptSubmissionScheduler();

  let sharedContext = options.context;
  let anchorPage = options.primaryPage;
  let contextRecoveryAttempts = 0;
  const maxContextRecoveries = 2;

  console.log(
    `CHATGPT_SHARED_CONTEXT_ANCHOR_PAGE_OPEN=${!anchorPage.isClosed()}`,
  );
  options.logger.info(
    `CHATGPT_SHARED_CONTEXT_ANCHOR_PAGE_OPEN=${!anchorPage.isClosed()}`,
  );
  console.log(`CHATGPT_WORKER_COUNT=${workerCount}`);
  console.log(`PIPELINE_GPT_QUEUE_LENGTH=${queue.size()}`);
  options.logger.info(`PIPELINE_GPT_QUEUE_LENGTH=${queue.size()}`);

  let stopDequeue = false;
  let goStopTenderId: string | null = null;
  const workerStates: Record<1 | 2, ChatGptWorkerState> = {
    1: "IDLE",
    2: "IDLE",
  };
  const outcomes: DualChatGptRunResult["outcomes"] = [];
  const rateLimitRetryCounts = new Map<string, number>();
  const maxRateLimitRetries = options.config.chatgptRateLimitMaxRetries;

  async function ensureSharedContextAlive(): Promise<boolean> {
    const healthy = await probeSharedContextHealth(
      sharedContext,
      options.logger,
    );
    if (healthy) {
      if (anchorPage.isClosed()) {
        try {
          const pages = sharedContext.pages().filter((p) => !p.isClosed());
          anchorPage = pages[0] ?? (await sharedContext.newPage());
          console.log("CHATGPT_SHARED_CONTEXT_ANCHOR_PAGE_REATTACHED=true");
        } catch {
          return false;
        }
      }
      return true;
    }

    if (!options.recoverSharedContext) {
      return false;
    }
    if (contextRecoveryAttempts >= maxContextRecoveries) {
      console.log("CHATGPT_SHARED_CONTEXT_RECOVERY_EXHAUSTED=true");
      options.logger.error("CHATGPT_SHARED_CONTEXT_RECOVERY_EXHAUSTED=true");
      return false;
    }

    contextRecoveryAttempts += 1;
    console.log("CHATGPT_SHARED_CONTEXT_DIED=true");
    console.log("CHATGPT_SHARED_CONTEXT_RECOVERY_START=true");
    options.logger.warn("CHATGPT_SHARED_CONTEXT_DIED=true");
    options.logger.warn("CHATGPT_SHARED_CONTEXT_RECOVERY_START=true");

    try {
      const recovered = await options.recoverSharedContext();
      sharedContext = recovered.context;
      anchorPage = recovered.primaryPage;
      const ok = await probeSharedContextHealth(sharedContext, options.logger);
      console.log(`CHATGPT_SHARED_CONTEXT_RECOVERY_SUCCESS=${ok}`);
      options.logger.info(`CHATGPT_SHARED_CONTEXT_RECOVERY_SUCCESS=${ok}`);
      return ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`CHATGPT_SHARED_CONTEXT_RECOVERY_SUCCESS=false ${message}`);
      options.logger.error(
        `CHATGPT_SHARED_CONTEXT_RECOVERY_SUCCESS=false ${message}`,
      );
      return false;
    }
  }

  const runWorker = async (workerId: 1 | 2): Promise<void> => {
    console.log(`CHATGPT_WORKER_ID=${workerId}`);
    options.logger.info(`CHATGPT_WORKER_ID=${workerId} START`);

    while (true) {
      if (stopDequeue) break;

      if (!(await ensureSharedContextAlive())) {
        options.logger.error("CHATGPT_BROWSER_CONTEXT_DEAD=true");
        console.log("CHATGPT_BROWSER_CONTEXT_DEAD=true");
        throw new AutomationError(
          "CHATGPT_BROWSER_CONTEXT_DEAD",
          "Shared BrowserContext died — batch-level failure",
        );
      }

      // Global rate-limit pause — do not open new uploads/sends.
      if (isGlobalChatGptRateLimited()) {
        workerStates[workerId] = "RATE_LIMITED";
        console.log(
          `PIPELINE_GPT_WORKER_${workerId}_STATE=${workerStates[workerId]}`,
        );
        await waitWhileGlobalChatGptRateLimited({
          logger: options.logger,
          workerId,
          shouldAbort: () => stopDequeue,
        });
        if (stopDequeue) break;
        workerStates[workerId] = "IDLE";
      }

      const t247Id = queue.dequeue();
      if (!t247Id) break;

      console.log(`CHATGPT_WORKER_ID=${workerId}`);
      console.log(`CHATGPT_WORKER_TENDER_ID=${t247Id}`);
      console.log(`PIPELINE_GPT_QUEUE_LENGTH=${queue.size()}`);
      options.logger.info(`CHATGPT_WORKER_ID=${workerId} tender=${t247Id}`);
      workerStates[workerId] = "SUBMITTING";
      console.log(
        `PIPELINE_GPT_WORKER_${workerId}_STATE=${workerStates[workerId]}`,
      );

      let candidatePage: Page | null = null;
      let submitted = false;
      let preservePageForRecovery = false;

      try {
        if (!(await ensureSharedContextAlive())) {
          throw new AutomationError(
            "CHATGPT_BROWSER_CONTEXT_DEAD",
            "Shared BrowserContext dead before candidate newPage",
          );
        }

        candidatePage = await openFreshTenderPage({
          context: sharedContext,
          config: options.config,
          logger: options.logger,
          workerId,
          sourceTenderId: t247Id,
          keepAlivePages: [anchorPage],
        });

        workerStates[workerId] = "WAITING_RESPONSE";
        console.log(
          `PIPELINE_GPT_WORKER_${workerId}_STATE=${workerStates[workerId]}`,
        );

        const outcome = await qualifySingleTender({
          page: candidatePage,
          dateFolder: options.dateFolder,
          t247Id,
          config: options.config,
          logger: options.logger,
          manifestTotals: options.manifestTotals,
          skipInitialProjectHome: true,
          forceReprocess: options.forceReprocess === true,
          resumeMode: options.resumeMode === true,
          browserContext: options.tender247EvidenceContext,
          tender247ListPage: options.tender247ListPage,
          onSubmitted: () => {
            submitted = true;
            if (candidatePage && !candidatePage.isClosed()) {
              markPageProtectedUntilTerminal(candidatePage);
            }
          },
        });
        outcomes.push({ t247Id, workerId, outcome });

        if (outcome.status === "rate_limited") {
          workerStates[workerId] = "RATE_LIMITED";
          tripGlobalChatGptRateLimit({
            logger: options.logger,
            backoffMs: concurrencyCfg.chatgptRateLimitBackoffMs,
            reason: `candidate_rate_limited:${t247Id}`,
          });
          getSharedChatGptSubmissionScheduler().applyRateLimitBackoff(
            concurrencyCfg.chatgptRateLimitBackoffMs,
          );
          const retries = (rateLimitRetryCounts.get(t247Id) ?? 0) + 1;
          rateLimitRetryCounts.set(t247Id, retries);
          if (retries <= maxRateLimitRetries) {
            queue.tryEnqueue(t247Id, 50);
            console.log(
              `CHATGPT_RATE_LIMIT_REQUEUE=T247-${t247Id} retry=${retries}/${maxRateLimitRetries}`,
            );
          } else {
            console.log(
              `CHATGPT_RATE_LIMIT_MAX_RETRIES_EXCEEDED=T247-${t247Id}`,
            );
          }
          if (submitted && outcome.chatUrl) {
            preservePageForRecovery = false;
            console.log(
              `CHATGPT_RESPONSE_PENDING_RECOVERY=T247-${t247Id} chatUrl=${outcome.chatUrl}`,
            );
          }
        } else if (outcome.status === "response_pending") {
          workerStates[workerId] = "RESPONSE_PENDING_RECOVERY";
          console.log(`CHATGPT_RESPONSE_PENDING_RECOVERY=T247-${t247Id}`);
          console.log(
            `CHATGPT_RESPONSE_PENDING_CHAT_URL=${outcome.chatUrl || "none"}`,
          );
          options.logger.warn(
            `CHATGPT_RESPONSE_PENDING_RECOVERY=T247-${t247Id} — continuing queue`,
          );
          preservePageForRecovery = false;
        } else if (
          outcome.qualification?.status === "GO" &&
          options.stopOnGo &&
          !goStopTenderId
        ) {
          goStopTenderId = t247Id;
          stopDequeue = true;
          console.log(`UNTIL_GO_STOP_TRIGGER_TENDER=${t247Id}`);
          options.onCurrentRunGo?.(t247Id);
          workerStates[workerId] = "DONE";
        } else if (
          outcome.status === "completed" ||
          outcome.status === "skipped"
        ) {
          workerStates[workerId] = "DONE";
        } else if (outcome.status === "failed") {
          workerStates[workerId] = "FAILED";
        } else {
          workerStates[workerId] = "DONE";
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof AutomationError ? error.code : "CHATGPT_WORKER_FAILED";

        if (code === "CHATGPT_BROWSER_CONTEXT_DEAD") {
          // Requeue this tender after recovery; do not poison remaining work.
          queue.tryEnqueue(t247Id, 0);
          const recovered = await ensureSharedContextAlive();
          if (!recovered) {
            workerStates[workerId] = "FAILED";
            outcomes.push({
              t247Id,
              workerId,
              outcome: {
                t247Id,
                status: "failed",
                resultPath: null,
                responsePath: null,
                qualification: null,
                chatUrl: null,
                error: message,
              },
            });
            throw error;
          }
          console.log(`CHATGPT_TENDER_REQUEUED_AFTER_CONTEXT_RECOVERY=${t247Id}`);
          continue;
        }

        if (code === "CHATGPT_RATE_LIMITED" || /Too many requests/i.test(message)) {
          workerStates[workerId] = "RATE_LIMITED";
          tripGlobalChatGptRateLimit({
            logger: options.logger,
            reason: `worker_exception:${t247Id}`,
          });
          const retries = (rateLimitRetryCounts.get(t247Id) ?? 0) + 1;
          rateLimitRetryCounts.set(t247Id, retries);
          if (retries <= maxRateLimitRetries) {
            queue.tryEnqueue(t247Id, 50);
          }
          outcomes.push({
            t247Id,
            workerId,
            outcome: {
              t247Id,
              status: "rate_limited",
              resultPath: null,
              responsePath: null,
              qualification: null,
              chatUrl: null,
              error: message,
            },
          });
        } else {
          workerStates[workerId] = "FAILED";
          options.logger.error(
            `CHATGPT_WORKER_${workerId}_FAILED=${t247Id} ${message}`,
          );
          outcomes.push({
            t247Id,
            workerId,
            outcome: {
              t247Id,
              status: "failed",
              resultPath: null,
              responsePath: null,
              qualification: null,
              chatUrl: null,
              error: message,
            },
          });
        }
      } finally {
        // Candidate cleanup: close ONLY this tender's page.
        // NEVER close shared BrowserContext / browser / anchor page.
        if (candidatePage && !preservePageForRecovery) {
          releasePageProtection(candidatePage);
          await closeOwnedCandidatePage({
            page: candidatePage,
            workerId,
            sourceTenderId: t247Id,
            logger: options.logger,
            force: true,
          });
          candidatePage = null;
        }

        // Authoritative post-candidate check (not pages()-only).
        const stillAlive = await probeSharedContextHealth(
          sharedContext,
          options.logger,
        );
        if (!stillAlive) {
          options.logger.error(
            "CHATGPT_BROWSER_CONTEXT_DEAD_AFTER_CANDIDATE_PAGE_CLOSE=true",
          );
          console.log(
            "CHATGPT_BROWSER_CONTEXT_DEAD_AFTER_CANDIDATE_PAGE_CLOSE=true",
          );
        } else {
          console.log(
            `CHATGPT_SHARED_CONTEXT_ALIVE_AFTER_WORKER_${workerId}_CANDIDATE=true`,
          );
        }

        void submitted;
        console.log(`PIPELINE_GPT_QUEUE_LENGTH=${queue.size()}`);
        console.log(
          `PIPELINE_GPT_WORKER_${workerId}_STATE=${workerStates[workerId]}`,
        );
        console.log(`CHATGPT_TENDER_TAB_CLOSED=true`);
        if (queue.size() > 0 && !stopDequeue) {
          console.log("CHATGPT_MOVING_TO_NEXT_TENDER=true");
          options.logger.info("CHATGPT_MOVING_TO_NEXT_TENDER=true");
        }
      }
    }

    workerStates[workerId] = "IDLE";
  };

  const tasks = [runWorker(1)];
  if (workerCount > 1) tasks.push(runWorker(2));
  await Promise.all(tasks);

  return {
    outcomes,
    workerStates,
    goStopTenderId,
    remainingQueued: queue.size(),
    context: sharedContext,
    primaryPage: anchorPage,
  };
}

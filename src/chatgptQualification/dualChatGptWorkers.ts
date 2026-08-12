/**
 * Dual ChatGPT worker runner — two isolated pages, shared Send scheduler.
 */
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { createBoundedQueue } from "../concurrency/boundedQueue.js";
import { getSharedChatGptSubmissionScheduler } from "../concurrency/chatGptSubmissionScheduler.js";
import { loadTender247ConcurrencyConfig } from "../tender247Batch/tender247ConcurrencyConfig.js";
import {
  ensureProjectHome,
  openChatGptProject,
  assertProjectHomeOpen,
} from "./openProject.js";
import {
  qualifySingleTender,
  type QualifyTenderOutcome,
} from "./processTenderQualification.js";

export type ChatGptWorkerState =
  | "IDLE"
  | "SUBMITTING"
  | "WAITING_FOR_SEND_SLOT"
  | "WAITING_RESPONSE"
  | "DONE"
  | "RATE_LIMITED"
  | "FAILED";

export type DualChatGptRunResult = {
  outcomes: Array<{
    t247Id: string;
    workerId: number;
    outcome: QualifyTenderOutcome;
  }>;
  workerStates: Record<1 | 2, ChatGptWorkerState>;
  goStopTenderId: string | null;
};

async function prepareWorkerPage(
  context: BrowserContext,
  existing: Page | null,
  config: AppConfig,
  logger: Logger,
  workerId: number,
): Promise<Page> {
  const page =
    existing && !existing.isClosed() ? existing : await context.newPage();
  console.log(`CHATGPT_WORKER_ID=${workerId}`);
  logger.info(`CHATGPT_WORKER_PAGE_READY=${workerId}`);
  await openChatGptProject({
    page,
    projectName: config.chatgptProjectName,
    projectUrl: config.chatgptProjectUrl,
    projectMatch: config.chatgptProjectMatch,
    config,
    logger,
  });
  await ensureProjectHome({
    page,
    projectName: config.chatgptProjectName,
    projectMatch: config.chatgptProjectMatch,
    projectUrl: config.chatgptProjectUrl,
    config,
    logger,
  });
  assertProjectHomeOpen(page);
  return page;
}

/**
 * Run up to 2 ChatGPT workers against a shared tender queue.
 * Until-GO: when stopOnGo and a CURRENT-RUN GO is produced, stop dequeuing.
 */
export async function runDualChatGptWorkers(options: {
  context: BrowserContext;
  primaryPage: Page;
  tenderIds: string[];
  dateFolder: string;
  dateIso: string;
  config: AppConfig;
  logger: Logger;
  stopOnGo?: boolean;
  manifestTotals?: {
    expectedTender247: number;
    readyForChatGpt: number;
    selected: number;
  };
  onCurrentRunGo?: (t247Id: string) => void;
}): Promise<DualChatGptRunResult> {
  const concurrencyCfg = loadTender247ConcurrencyConfig();
  const workerCount = Math.min(2, concurrencyCfg.chatgptConcurrency);
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

  let stopDequeue = false;
  let goStopTenderId: string | null = null;
  const workerStates: Record<1 | 2, ChatGptWorkerState> = {
    1: "IDLE",
    2: "IDLE",
  };
  const outcomes: DualChatGptRunResult["outcomes"] = [];

  const page1 = await prepareWorkerPage(
    options.context,
    options.primaryPage,
    options.config,
    options.logger,
    1,
  );
  const page2 =
    workerCount > 1
      ? await prepareWorkerPage(
          options.context,
          null,
          options.config,
          options.logger,
          2,
        )
      : null;

  const runWorker = async (workerId: 1 | 2, page: Page): Promise<void> => {
    while (true) {
      if (stopDequeue) break;
      const t247Id = queue.dequeue();
      if (!t247Id) break;

      console.log(`CHATGPT_WORKER_ID=${workerId}`);
      console.log(`CHATGPT_WORKER_TENDER_ID=${t247Id}`);
      options.logger.info(`CHATGPT_WORKER_ID=${workerId} tender=${t247Id}`);
      workerStates[workerId] = "SUBMITTING";
      console.log(
        `PIPELINE_GPT_WORKER_${workerId}_STATE=${workerStates[workerId]}`,
      );

      try {
        await ensureProjectHome({
          page,
          projectName: options.config.chatgptProjectName,
          projectMatch: options.config.chatgptProjectMatch,
          projectUrl: options.config.chatgptProjectUrl,
          config: options.config,
          logger: options.logger,
        }).catch(() => undefined);

        workerStates[workerId] = "WAITING_RESPONSE";
        console.log(
          `PIPELINE_GPT_WORKER_${workerId}_STATE=${workerStates[workerId]}`,
        );

        const outcome = await qualifySingleTender({
          page,
          dateFolder: options.dateFolder,
          t247Id,
          config: options.config,
          logger: options.logger,
          manifestTotals: options.manifestTotals,
        });
        outcomes.push({ t247Id, workerId, outcome });

        if (outcome.status === "rate_limited") {
          workerStates[workerId] = "RATE_LIMITED";
          getSharedChatGptSubmissionScheduler().applyRateLimitBackoff(
            concurrencyCfg.chatgptRateLimitBackoffMs,
          );
          queue.tryEnqueue(t247Id, 100);
        } else if (
          outcome.qualification?.status === "GO" &&
          options.stopOnGo &&
          !goStopTenderId
        ) {
          goStopTenderId = t247Id;
          stopDequeue = true;
          console.log(`UNTIL_GO_STOP_TRIGGER_TENDER=${t247Id}`);
          options.onCurrentRunGo?.(t247Id);
        }

        workerStates[workerId] = "DONE";
      } catch (error) {
        workerStates[workerId] = "FAILED";
        const message = error instanceof Error ? error.message : String(error);
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

      console.log(`PIPELINE_GPT_QUEUE_LENGTH=${queue.size()}`);
      console.log(
        `PIPELINE_GPT_WORKER_${workerId}_STATE=${workerStates[workerId]}`,
      );
    }
    workerStates[workerId] = "IDLE";
  };

  const tasks = [runWorker(1, page1)];
  if (page2) tasks.push(runWorker(2, page2));
  await Promise.all(tasks);

  return { outcomes, workerStates, goStopTenderId };
}

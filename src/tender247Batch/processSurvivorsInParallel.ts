/**
 * Parallel Tender247 detail/download for Excel financial survivors.
 * Uses openViaSingleTenderDirect so workers do not share card locators.
 */
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { runWorkerPool } from "../concurrency/workerPool.js";
import { loadTender247ConcurrencyConfig } from "./tender247ConcurrencyConfig.js";
import { processLiveTender } from "./processTender.js";
import type { ProcessTenderResult } from "./types.js";

/** Serialize list-page bringToFront / overlay dismiss across workers. */
let listPageChain: Promise<void> = Promise.resolve();

export async function withListPageLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = listPageChain;
  listPageChain = previous.then(() => gate);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function processSurvivorsInParallel(options: {
  listPage: Page;
  context: BrowserContext;
  survivorIds: string[];
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  excelValueById: Map<
    string,
    { parsedTenderValueInr: number | null; parsedEmdInr: number | null; title?: string }
  >;
  alreadyCompleted: Set<string>;
  shouldStop?: () => boolean;
  concurrency?: number;
}): Promise<{
  results: ProcessTenderResult[];
  attemptedIds: string[];
  failedIds: string[];
  processedIds: string[];
}> {
  const concurrencyCfg = loadTender247ConcurrencyConfig();
  const concurrency =
    options.concurrency ?? concurrencyCfg.detailConcurrency;
  const pending = options.survivorIds.filter(
    (id) => !options.alreadyCompleted.has(id),
  );

  options.logger.info(
    `TENDER247_DETAIL_PARALLEL concurrency=${concurrency} pending=${pending.length}`,
  );
  console.log(
    `TENDER247_DETAIL_PARALLEL concurrency=${concurrency} pending=${pending.length}`,
  );

  const attemptedIds: string[] = [];
  const failedIds: string[] = [];
  const processedIds: string[] = [];
  const results: ProcessTenderResult[] = [];

  const outcomes = await runWorkerPool({
    items: pending,
    concurrency,
    shouldStop: options.shouldStop,
    worker: async (t247Id, workerId) => {
      attemptedIds.push(t247Id);
      console.log(`TENDER247_DETAIL_WORKER=${workerId}`);
      console.log(`TENDER247_DETAIL_WORKER_TENDER_ID=${t247Id}`);
      options.logger.info(
        `TENDER247_DETAIL_WORKER=${workerId} tender=${t247Id}`,
      );

      const excel = options.excelValueById.get(t247Id);
      const index = attemptedIds.length;
      const total = pending.length;

      await withListPageLock(async () => {
        await options.listPage.bringToFront().catch(() => undefined);
      });

      const result = await processLiveTender({
        listPage: options.listPage,
        context: options.context,
        t247Id,
        index,
        total,
        dateFolder: options.dateFolder,
        config: options.config,
        logger: options.logger,
        titleHint: excel?.title ?? null,
        excelTenderValue: excel?.parsedTenderValueInr ?? null,
        excelEmd: excel?.parsedEmdInr ?? null,
        openViaSingleTenderDirect: true,
      });
      return result;
    },
  });

  for (const outcome of outcomes) {
    if (!outcome.ok || !outcome.result) {
      failedIds.push(outcome.input);
      results.push({
        t247Id: outcome.input,
        status: "failed",
        zipPath: null,
        zipSize: 0,
        documentsDownloaded: 0,
        corrigendaDownloaded: 0,
        aiSummaryDownloaded: false,
        allDocumentsDownloaded: false,
        securityCodeCaptured: false,
        metadataStatus: "missing",
        aiSummaryStatus: "missing",
        allDocumentsStatus: "missing",
        metadataPath: null,
        aiSummaryPath: null,
        allDocumentsPath: null,
        lastCompletedStep: null,
        error: outcome.error || "parallel worker failed",
        failedDocuments: [],
      });
      continue;
    }
    const result = outcome.result;
    results.push(result);
    if (
      result.status === "dropped_non_it" ||
      result.status === "ambiguous_manual_review"
    ) {
      // counted but not failed
    } else if (
      result.status === "completed" ||
      result.status === "partial"
    ) {
      processedIds.push(result.t247Id);
    } else {
      failedIds.push(result.t247Id);
    }
  }

  return { results, attemptedIds, failedIds, processedIds };
}

/**
 * Phase-1 screened workbook is the only source for Tender247 detail selection.
 * Pre-screen manifests, candidate JSON, and existing T247 folders cannot
 * add NO_BID tenders back onto the crawler queue.
 */
import fs from "node:fs";
import path from "node:path";
import { AutomationError } from "../browserUtils.js";
import type { RunWorkbookRow } from "./runWorkbook.js";
import { readRunWorkbook, RUN_SCREENED_FILE } from "./runWorkbook.js";
import {
  isDetailScrapeCrawlStatus,
  normalizePhase1CrawlStatus,
  type Phase1CrawlStatus,
} from "./phase1Statuses.js";
import {
  assertAiScreeningCompleteForDetailCrawl,
  loadScreeningManifest,
  resolveExistingScreenedWorkbook,
  screeningDir,
  writeJson,
} from "./screeningManifest.js";

export const PHASE1_SCREENING_SOURCE_OF_TRUTH = RUN_SCREENED_FILE;

export type Phase1ScreeningDecision = {
  tender247Id: string;
  canonicalId: string;
  status: Phase1CrawlStatus;
  screeningReason: string;
  source: string;
  runCorrelationId: string;
  screeningWorkbookSource: string;
};

export type Phase1DetailQueue = {
  screeningRunId: string;
  crawlerQueueRunId: string;
  source: typeof PHASE1_SCREENING_SOURCE_OF_TRUTH;
  sourcePath: string;
  total: number;
  counts: Record<Phase1CrawlStatus, number>;
  unknownCount: number;
  crawlCandidates: Phase1ScreeningDecision[];
  noBidDecisions: Phase1ScreeningDecision[];
  decisionsByTenderId: Map<string, Phase1ScreeningDecision>;
};

export function runCorrelationIdForDate(runDate: string): string {
  const trimmed = runDate.trim();
  if (/^RUN-/i.test(trimmed)) return trimmed.toUpperCase();
  return `RUN-${trimmed}`;
}

export function digitsTender247Id(raw: string): string {
  return raw.replace(/^T247[-\s]*/i, "").replace(/\D/g, "") || raw.trim();
}

export function emptyCrawlCounts(): Record<Phase1CrawlStatus, number> {
  return { NO_BID: 0, VERIFY: 0, MAY_BID: 0, WILL_BID: 0 };
}

export function decisionFromRow(
  row: RunWorkbookRow,
  options: {
    runCorrelationId: string;
    screeningWorkbookSource: string;
  },
): Phase1ScreeningDecision | null {
  const fromStatus = normalizePhase1CrawlStatus(row.screeningStatus);
  if (!fromStatus) return null;
  const tender247Id = digitsTender247Id(row.tender247Id || row.canonicalId);
  if (!tender247Id) return null;
  return {
    tender247Id,
    canonicalId: row.canonicalId,
    status: fromStatus,
    screeningReason: row.screeningReason,
    source: row.source || "TENDER247",
    runCorrelationId: options.runCorrelationId,
    screeningWorkbookSource: options.screeningWorkbookSource,
  };
}

export function rebuildDetailQueueFromScreenedRows(
  rows: RunWorkbookRow[],
  options: {
    runCorrelationId: string;
    screeningWorkbookSource: string;
  },
): {
  crawlCandidates: Phase1ScreeningDecision[];
  noBidDecisions: Phase1ScreeningDecision[];
  decisionsByTenderId: Map<string, Phase1ScreeningDecision>;
  counts: Record<Phase1CrawlStatus, number>;
  unknownCount: number;
} {
  const counts = emptyCrawlCounts();
  const crawlCandidates: Phase1ScreeningDecision[] = [];
  const noBidDecisions: Phase1ScreeningDecision[] = [];
  const decisionsByTenderId = new Map<string, Phase1ScreeningDecision>();
  let unknownCount = 0;

  for (const row of rows) {
    const status = normalizePhase1CrawlStatus(row.screeningStatus);
    if (!status) {
      unknownCount += 1;
      continue;
    }
    const decision = decisionFromRow(row, options);
    if (!decision) {
      unknownCount += 1;
      continue;
    }
    counts[decision.status] += 1;
    decisionsByTenderId.set(decision.tender247Id, decision);
    if (decision.status === "NO_BID") {
      noBidDecisions.push(decision);
      continue;
    }
    if (isDetailScrapeCrawlStatus(decision.status)) {
      crawlCandidates.push(decision);
    }
  }

  return {
    crawlCandidates,
    noBidDecisions,
    decisionsByTenderId,
    counts,
    unknownCount,
  };
}

export function lookupScreeningDecision(
  decisions: Map<string, Phase1ScreeningDecision>,
  t247Id: string,
): Phase1ScreeningDecision | undefined {
  return decisions.get(digitsTender247Id(t247Id));
}

export function assertScreeningDecisionPresent(
  decisions: Map<string, Phase1ScreeningDecision>,
  t247Id: string,
): Phase1ScreeningDecision {
  const decision = lookupScreeningDecision(decisions, t247Id);
  if (!decision) {
    throw new AutomationError(
      "T247_SCREENING_DECISION_MISSING",
      `T247_SCREENING_DECISION_MISSING:${digitsTender247Id(t247Id)}`,
    );
  }
  return decision;
}

/**
 * Queue-loop guard: NO_BID is skipped (never opened). Missing decision is fatal.
 * Returns false when the tender must not be scraped.
 */
export function allowTender247DetailScrape(
  decisions: Map<string, Phase1ScreeningDecision>,
  t247Id: string,
  log?: (message: string) => void,
): boolean {
  const decision = assertScreeningDecisionPresent(decisions, t247Id);
  const id = decision.tender247Id;
  if (decision.status === "NO_BID") {
    log?.(`T247_REFUSING_TO_SCRAPE_NO_BID id=${id}`);
    log?.(`[T247 ${id}] PHASE1_STATUS=NO_BID`);
    log?.(`[T247 ${id}] DETAIL_SCRAPE_ALLOWED=false`);
    return false;
  }
  if (!isDetailScrapeCrawlStatus(decision.status)) {
    log?.(`T247_REFUSING_TO_SCRAPE_UNKNOWN_STATUS id=${id} status=${decision.status}`);
    return false;
  }
  if (
    decision.status !== "VERIFY" &&
    decision.status !== "MAY_BID" &&
    decision.status !== "WILL_BID"
  ) {
    throw new AutomationError(
      "T247_FATAL_QUEUE_INTEGRITY_ERROR",
      `T247_FATAL_QUEUE_INTEGRITY_ERROR: unexpected crawl status ${decision.status}`,
    );
  }
  log?.(`[T247 ${id}] PHASE1_STATUS=${decision.status}`);
  log?.(`[T247 ${id}] DETAIL_SCRAPE_ALLOWED=true`);
  return true;
}

/**
 * Immediate pre-open assertion. A NO_BID tender reaching this function is a
 * queue-integrity failure and must never silently continue.
 */
export function assertOpenSingleTenderDetailsAllowed(
  status: unknown,
  t247Id: string,
): Phase1CrawlStatus {
  const crawl = normalizePhase1CrawlStatus(status);
  if (crawl === "NO_BID") {
    throw new AutomationError(
      "T247_FATAL_QUEUE_INTEGRITY_ERROR",
      `T247_FATAL_QUEUE_INTEGRITY_ERROR: NO_BID tender reached detail crawler (T247-${digitsTender247Id(t247Id)})`,
    );
  }
  if (!isDetailScrapeCrawlStatus(crawl)) {
    throw new AutomationError(
      "T247_FATAL_QUEUE_INTEGRITY_ERROR",
      `T247_FATAL_QUEUE_INTEGRITY_ERROR: status ${String(status ?? "")} is not allowed to open Tender247 (T247-${digitsTender247Id(t247Id)})`,
    );
  }
  return crawl;
}

export function persistPhase1DecisionArtifacts(options: {
  dateFolder: string;
  queue: Phase1DetailQueue;
}): void {
  const dir = screeningDir(options.dateFolder);
  const all = [
    ...options.queue.noBidDecisions,
    ...options.queue.crawlCandidates,
  ];
  writeJson(path.join(dir, "phase1-decisions.json"), {
    screeningRunId: options.queue.screeningRunId,
    crawlerQueueRunId: options.queue.crawlerQueueRunId,
    source: options.queue.source,
    sourcePath: options.queue.sourcePath,
    counts: options.queue.counts,
    decisions: all,
    updatedAt: new Date().toISOString(),
  });
  writeJson(path.join(dir, "phase1-no-bid-decisions.json"), {
    screeningRunId: options.queue.screeningRunId,
    source: options.queue.source,
    sourcePath: options.queue.sourcePath,
    count: options.queue.noBidDecisions.length,
    decisions: options.queue.noBidDecisions,
    updatedAt: new Date().toISOString(),
  });
  writeJson(path.join(dir, "detail-queue.json"), {
    screeningRunId: options.queue.screeningRunId,
    crawlerQueueRunId: options.queue.crawlerQueueRunId,
    source: options.queue.source,
    sourcePath: options.queue.sourcePath,
    count: options.queue.crawlCandidates.length,
    ids: options.queue.crawlCandidates.map((row) => row.tender247Id),
    rebuiltAt: new Date().toISOString(),
  });
}

function logLine(
  logger: { info: (message: string) => void } | undefined,
  message: string,
): void {
  console.log(message);
  logger?.info(message);
}

export function logPhase1DetailQueue(
  queue: Phase1DetailQueue,
  logger?: { info: (message: string) => void },
): void {
  logLine(logger, `SCREENING_SOURCE_OF_TRUTH=${queue.sourcePath}`);
  logLine(logger, `SCREENING_RUN_ID=${queue.screeningRunId}`);
  logLine(logger, `CRAWLER_QUEUE_RUN_ID=${queue.crawlerQueueRunId}`);
  logLine(logger, `[SCREENING] TOTAL=${queue.total}`);
  logLine(logger, `[SCREENING] NO_BID=${queue.counts.NO_BID}`);
  logLine(logger, `[SCREENING] VERIFY=${queue.counts.VERIFY}`);
  logLine(logger, `[SCREENING] MAY_BID=${queue.counts.MAY_BID}`);
  logLine(logger, `[SCREENING] WILL_BID=${queue.counts.WILL_BID}`);
  logLine(logger, `FILTERED_OUT=${queue.counts.NO_BID}`);
  logLine(logger, `FILTER_PASSED=${queue.crawlCandidates.length}`);
  logLine(logger, `[DETAIL QUEUE] SOURCE=${queue.source}`);
  logLine(logger, `[DETAIL QUEUE] COUNT=${queue.crawlCandidates.length}`);
  for (const row of queue.crawlCandidates) {
    logLine(logger, `[DETAIL QUEUE] T247-${row.tender247Id}`);
  }
  for (const row of queue.noBidDecisions) {
    logLine(logger, `[T247 ${row.tender247Id}] PHASE1_STATUS=NO_BID`);
    logLine(logger, `[T247 ${row.tender247Id}] DETAIL_SCRAPE_ALLOWED=false`);
  }
  for (const row of queue.crawlCandidates) {
    logLine(logger, `[T247 ${row.tender247Id}] PHASE1_STATUS=${row.status}`);
    logLine(logger, `[T247 ${row.tender247Id}] DETAIL_SCRAPE_ALLOWED=true`);
  }
}

export function skipExistingNoBidFolders(options: {
  dateFolder: string;
  noBidIds: string[];
  logger?: { info: (message: string) => void };
}): string[] {
  const skipped: string[] = [];
  for (const id of options.noBidIds) {
    const folder = path.join(options.dateFolder, `T247-${id}`);
    if (fs.existsSync(folder)) {
      logLine(options.logger, `T247_EXISTING_FOLDER_NO_BID_SKIPPED=${id}`);
      skipped.push(id);
    }
  }
  return skipped;
}

/**
 * Rebuild the Tender247 detail queue from run-screened-siyana.xlsx only.
 * Call only after ChatGPT screening has completed and the workbook is valid.
 */
export function buildPhase1DetailQueue(options: {
  dateFolder: string;
  runDate: string;
  logger?: { info: (message: string) => void };
  persist?: boolean;
}): Phase1DetailQueue {
  if (!options.runDate) {
    throw new Error("DETAIL_CRAWL_BLOCKED_SCREENING_NOT_COMPLETE");
  }
  assertAiScreeningCompleteForDetailCrawl(options.dateFolder);

  const crawlerQueueRunId = runCorrelationIdForDate(options.runDate);
  const manifest = loadScreeningManifest(options.dateFolder);
  const screeningRunId = runCorrelationIdForDate(
    manifest?.runDate || options.runDate,
  );
  logLine(options.logger, `SCREENING_RUN_ID=${screeningRunId}`);
  logLine(options.logger, `CRAWLER_QUEUE_RUN_ID=${crawlerQueueRunId}`);
  if (screeningRunId !== crawlerQueueRunId) {
    throw new AutomationError(
      "SCREENING_RUN_ID_MISMATCH",
      `SCREENING_RUN_ID=${screeningRunId} CRAWLER_QUEUE_RUN_ID=${crawlerQueueRunId} must be equal`,
    );
  }

  const sourcePath = resolveExistingScreenedWorkbook(options.dateFolder);
  if (!sourcePath) {
    throw new AutomationError(
      "SCREENING_OUTPUT_MISSING",
      `SCREENING_SOURCE_OF_TRUTH missing: ${path.join(screeningDir(options.dateFolder), RUN_SCREENED_FILE)}`,
    );
  }

  const rows = readRunWorkbook(sourcePath);
  const rebuilt = rebuildDetailQueueFromScreenedRows(rows, {
    runCorrelationId: crawlerQueueRunId,
    screeningWorkbookSource: sourcePath,
  });
  if (rebuilt.unknownCount > 0) {
    logLine(
      options.logger,
      `SCREENING_UNKNOWN_STATUS_REJECTED=${rebuilt.unknownCount}`,
    );
  }

  const queue: Phase1DetailQueue = {
    screeningRunId,
    crawlerQueueRunId,
    source: PHASE1_SCREENING_SOURCE_OF_TRUTH,
    sourcePath,
    total: rows.length,
    counts: rebuilt.counts,
    unknownCount: rebuilt.unknownCount,
    crawlCandidates: rebuilt.crawlCandidates,
    noBidDecisions: rebuilt.noBidDecisions,
    decisionsByTenderId: rebuilt.decisionsByTenderId,
  };

  if (options.persist !== false) {
    persistPhase1DecisionArtifacts({
      dateFolder: options.dateFolder,
      queue,
    });
  }
  logPhase1DetailQueue(queue, options.logger);
  skipExistingNoBidFolders({
    dateFolder: options.dateFolder,
    noBidIds: queue.noBidDecisions.map((row) => row.tender247Id),
    logger: options.logger,
  });
  return queue;
}

export function loadPhase1DecisionsFromDisk(
  dateFolder: string,
): Map<string, Phase1ScreeningDecision> | null {
  const sourcePath = resolveExistingScreenedWorkbook(dateFolder);
  if (!sourcePath) return null;
  const manifest = loadScreeningManifest(dateFolder);
  const runId = runCorrelationIdForDate(manifest?.runDate || path.basename(dateFolder));
  const rebuilt = rebuildDetailQueueFromScreenedRows(readRunWorkbook(sourcePath), {
    runCorrelationId: runId,
    screeningWorkbookSource: sourcePath,
  });
  return rebuilt.decisionsByTenderId;
}

/**
 * Apply queue-loop + pre-open guards to any proposed ID list, including a
 * stale pre-screen queue. NO_BID IDs never call openTender.
 */
export function openTendersFromProposedQueue(options: {
  proposedIds: string[];
  decisions: Map<string, Phase1ScreeningDecision>;
  openTender: (t247Id: string) => void;
}): { opened: string[]; refusedNoBid: string[] } {
  const opened: string[] = [];
  const refusedNoBid: string[] = [];
  for (const raw of options.proposedIds) {
    const id = digitsTender247Id(raw);
    if (!allowTender247DetailScrape(options.decisions, id)) {
      refusedNoBid.push(id);
      continue;
    }
    const decision = assertScreeningDecisionPresent(options.decisions, id);
    assertOpenSingleTenderDetailsAllowed(decision.status, id);
    options.openTender(id);
    opened.push(id);
  }
  return { opened, refusedNoBid };
}

/**
 * Combined Tender247 + BidAssist end-to-end test (sequential).
 * Zero PASSED after successful crawl/prescreen is NO_ELIGIBLE_TEST_TENDER, not FAILED.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutomationError } from "../browserUtils.js";
import { loadConfig } from "../config.js";
import {
  getArgOrNpmConfig,
  logRawArgv,
  resolveRequestedDate,
} from "../cli/requestedDate.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import { Logger } from "../logger.js";
import { waitForSharedSubmissionInterval } from "../chatgptQualification/submissionThrottle.js";
import {
  acquirePipelineLock,
  releasePipelineLock,
} from "../runDailyTenderPipeline.js";
import {
  runSourceEndToEnd,
  type SourceE2EOutcome,
  type SourceEndToEndPrescreenStats,
  type SourceEndToEndResult,
} from "./runSourceEndToEnd.js";

export type CompleteE2EStatus =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "NO_ELIGIBLE_TEST_TENDER"
  | "FAILED"
  | "RATE_LIMITED";

export type CompleteE2ESourceSummary = {
  sourceTenderId: string | null;
  folderId: string | null;
  metadataVerified: boolean | null;
  documentsEnriched?: boolean | null;
  attachmentsConfirmed: boolean | null;
  promptSubmitted: boolean | null;
  responseCompleted: boolean | null;
  qualificationStatus: string | null;
  qualificationVerified: boolean | null;
  statusSyncVerified: boolean | null;
  chatUrl: string | null;
  error: string | null;
  ran: boolean;
  outcome: SourceE2EOutcome | null;
  stats: SourceEndToEndPrescreenStats | null;
};

export type CompleteE2ESummary = {
  runId: string;
  date: string;
  startedAt: string;
  finishedAt: string;
  status: CompleteE2EStatus;
  crawlMaxPerSource: number;
  chatgptMaxPerSource: number;
  requireChatgptPath: boolean;
  tender247: CompleteE2ESourceSummary;
  bidassist: CompleteE2ESourceSummary;
};

export type CompleteE2EOptions = {
  crawlMaxPerSource: number;
  chatgptMaxPerSource: number;
  requireChatgptPath: boolean;
  date: string;
  continueOnSourceError: boolean;
  /** Sources to run; default both for legacy e2e, Tender247-only when configured. */
  sources: Array<"tender247" | "bidassist">;
};

const COMPLETE_E2E_LOCK_NAME = "complete-e2e-test.lock";

function defaultCrawlMaxPerSource(): number {
  const fromEnv = Number.parseInt(
    process.env.E2E_CRAWL_CANDIDATES?.trim() || "0",
    10,
  );
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 5;
}

function defaultChatgptMaxPerSource(): number {
  const fromEnv = Number.parseInt(
    process.env.E2E_QUALIFY_LIMIT?.trim() || "0",
    10,
  );
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 1;
}

export function completeE2ELockPath(downloadRoot?: string): string {
  const root = downloadRoot
    ? resolveProjectPath(downloadRoot)
    : resolveProjectPath("runtime");
  ensureDir(root);
  return path.join(root, COMPLETE_E2E_LOCK_NAME);
}

export function parseCompleteE2EArgs(argv: string[]): CompleteE2EOptions {
  logRawArgv(argv, "COMPLETE_E2E_RAW_ARGV");

  const crawlRaw =
    getArgOrNpmConfig(argv, "crawl-max-per-source") ||
    getArgOrNpmConfig(argv, "crawl-max") ||
    getArgOrNpmConfig(argv, "limit");
  const chatgptRaw =
    getArgOrNpmConfig(argv, "chatgpt-max-per-source") ||
    getArgOrNpmConfig(argv, "chatgpt-limit") ||
    getArgOrNpmConfig(argv, "qualify-limit") ||
    // Legacy alias — treated as ChatGPT max, not crawl max.
    getArgOrNpmConfig(argv, "limit-per-source");

  const crawlMaxPerSource = crawlRaw
    ? Number.parseInt(crawlRaw, 10)
    : defaultCrawlMaxPerSource();
  const chatgptMaxPerSource = chatgptRaw
    ? Number.parseInt(chatgptRaw, 10)
    : defaultChatgptMaxPerSource();

  if (!Number.isFinite(crawlMaxPerSource) || crawlMaxPerSource < 1) {
    throw new Error("--crawl-max-per-source must be a positive integer");
  }
  if (!Number.isFinite(chatgptMaxPerSource) || chatgptMaxPerSource < 1) {
    throw new Error("--chatgpt-max-per-source must be a positive integer");
  }
  if (chatgptMaxPerSource !== 1) {
    throw new Error("COMPLETE_E2E_TEST_CHATGPT_MAX_MUST_BE_ONE");
  }

  const date = resolveRequestedDate(argv).requestedDate;
  const continueRaw = (
    getArgOrNpmConfig(argv, "continue-on-source-error") || "false"
  )
    .trim()
    .toLowerCase();
  const continueOnSourceError =
    continueRaw === "true" || continueRaw === "1" || continueRaw === "yes";

  const requireRaw = (getArgOrNpmConfig(argv, "require-chatgpt-path") || "true")
    .trim()
    .toLowerCase();
  const requireChatgptPath =
    requireRaw === "true" || requireRaw === "1" || requireRaw === "yes";

  const sourcesRaw = (
    getArgOrNpmConfig(argv, "sources") || "tender247,bidassist"
  )
    .trim()
    .toLowerCase();
  const sources: Array<"tender247" | "bidassist"> = [];
  for (const part of sourcesRaw.split(/[,+\s]+/)) {
    if (part === "tender247") sources.push("tender247");
    else if (part === "bidassist") sources.push("bidassist");
  }
  if (sources.length === 0) {
    sources.push("tender247", "bidassist");
  }

  return {
    crawlMaxPerSource,
    chatgptMaxPerSource,
    requireChatgptPath,
    date,
    continueOnSourceError,
    sources,
  };
}

function isTechnicalFailure(result: SourceEndToEndResult): boolean {
  return result.outcome === "FAILED";
}

/** Pure decision: whether BidAssist should run after Tender247. */
export function shouldRunBidassistAfterTender247(options: {
  tender247: SourceEndToEndResult | null;
  continueOnSourceError: boolean;
}): { run: boolean; reason: string } {
  const t247 = options.tender247;
  if (!t247) {
    return { run: false, reason: "tender247_not_run" };
  }
  if (t247.rateLimited || t247.outcome === "RATE_LIMITED") {
    return { run: false, reason: "rate_limited" };
  }
  if (t247.outcome === "NO_ELIGIBLE_TEST_TENDER") {
    return { run: true, reason: "tender247_no_eligible_test_tender" };
  }
  if (t247.outcome === "SUCCESS" || t247.success) {
    return { run: true, reason: "tender247_success" };
  }
  if (options.continueOnSourceError) {
    return { run: true, reason: "continue_on_source_error" };
  }
  if (isTechnicalFailure(t247)) {
    return { run: false, reason: "tender247_failed" };
  }
  // Non-fatal outcomes always continue.
  return { run: true, reason: "tender247_non_fatal" };
}

export function sourceResultToSummary(
  result: SourceEndToEndResult | null,
  ran: boolean,
): CompleteE2ESourceSummary {
  if (!ran || !result) {
    return {
      sourceTenderId: null,
      folderId: null,
      metadataVerified: null,
      documentsEnriched: null,
      attachmentsConfirmed: null,
      promptSubmitted: null,
      responseCompleted: null,
      qualificationStatus: null,
      qualificationVerified: null,
      statusSyncVerified: null,
      chatUrl: null,
      error: null,
      ran: false,
      outcome: null,
      stats: null,
    };
  }
  return {
    sourceTenderId: result.sourceTenderId,
    folderId: result.folderId,
    metadataVerified: result.metadataVerified,
    documentsEnriched: result.documentsEnriched,
    attachmentsConfirmed: result.attachmentsConfirmed,
    promptSubmitted: result.promptSubmitted,
    responseCompleted: result.responseCompleted,
    qualificationStatus: result.qualificationStatus,
    qualificationVerified: result.qualificationVerified,
    statusSyncVerified: result.statusSyncVerified,
    chatUrl: result.chatUrl,
    error: result.error,
    ran: true,
    outcome: result.outcome,
    stats: result.stats,
  };
}

export function deriveCompleteStatus(options: {
  tender247: SourceEndToEndResult | null;
  bidassist: SourceEndToEndResult | null;
  bidassistRan: boolean;
}): CompleteE2EStatus {
  if (
    options.tender247?.rateLimited ||
    options.tender247?.outcome === "RATE_LIMITED" ||
    options.bidassist?.rateLimited ||
    options.bidassist?.outcome === "RATE_LIMITED"
  ) {
    return "RATE_LIMITED";
  }

  const tOutcome = options.tender247?.outcome ?? null;
  const bOutcome = options.bidassistRan
    ? (options.bidassist?.outcome ?? null)
    : null;

  if (tOutcome === "FAILED" || bOutcome === "FAILED") {
    return "FAILED";
  }

  if (!options.bidassistRan) {
    if (tOutcome === "SUCCESS") return "SUCCESS";
    if (tOutcome === "NO_ELIGIBLE_TEST_TENDER") return "NO_ELIGIBLE_TEST_TENDER";
    // Tender247-only complete path: treat technical success without BidAssist as success.
    if (tOutcome === null) return "FAILED";
    return "FAILED";
  }

  const outcomes = [tOutcome, bOutcome].filter(Boolean) as SourceE2EOutcome[];
  const allSuccess = outcomes.every((o) => o === "SUCCESS");
  const allNoEligible = outcomes.every((o) => o === "NO_ELIGIBLE_TEST_TENDER");
  const anySuccess = outcomes.some((o) => o === "SUCCESS");
  const anyNoEligible = outcomes.some((o) => o === "NO_ELIGIBLE_TEST_TENDER");

  if (allSuccess) return "SUCCESS";
  if (allNoEligible) return "NO_ELIGIBLE_TEST_TENDER";
  if (anySuccess && anyNoEligible) return "PARTIAL_SUCCESS";
  if (anySuccess) return "PARTIAL_SUCCESS";
  return "FAILED";
}

export function buildCompleteE2ESummary(options: {
  runId: string;
  date: string;
  startedAt: string;
  finishedAt: string;
  crawlMaxPerSource: number;
  chatgptMaxPerSource: number;
  requireChatgptPath: boolean;
  tender247: SourceEndToEndResult | null;
  bidassist: SourceEndToEndResult | null;
  bidassistRan: boolean;
}): CompleteE2ESummary {
  return {
    runId: options.runId,
    date: options.date,
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    status: deriveCompleteStatus({
      tender247: options.tender247,
      bidassist: options.bidassist,
      bidassistRan: options.bidassistRan,
    }),
    crawlMaxPerSource: options.crawlMaxPerSource,
    chatgptMaxPerSource: options.chatgptMaxPerSource,
    requireChatgptPath: options.requireChatgptPath,
    tender247: sourceResultToSummary(options.tender247, true),
    bidassist: sourceResultToSummary(
      options.bidassist,
      options.bidassistRan,
    ),
  };
}

function yn(value: boolean | null | undefined): string {
  if (value == null) return "NO";
  return value ? "YES" : "NO";
}

function formatSourceBlock(
  title: string,
  summary: CompleteE2ESourceSummary,
  extras: string[] = [],
): string[] {
  const stats = summary.stats;
  const lines = [
    title,
    `Candidates crawled: ${stats?.candidatesCrawled ?? (summary.ran ? 0 : "N/A")}`,
    `Metadata verified: ${stats?.metadataVerifiedCount ?? (summary.metadataVerified ? 1 : 0)}`,
    `Prescreen rejected: ${stats?.prescreenRejected ?? 0}`,
    `Manual review: ${stats?.prescreenManualReview ?? 0}`,
    `Prescreen passed: ${stats?.prescreenPassed ?? 0}`,
    `ChatGPT requests avoided: ${stats?.chatgptRequestsAvoided ?? 0}`,
    `ChatGPT candidate: ${summary.sourceTenderId || "NONE"}`,
    `Source outcome: ${summary.outcome || (summary.ran ? "UNKNOWN" : "NOT_RUN")}`,
  ];
  if (summary.ran && summary.outcome === "SUCCESS") {
    lines.push(
      `Attachments confirmed: ${yn(summary.attachmentsConfirmed)}`,
      `Prompt submitted: ${yn(summary.promptSubmitted)}`,
      `Response completed: ${yn(summary.responseCompleted)}`,
      `Qualification: ${summary.qualificationStatus || "NONE"}`,
      `Qualification in Supabase: ${yn(summary.qualificationVerified)}`,
      `Status synchronized: ${yn(summary.statusSyncVerified)}`,
    );
  }
  for (const extra of extras) {
    lines.push(extra);
  }
  if (summary.error && summary.outcome === "FAILED") {
    lines.push(`Error: ${summary.error}`);
  }
  return lines;
}

export function formatCompleteE2EConsoleSummary(
  summary: CompleteE2ESummary,
  summaryPath: string,
): string {
  const t = summary.tender247;
  const b = summary.bidassist;
  const lines = [
    "==================================",
    "Complete End-to-End Test",
    `Date: ${summary.date}`,
    `Crawl max per source: ${summary.crawlMaxPerSource}`,
    `ChatGPT max per source: ${summary.chatgptMaxPerSource}`,
    `Require ChatGPT path: ${summary.requireChatgptPath ? "YES" : "NO"}`,
    "",
    ...formatSourceBlock("Tender247", t),
    "",
    ...formatSourceBlock("BidAssist", b, [
      ...(b.ran
        ? [
            `Documents enriched: ${yn(b.documentsEnriched)}`,
            "PRESCREEN_EMD_RULE_APPLIED=false",
            "PRESCREEN_IT_RELEVANCE_RULE_APPLIED=false",
          ]
        : []),
    ]),
    "",
    `Overall: ${summary.status}`,
    `Summary: ${summaryPath}`,
    "==================================",
  ];
  return lines.join("\n");
}

export function writeCompleteE2ESummary(
  downloadRoot: string,
  dateIso: string,
  summary: CompleteE2ESummary,
): string {
  const dir = path.resolve(downloadRoot, dateIso);
  ensureDir(dir);
  const outPath = path.join(dir, "complete-e2e-test-summary.json");
  const serializable = {
    runId: summary.runId,
    date: summary.date,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    status: summary.status,
    crawlMaxPerSource: summary.crawlMaxPerSource,
    chatgptMaxPerSource: summary.chatgptMaxPerSource,
    requireChatgptPath: summary.requireChatgptPath,
    tender247: {
      sourceTenderId: summary.tender247.sourceTenderId,
      folderId: summary.tender247.folderId,
      metadataVerified: summary.tender247.metadataVerified,
      attachmentsConfirmed: summary.tender247.attachmentsConfirmed,
      promptSubmitted: summary.tender247.promptSubmitted,
      responseCompleted: summary.tender247.responseCompleted,
      qualificationStatus: summary.tender247.qualificationStatus,
      qualificationVerified: summary.tender247.qualificationVerified,
      statusSyncVerified: summary.tender247.statusSyncVerified,
      chatUrl: summary.tender247.chatUrl,
      error: summary.tender247.error,
      outcome: summary.tender247.outcome,
      stats: summary.tender247.stats,
    },
    bidassist: summary.bidassist.ran
      ? {
          sourceTenderId: summary.bidassist.sourceTenderId,
          folderId: summary.bidassist.folderId,
          metadataVerified: summary.bidassist.metadataVerified,
          documentsEnriched: summary.bidassist.documentsEnriched,
          attachmentsConfirmed: summary.bidassist.attachmentsConfirmed,
          promptSubmitted: summary.bidassist.promptSubmitted,
          responseCompleted: summary.bidassist.responseCompleted,
          qualificationStatus: summary.bidassist.qualificationStatus,
          qualificationVerified: summary.bidassist.qualificationVerified,
          statusSyncVerified: summary.bidassist.statusSyncVerified,
          chatUrl: summary.bidassist.chatUrl,
          error: summary.bidassist.error,
          outcome: summary.bidassist.outcome,
          stats: summary.bidassist.stats,
        }
      : {
          sourceTenderId: null,
          folderId: null,
          metadataVerified: null,
          attachmentsConfirmed: null,
          promptSubmitted: null,
          responseCompleted: null,
          qualificationStatus: null,
          qualificationVerified: null,
          statusSyncVerified: null,
          chatUrl: null,
          error: null,
          outcome: null,
          stats: null,
        },
  };
  fs.writeFileSync(outPath, JSON.stringify(serializable, null, 2), "utf8");
  return outPath;
}

function exitCodeForStatus(status: CompleteE2EStatus): number {
  if (status === "SUCCESS") return 0;
  if (status === "PARTIAL_SUCCESS") return 0;
  if (status === "NO_ELIGIBLE_TEST_TENDER") return 0;
  if (status === "RATE_LIMITED") return 2;
  return 1;
}

export async function runCompleteEndToEndTest(
  options: CompleteE2EOptions,
  deps?: {
    runSource?: typeof runSourceEndToEnd;
    waitBetweenSources?: typeof waitForSharedSubmissionInterval;
  },
): Promise<{
  summary: CompleteE2ESummary;
  summaryPath: string;
  exitCode: number;
}> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "COMPLETE-E2E");
  const runSource = deps?.runSource ?? runSourceEndToEnd;
  const waitBetween =
    deps?.waitBetweenSources ?? waitForSharedSubmissionInterval;

  const startedAt = new Date().toISOString();
  const runId = `complete-e2e-${startedAt.replace(/[:.]/g, "-")}`;
  const lockPath = completeE2ELockPath("runtime");

  let interrupted = false;
  const onSignal = (): void => {
    interrupted = true;
    console.log("COMPLETE_E2E_TEST_INTERRUPTED");
    releasePipelineLock(lockPath);
    process.exit(130);
  };

  try {
    acquirePipelineLock(lockPath, {
      name: "complete-e2e-test",
      alreadyRunningCode: "COMPLETE_E2E_TEST_ALREADY_RUNNING",
    });
  } catch (error: unknown) {
    if (
      error instanceof AutomationError &&
      error.code === "COMPLETE_E2E_TEST_ALREADY_RUNNING"
    ) {
      console.error("COMPLETE_E2E_TEST_ALREADY_RUNNING");
      throw error;
    }
    throw error;
  }

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let tender247: SourceEndToEndResult | null = null;
  let bidassist: SourceEndToEndResult | null = null;
  let bidassistRan = false;

  try {
    console.log("COMPLETE_E2E_TEST_START");
    logger.info("COMPLETE_E2E_TEST_START");
    console.log(`COMPLETE_E2E_DATE=${options.date}`);
    console.log(`COMPLETE_E2E_CRAWL_MAX_PER_SOURCE=${options.crawlMaxPerSource}`);
    console.log(
      `COMPLETE_E2E_CHATGPT_MAX_PER_SOURCE=${options.chatgptMaxPerSource}`,
    );
    console.log(
      `COMPLETE_E2E_REQUIRE_CHATGPT_PATH=${options.requireChatgptPath ? "true" : "false"}`,
    );
    console.log(`E2E_QUALIFY_LIMIT=${options.chatgptMaxPerSource}`);
    console.log(`E2E_CRAWL_CANDIDATES=${options.crawlMaxPerSource}`);

    console.log("TENDER247_E2E_START");
    if (options.sources.includes("tender247")) {
      tender247 = await runSource({
        source: "tender247",
        limit: options.chatgptMaxPerSource,
        crawlMax: options.crawlMaxPerSource,
        requireChatgptPath: options.requireChatgptPath,
        date: options.date,
      });
      console.log(`TENDER247_E2E_OUTCOME=${tender247.outcome}`);
      console.log("TENDER247_E2E_COMPLETE");
    } else {
      console.log("COMPLETE_E2E_SKIP_TENDER247 reason=not_in_sources");
    }

    const wantBidassist = options.sources.includes("bidassist");
    const decision = wantBidassist
      ? shouldRunBidassistAfterTender247({
          tender247,
          continueOnSourceError: options.continueOnSourceError,
        })
      : { run: false, reason: "bidassist_not_in_sources" };

    if (!decision.run) {
      logger.warn(
        `COMPLETE_E2E_SKIP_BIDASSIST reason=${decision.reason}`,
      );
      console.log(`COMPLETE_E2E_SKIP_BIDASSIST reason=${decision.reason}`);
    } else {
      await waitBetween({
        minIntervalMs: config.chatgptMinSubmissionIntervalMs,
        logger,
        betweenSource: true,
      });

      console.log("BIDASSIST_E2E_START");
      bidassistRan = true;
      bidassist = await runSource({
        source: "bidassist",
        limit: options.chatgptMaxPerSource,
        crawlMax: options.crawlMaxPerSource,
        requireChatgptPath: options.requireChatgptPath,
        date: options.date,
      });
      console.log(`BIDASSIST_E2E_OUTCOME=${bidassist.outcome}`);
      console.log("BIDASSIST_E2E_COMPLETE");
    }

    const finishedAt = new Date().toISOString();
    const summary = buildCompleteE2ESummary({
      runId,
      date: options.date,
      startedAt,
      finishedAt,
      crawlMaxPerSource: options.crawlMaxPerSource,
      chatgptMaxPerSource: options.chatgptMaxPerSource,
      requireChatgptPath: options.requireChatgptPath,
      tender247,
      bidassist,
      bidassistRan,
    });
    const summaryPath = writeCompleteE2ESummary(
      resolveProjectPath(config.downloadRoot),
      options.date,
      summary,
    );

    if (summary.status === "SUCCESS") {
      console.log("COMPLETE_E2E_TEST_SUCCESS");
    } else if (summary.status === "RATE_LIMITED") {
      console.log("COMPLETE_E2E_TEST_RATE_LIMITED");
    } else if (summary.status === "NO_ELIGIBLE_TEST_TENDER") {
      console.log("COMPLETE_E2E_TEST_NO_ELIGIBLE_TEST_TENDER");
    } else if (summary.status === "PARTIAL_SUCCESS") {
      console.log("COMPLETE_E2E_TEST_PARTIAL_SUCCESS");
    } else {
      console.log("COMPLETE_E2E_TEST_FAILED");
    }

    console.log(formatCompleteE2EConsoleSummary(summary, summaryPath));

    let exitCode = exitCodeForStatus(summary.status);
    if (interrupted) exitCode = 130;
    return { summary, summaryPath, exitCode };
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    releasePipelineLock(lockPath);
  }
}

async function main(): Promise<void> {
  const options = parseCompleteE2EArgs(process.argv.slice(2));
  try {
    const { exitCode } = await runCompleteEndToEndTest(options);
    process.exit(exitCode);
  } catch (error: unknown) {
    if (
      error instanceof AutomationError &&
      error.code === "COMPLETE_E2E_TEST_ALREADY_RUNNING"
    ) {
      process.exit(1);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  main();
}

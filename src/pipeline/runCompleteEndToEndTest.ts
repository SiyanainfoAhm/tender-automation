/**
 * Combined Tender247 + BidAssist end-to-end test (sequential, limit 1 each).
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutomationError } from "../browserUtils.js";
import { loadConfig } from "../config.js";
import { getTodayIsoDate } from "../dateUtils.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import { Logger } from "../logger.js";
import { waitForSharedSubmissionInterval } from "../chatgptQualification/submissionThrottle.js";
import {
  acquirePipelineLock,
  releasePipelineLock,
} from "../runDailyTenderPipeline.js";
import {
  runSourceEndToEnd,
  type SourceEndToEndResult,
} from "./runSourceEndToEnd.js";

export type CompleteE2EStatus =
  | "SUCCESS"
  | "FAILED"
  | "PARTIAL"
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
};

export type CompleteE2ESummary = {
  runId: string;
  date: string;
  startedAt: string;
  finishedAt: string;
  status: CompleteE2EStatus;
  limitPerSource: number;
  tender247: CompleteE2ESourceSummary;
  bidassist: CompleteE2ESourceSummary;
};

export type CompleteE2EOptions = {
  limitPerSource: number;
  date: string;
  continueOnSourceError: boolean;
};

const COMPLETE_E2E_LOCK_NAME = "complete-e2e-test.lock";

export function completeE2ELockPath(downloadRoot?: string): string {
  const root = downloadRoot
    ? resolveProjectPath(downloadRoot)
    : resolveProjectPath("runtime");
  ensureDir(root);
  return path.join(root, COMPLETE_E2E_LOCK_NAME);
}

export function parseCompleteE2EArgs(argv: string[]): CompleteE2EOptions {
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
    if (next && !next.startsWith("--")) {
      values.set(body, next);
      i += 1;
    }
  }

  const limitRaw = values.get("limit-per-source");
  const limitPerSource = limitRaw ? Number.parseInt(limitRaw, 10) : 1;
  if (!Number.isFinite(limitPerSource) || limitPerSource < 1) {
    throw new Error("--limit-per-source must be a positive integer");
  }
  if (limitPerSource !== 1) {
    throw new Error("COMPLETE_E2E_TEST_LIMIT_MUST_BE_ONE");
  }

  const date = values.get("date")?.trim() || getTodayIsoDate();
  const continueRaw = (values.get("continue-on-source-error") || "false")
    .trim()
    .toLowerCase();
  const continueOnSourceError =
    continueRaw === "true" || continueRaw === "1" || continueRaw === "yes";

  return { limitPerSource, date, continueOnSourceError };
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
  if (t247.rateLimited) {
    return { run: false, reason: "rate_limited" };
  }
  if (t247.success) {
    return { run: true, reason: "tender247_success" };
  }
  if (options.continueOnSourceError) {
    return { run: true, reason: "continue_on_source_error" };
  }
  return { run: false, reason: "tender247_failed" };
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
  };
}

export function deriveCompleteStatus(options: {
  tender247: SourceEndToEndResult | null;
  bidassist: SourceEndToEndResult | null;
  bidassistRan: boolean;
}): CompleteE2EStatus {
  if (options.tender247?.rateLimited || options.bidassist?.rateLimited) {
    return "RATE_LIMITED";
  }
  const tOk = Boolean(options.tender247?.success);
  if (!options.bidassistRan) {
    return tOk ? "PARTIAL" : "FAILED";
  }
  const bOk = Boolean(options.bidassist?.success);
  if (tOk && bOk) return "SUCCESS";
  if (tOk || bOk) return "PARTIAL";
  return "FAILED";
}

export function buildCompleteE2ESummary(options: {
  runId: string;
  date: string;
  startedAt: string;
  finishedAt: string;
  limitPerSource: number;
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
    limitPerSource: options.limitPerSource,
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

function crawlerStatus(summary: CompleteE2ESourceSummary): string {
  if (!summary.ran) return "NOT_RUN";
  return summary.sourceTenderId ? "SUCCESS" : "FAILED";
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
    `Limit per source: ${summary.limitPerSource}`,
    "",
    "Tender247",
    `ID: ${t.sourceTenderId || "NONE"}`,
    `Crawler: ${crawlerStatus(t)}`,
    `Metadata in Supabase: ${yn(t.metadataVerified)}`,
    `Attachments confirmed: ${yn(t.attachmentsConfirmed)}`,
    `Prompt submitted: ${yn(t.promptSubmitted)}`,
    `Response completed: ${yn(t.responseCompleted)}`,
    `Qualification: ${t.qualificationStatus || "NONE"}`,
    `Qualification in Supabase: ${yn(t.qualificationVerified)}`,
    `Status synchronized: ${yn(t.statusSyncVerified)}`,
    "",
    "BidAssist",
    `ID: ${b.ran ? b.sourceTenderId || "NONE" : "NONE"}`,
    `Crawler: ${crawlerStatus(b)}`,
    `Metadata in Supabase: ${yn(b.metadataVerified)}`,
    `Documents enriched: ${yn(b.documentsEnriched)}`,
    `Attachments confirmed: ${yn(b.attachmentsConfirmed)}`,
    `Prompt submitted: ${yn(b.promptSubmitted)}`,
    `Response completed: ${yn(b.responseCompleted)}`,
    `Qualification: ${b.qualificationStatus || "NONE"}`,
    `Qualification in Supabase: ${yn(b.qualificationVerified)}`,
    `Status synchronized: ${yn(b.statusSyncVerified)}`,
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
    limitPerSource: summary.limitPerSource,
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
    },
    bidassist: summary.bidassist.ran
      ? {
          sourceTenderId: summary.bidassist.sourceTenderId,
          folderId: summary.bidassist.folderId,
          metadataVerified: summary.bidassist.metadataVerified,
          attachmentsConfirmed: summary.bidassist.attachmentsConfirmed,
          promptSubmitted: summary.bidassist.promptSubmitted,
          responseCompleted: summary.bidassist.responseCompleted,
          qualificationStatus: summary.bidassist.qualificationStatus,
          qualificationVerified: summary.bidassist.qualificationVerified,
          statusSyncVerified: summary.bidassist.statusSyncVerified,
          chatUrl: summary.bidassist.chatUrl,
          error: summary.bidassist.error,
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
        },
  };
  fs.writeFileSync(outPath, JSON.stringify(serializable, null, 2), "utf8");
  return outPath;
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
    console.log(`COMPLETE_E2E_LIMIT_PER_SOURCE=${options.limitPerSource}`);

    console.log("TENDER247_E2E_START");
    tender247 = await runSource({
      source: "tender247",
      limit: options.limitPerSource,
      date: options.date,
    });
    console.log("TENDER247_E2E_COMPLETE");

    const decision = shouldRunBidassistAfterTender247({
      tender247,
      continueOnSourceError: options.continueOnSourceError,
    });

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
        limit: options.limitPerSource,
        date: options.date,
      });
      console.log("BIDASSIST_E2E_COMPLETE");
    }

    const finishedAt = new Date().toISOString();
    const summary = buildCompleteE2ESummary({
      runId,
      date: options.date,
      startedAt,
      finishedAt,
      limitPerSource: options.limitPerSource,
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
    } else {
      console.log(`COMPLETE_E2E_TEST_${summary.status}`);
    }

    console.log(formatCompleteE2EConsoleSummary(summary, summaryPath));

    let exitCode = 1;
    if (summary.status === "SUCCESS") exitCode = 0;
    else if (summary.status === "RATE_LIMITED") exitCode = 2;
    else exitCode = 1;

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

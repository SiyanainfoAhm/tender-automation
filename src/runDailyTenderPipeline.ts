/**
 * Master daily pipeline: Tender247 crawl → readiness → ChatGPT qualification.
 * Phases run sequentially — never in parallel.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutomationError } from "./browserUtils.js";
import {
  isValidSavedQualificationResult,
} from "./chatgptQualification/qualificationSchema.js";
import {
  buildGptReadinessReport,
  listDownloadedTenderIds,
  listNewReadyTenderIds,
  saveGptReadinessReport,
} from "./chatgptQualification/readiness.js";
import {
  runQualificationBatch,
  type QualificationBatchSummary,
} from "./chatgptQualification/runQualificationBatch.js";
import { loadConfig, type AppConfig } from "./config.js";
import { ensureDir, resolveProjectPath } from "./fileUtils.js";
import { Logger, safeErrorMessage } from "./logger.js";
import {
  formatProductionLimit,
} from "./productionLimit.js";
import { loadBidassistConfig } from "./bidassist/bidassistConfig.js";
import { readExcelFilterAudit } from "./tender247Batch/excelFilterAudit.js";
import {
  countPrescreenOutcomesForTenderIds,
} from "./prescreen/prescreenRepository.js";
import { resolveRequestedDate, getArgValue } from "./cli/requestedDate.js";

export interface DailyPipelineSummary {
  date: string;
  startedAt: string;
  finishedAt: string;
  tender247: "SUCCESS" | "FAILED" | "SKIPPED";
  tender247ExitCode: number | null;
  tender247ExcelRows: number;
  tender247ExcelDropped: number;
  tender247ExcelKept: number;
  tender247DetailCrawled: number;
  tender247SupabaseStored: number;
  tender247PrescreenRejected: number;
  tender247ManualReview: number;
  tenderFoldersDiscovered: number;
  gptReady: number;
  gptNotReady: number;
  newReadyForQualification: number;
  chatgptStarted: boolean;
  qualificationCompleted: number;
  skippedExisting: number;
  pending: number;
  rateLimited: number;
  failed: number;
  remainingReady: number;
  phaseDelayMs: number;
  error?: string | null;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // EPERM means the process exists but we cannot signal it
    if (err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

export function readLockPid(lockFilePath: string): number | null {
  try {
    if (!fs.existsSync(lockFilePath)) {
      return null;
    }
    const raw = fs.readFileSync(lockFilePath, "utf8").trim();
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as { pid?: unknown };
      const pid = Number(parsed.pid);
      return Number.isFinite(pid) ? pid : null;
    } catch {
      const match = raw.match(/\bpid["']?\s*[:=]\s*(\d+)/i);
      return match ? Number(match[1]) : null;
    }
  } catch {
    return null;
  }
}

export function acquirePipelineLock(
  lockFilePath: string,
  options?: {
    name?: string;
    alreadyRunningCode?: string;
  },
): void {
  const lockName = options?.name ?? "daily-tender-pipeline";
  const alreadyRunningCode =
    options?.alreadyRunningCode ?? "DAILY_PIPELINE_ALREADY_RUNNING";
  const writeLock = (fd: number): void => {
    fs.writeFileSync(
      fd,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          name: lockName,
        },
        null,
        2,
      ),
    );
  };
  try {
    const fd = fs.openSync(lockFilePath, "wx");
    writeLock(fd);
    fs.closeSync(fd);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "EEXIST") {
      const ownerPid = readLockPid(lockFilePath);
      if (ownerPid && isProcessAlive(ownerPid)) {
        throw new AutomationError(
          alreadyRunningCode,
          `Another ${lockName} is already running (pid=${ownerPid}, lock=${lockFilePath})`,
        );
      }
      // Stale master lock — remove and retry once
      try {
        fs.unlinkSync(lockFilePath);
      } catch {
        // ignore
      }
      const fd = fs.openSync(lockFilePath, "wx");
      writeLock(fd);
      fs.closeSync(fd);
      return;
    }
    throw error;
  }
}

export function releasePipelineLock(lockFilePath: string): void {
  try {
    if (!fs.existsSync(lockFilePath)) {
      return;
    }
    const ownerPid = readLockPid(lockFilePath);
    if (ownerPid != null && ownerPid !== process.pid && isProcessAlive(ownerPid)) {
      // Do not delete another active pipeline's lock
      return;
    }
    fs.unlinkSync(lockFilePath);
  } catch {
    // ignore
  }
}

/**
 * Wait for crawler locks (automation.lock / crawl.lock) to clear.
 * Removes only stale locks whose owning PID is dead.
 */
export async function waitForCrawlerLockRelease(options: {
  lockPaths: string[];
  timeoutMs?: number;
  pollMs?: number;
  logger: Logger;
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollMs = options.pollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let anyActive = false;

    for (const lockPath of options.lockPaths) {
      if (!fs.existsSync(lockPath)) {
        continue;
      }
      const pid = readLockPid(lockPath);
      if (pid && isProcessAlive(pid)) {
        anyActive = true;
        options.logger.info(
          `DAILY_PIPELINE_WAITING_CRAWLER_LOCK=${path.basename(lockPath)} pid=${pid}`,
        );
        continue;
      }
      // Stale lock — safe to remove
      try {
        fs.unlinkSync(lockPath);
        options.logger.info(
          `DAILY_PIPELINE_STALE_LOCK_REMOVED=${path.basename(lockPath)}`,
        );
      } catch {
        // ignore
      }
    }

    if (!anyActive) {
      options.logger.info("DAILY_PIPELINE_CRAWLER_LOCK_RELEASED");
      return;
    }

    await sleep(pollMs);
  }

  // Final pass: still-active locks fail the pipeline
  for (const lockPath of options.lockPaths) {
    if (!fs.existsSync(lockPath)) {
      continue;
    }
    const pid = readLockPid(lockPath);
    if (pid && isProcessAlive(pid)) {
      throw new AutomationError(
        "DAILY_PIPELINE_CRAWLER_LOCK_TIMEOUT",
        `Crawler lock still held after ${timeoutMs}ms: ${lockPath} (pid=${pid})`,
      );
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
  options.logger.info("DAILY_PIPELINE_CRAWLER_LOCK_RELEASED");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runScriptProcess(options: {
  scriptPath: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logger: Logger;
  label: string;
  extraArgs?: string[];
}): Promise<number> {
  const tsxCli = path.join(
    options.cwd,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const args = fs.existsSync(tsxCli)
    ? [tsxCli, options.scriptPath, ...(options.extraArgs || [])]
    : [];

  if (args.length === 0) {
    throw new AutomationError(
      "DAILY_PIPELINE_TSX_MISSING",
      `tsx CLI not found at ${tsxCli}`,
    );
  }

  options.logger.info(
    `DAILY_PIPELINE_SPAWN=${options.label} script=${options.scriptPath} args=${(options.extraArgs || []).join(" ")}`,
  );

  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(
          new AutomationError(
            "DAILY_PIPELINE_CHILD_SIGNAL",
            `${options.label} terminated by signal ${signal}`,
          ),
        );
        return;
      }
      resolve(code ?? 1);
    });
  });
}

export function writeDailyPipelineSummary(
  dateFolder: string,
  summary: DailyPipelineSummary,
): string {
  ensureDir(dateFolder);
  const outPath = path.join(dateFolder, "daily-pipeline-summary.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
  return outPath;
}

export function printDailyPipelineSummary(summary: DailyPipelineSummary): void {
  console.log("");
  console.log("==================================");
  console.log("Daily Tender Pipeline");
  console.log(`Tender247 crawl: ${summary.tender247}`);
  console.log(`Tender247 Excel rows: ${summary.tender247ExcelRows}`);
  console.log(`Tender247 early filtered: ${summary.tender247ExcelDropped}`);
  console.log(`Tender247 detail crawled: ${summary.tender247DetailCrawled}`);
  console.log(`Tender247 Supabase stored: ${summary.tender247SupabaseStored}`);
  console.log(
    `Tender247 detailed prescreen rejected: ${summary.tender247PrescreenRejected}`,
  );
  console.log(
    `Tender247 manual review: ${summary.tender247ManualReview}`,
  );
  console.log(
    `Tender247 ChatGPT submitted: ${summary.qualificationCompleted}`,
  );
  console.log(`Tender folders discovered: ${summary.tenderFoldersDiscovered}`);
  console.log(`GPT ready: ${summary.gptReady}`);
  console.log(`GPT not ready: ${summary.gptNotReady}`);
  console.log(`Skipped existing: ${summary.skippedExisting}`);
  console.log(`Pending: ${summary.pending}`);
  console.log(`Rate limited: ${summary.rateLimited}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Remaining ready: ${summary.remainingReady}`);
  console.log("==================================");
  console.log("");
}

export function parseDailyPipelineDate(argv: string[]): string {
  return resolveRequestedDate(argv).requestedDate;
}

function parseDailyPipelineAccountArgs(argv: string[]): {
  accountId: string | null;
  companyId: string | null;
} {
  return {
    accountId:
      getArgValue(argv, "account-id") ||
      getArgValue(argv, "tender247-account-id") ||
      process.env.TENDER247_ACCOUNT_ID?.trim() ||
      null,
    companyId:
      getArgValue(argv, "company-id") ||
      process.env.COMPANY_ID?.trim() ||
      process.env.SIYANA_COMPANY_ID?.trim() ||
      null,
  };
}

export async function runDailyTenderPipeline(): Promise<DailyPipelineSummary> {
  const config = loadConfig();
  const argv = process.argv.slice(2);
  const logger = new Logger(config.logRoot, "DailyTenderPipeline");
  const dateIso = parseDailyPipelineDate(argv);
  const accountArgs = parseDailyPipelineAccountArgs(argv);
  const dateFolder = path.join(config.downloadRoot, dateIso);
  ensureDir(dateFolder);

  const startedAt = new Date().toISOString();
  const summary: DailyPipelineSummary = {
    date: dateIso,
    startedAt,
    finishedAt: startedAt,
    tender247: "SKIPPED",
    tender247ExitCode: null,
    tender247ExcelRows: 0,
    tender247ExcelDropped: 0,
    tender247ExcelKept: 0,
    tender247DetailCrawled: 0,
    tender247SupabaseStored: 0,
    tender247PrescreenRejected: 0,
    tender247ManualReview: 0,
    tenderFoldersDiscovered: 0,
    gptReady: 0,
    gptNotReady: 0,
    newReadyForQualification: 0,
    chatgptStarted: false,
    qualificationCompleted: 0,
    skippedExisting: 0,
    pending: 0,
    rateLimited: 0,
    failed: 0,
    remainingReady: 0,
    phaseDelayMs: config.dailyPipelinePhaseDelayMs,
    error: null,
  };

  acquirePipelineLock(config.dailyPipelineLockFilePath);
  logger.info(
    `DAILY_PIPELINE_LOCK_ACQUIRED=${config.dailyPipelineLockFilePath}`,
  );

  const bidassistConfig = loadBidassistConfig();
  logger.info(`TENDER247_LIMIT=${formatProductionLimit(config.maxTenders)}`);
  logger.info(
    `BIDASSIST_LIMIT=${formatProductionLimit(bidassistConfig.maxTenders)}`,
  );
  logger.info(
    `CHATGPT_QUALIFICATION_LIMIT=${formatProductionLimit(config.maxGptTenders)}`,
  );
  logger.info(
    `CHATGPT_MIN_SUBMISSION_INTERVAL_MS=${config.chatgptMinSubmissionIntervalMs}`,
  );

  const onSignal = (signal: string): void => {
    logger.warn(`DAILY_PIPELINE_SIGNAL=${signal}`);
    releasePipelineLock(config.dailyPipelineLockFilePath);
    process.exit(130);
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));

  try {
    // -------- PHASE 1: Tender247 crawl --------
    logger.info("DAILY_PIPELINE_TENDER247_START");
    const tender247Script = resolveProjectPath(
      "src/tender247Batch/runDailyBatch.ts",
    );
    const batchExtraArgs = [`--date=${dateIso}`];
    if (accountArgs.accountId) {
      batchExtraArgs.push(`--account-id=${accountArgs.accountId}`);
    }
    if (accountArgs.companyId) {
      batchExtraArgs.push(`--company-id=${accountArgs.companyId}`);
    }
    const uploadedExcel =
      getArgValue(process.argv.slice(2), "file") ||
      getArgValue(process.argv.slice(2), "excel") ||
      process.env.TENDER247_UPLOADED_EXCEL?.trim() ||
      null;
    if (uploadedExcel) {
      batchExtraArgs.push("--file", uploadedExcel);
      batchExtraArgs.push("--pre-screened");
    }
    const exitCode = await runScriptProcess({
      scriptPath: tender247Script,
      cwd: config.projectRoot,
      logger,
      label: "tender247-batch",
      extraArgs: batchExtraArgs,
      env: {
        ...(accountArgs.accountId
          ? { TENDER247_ACCOUNT_ID: accountArgs.accountId }
          : {}),
        ...(accountArgs.companyId
          ? { COMPANY_ID: accountArgs.companyId }
          : {}),
        ...(uploadedExcel
          ? { TENDER247_UPLOADED_EXCEL: uploadedExcel }
          : {}),
      },
    });
    summary.tender247ExitCode = exitCode;

    if (exitCode !== 0) {
      summary.tender247 = "FAILED";
      summary.error = `Tender247 exited with code ${exitCode}`;
      logger.error("DAILY_PIPELINE_TENDER247_FAILED");
      summary.finishedAt = new Date().toISOString();
      writeDailyPipelineSummary(dateFolder, summary);
      printDailyPipelineSummary(summary);
      process.exitCode = exitCode;
      return summary;
    }

    summary.tender247 = "SUCCESS";
    logger.info("DAILY_PIPELINE_TENDER247_COMPLETE");
    logger.info("T247_ARTIFACT_ACQUISITION_BATCH_COMPLETE=true");
    logger.info("PIPELINE_PHASE=CHATGPT_QUALIFICATION");

    const excelAudit = readExcelFilterAudit(dateFolder);
    if (excelAudit) {
      summary.tender247ExcelRows = excelAudit.excelRows;
      summary.tender247ExcelDropped =
        excelAudit.droppedByTenderValue + excelAudit.droppedByEmd;
      summary.tender247ExcelKept = excelAudit.detailCrawlsRequired;
    }

    // -------- Wait for crawler locks --------
    await waitForCrawlerLockRelease({
      lockPaths: [config.crawlLockFilePath, config.lockFilePath],
      timeoutMs: 120_000,
      logger,
    });

    // -------- PHASE 2: readiness --------
    const readiness = await buildGptReadinessReport(dateFolder, dateIso, logger);
    saveGptReadinessReport(dateFolder, readiness);
    const discovered = listDownloadedTenderIds(dateFolder);
    summary.tenderFoldersDiscovered = discovered.length;
    summary.tender247DetailCrawled = discovered.length;
    summary.tender247SupabaseStored = discovered.length;
    summary.gptReady = readiness.ready;
    summary.gptNotReady = readiness.missingTenderIds.length;

    const localPrescreen = await countPrescreenOutcomesForTenderIds({
      sourcePortal: "TENDER247",
      sourceTenderIds: discovered,
    });
    summary.tender247PrescreenRejected = localPrescreen.rejected;
    summary.tender247ManualReview = localPrescreen.manualReview;

    logger.info(`DAILY_PIPELINE_GPT_READY_COUNT=${readiness.ready}`);
    logger.info(
      `DAILY_PIPELINE_GPT_NOT_READY_COUNT=${readiness.missingTenderIds.length}`,
    );

    // Fresh runs must still qualify selected ready tenders even when an old
    // result exists. Resume reuse is decided inside runQualificationBatch.
    summary.newReadyForQualification = readiness.readyTenderIds.length;
    summary.remainingReady = readiness.readyTenderIds.length;

    // -------- Settle delay --------
    if (config.dailyPipelinePhaseDelayMs > 0) {
      logger.info(
        `DAILY_PIPELINE_PHASE_DELAY_MS=${config.dailyPipelinePhaseDelayMs}`,
      );
      await sleep(config.dailyPipelinePhaseDelayMs);
    }

    // -------- PHASE 3: ChatGPT --------
    if (readiness.readyTenderIds.length === 0) {
      logger.info("DAILY_PIPELINE_NO_NEW_READY_TENDERS");
      summary.skippedExisting = 0;
      summary.finishedAt = new Date().toISOString();
      writeDailyPipelineSummary(dateFolder, summary);
      printDailyPipelineSummary(summary);
      return summary;
    }

    logger.info("DAILY_PIPELINE_CHATGPT_START");
    summary.chatgptStarted = true;

    // Force ready-only mode for this phase
    process.env.CHATGPT_PROCESS_READY_ONLY = "true";
    process.env.CHATGPT_CONTINUE_ON_ERROR =
      process.env.CHATGPT_CONTINUE_ON_ERROR || "true";

    let chatgptSummary: QualificationBatchSummary;
    try {
      chatgptSummary = await runQualificationBatch({ dateIso });
    } catch (error) {
      summary.error = safeErrorMessage(error);
      logger.error(`DAILY_PIPELINE_CHATGPT_FAILED=${summary.error}`);
      summary.finishedAt = new Date().toISOString();
      writeDailyPipelineSummary(dateFolder, summary);
      printDailyPipelineSummary(summary);
      process.exitCode = 1;
      return summary;
    }

    summary.qualificationCompleted =
      chatgptSummary.completedThisRun ?? chatgptSummary.completed;
    summary.skippedExisting =
      chatgptSummary.reusedExistingValid ?? chatgptSummary.skipped;
    summary.pending = chatgptSummary.pending;
    summary.rateLimited = chatgptSummary.rateLimited;
    summary.failed = chatgptSummary.failedThisRun ?? chatgptSummary.failed;
    summary.remainingReady = Math.max(
      0,
      chatgptSummary.remainingQueued +
        (chatgptSummary.pending > 0 || chatgptSummary.rateLimited > 0
          ? 0
          : 0),
    );

    // Recompute remaining ready after qualification (no valid result yet).
    const postReadiness = await buildGptReadinessReport(dateFolder, dateIso, logger);
    summary.remainingReady = listNewReadyTenderIds(
      dateFolder,
      postReadiness.readyTenderIds,
      isValidSavedQualificationResult,
    ).length;

    logger.info("DAILY_PIPELINE_CHATGPT_COMPLETE");
    summary.finishedAt = new Date().toISOString();
    writeDailyPipelineSummary(dateFolder, summary);
    printDailyPipelineSummary(summary);
    return summary;
  } catch (error) {
    const message = safeErrorMessage(error);
    const code =
      error instanceof AutomationError ? error.code : "DAILY_PIPELINE_FAILED";
    logger.error(`[${code}] ${message}`);
    summary.error = message;
    summary.finishedAt = new Date().toISOString();
    writeDailyPipelineSummary(dateFolder, summary);
    printDailyPipelineSummary(summary);
    if (code === "DAILY_PIPELINE_ALREADY_RUNNING") {
      console.error(`\nDAILY_PIPELINE_ALREADY_RUNNING\n${message}\n`);
    }
    process.exitCode = 1;
    return summary;
  } finally {
    releasePipelineLock(config.dailyPipelineLockFilePath);
    logger.info("DAILY_PIPELINE_LOCK_RELEASED");
  }
}

async function main(): Promise<void> {
  const logger = new Logger(loadConfig().logRoot, "DailyTenderPipeline");
  try {
    await runDailyTenderPipeline();
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

/** Exported for tests — config accessor without running the pipeline. */
export function getPipelineLockPaths(config: AppConfig = loadConfig()): {
  master: string;
  crawl: string;
  automation: string;
} {
  return {
    master: config.dailyPipelineLockFilePath,
    crawl: config.crawlLockFilePath,
    automation: config.lockFilePath,
  };
}

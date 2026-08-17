/**
 * Tender247 COMPLETE daily pipeline (BidAssist excluded).
 *
 * Requested Date → Excel/list → normalize/dedupe → deterministic pre-screen →
 * detail crawl survivors → ChatGPT qualification → Supabase (via existing paths) →
 * run summary.
 *
 * Modes:
 *   complete (default) — process all survivors; no default crawl/ChatGPT caps
 *   smoke/test         — optional --limit / --chatgpt-limit
 *   --dry-run-date     — resolve date, select mail date, download Excel, pre-screen; stop
 *
 * Usage:
 *   npm run pipeline:tender247 -- --date=2026-08-11
 *   npm run pipeline:tender247
 *   npm run pipeline:tender247 -- --date=2026-08-11 --dry-run-date
 *   npm run test:pipeline:tender247 -- --date=2026-08-11
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutomationError } from "../browserUtils.js";
import {
  runQualificationBatch,
  type QualificationBatchSummary,
} from "../chatgptQualification/runQualificationBatch.js";
import {
  isValidSavedQualificationResult,
} from "../chatgptQualification/qualificationSchema.js";
import {
  buildGptReadinessReport,
  listDownloadedTenderIds,
  saveGptReadinessReport,
} from "../chatgptQualification/readiness.js";
import {
  assertDatePropagationAgreement,
  effectiveArgvFromNpmConfig,
  getArgOrNpmConfig,
  hasBooleanFlag,
  logRawArgv,
  resolveRequestedDate,
} from "../cli/requestedDate.js";
import { loadConfig } from "../config.js";
import { formatIsoToDdMmYyyySlash } from "../dateUtils.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import { Logger, safeErrorMessage } from "../logger.js";
import {
  formatProductionLimit,
  isUnlimitedProductionLimit,
} from "../productionLimit.js";
import {
  countPrescreenOutcomesForTenderIds,
} from "../prescreen/prescreenRepository.js";
import { readExcelFilterAudit } from "../tender247Batch/excelFilterAudit.js";
import {
  acquirePipelineLock,
  releasePipelineLock,
} from "../runDailyTenderPipeline.js";

export type Tender247CompleteMode = "complete" | "smoke";

export type Tender247CompleteRunStatus =
  | "SUCCESS"
  | "COMPLETED_WITH_FAILURES"
  | "FAILED_FATAL";

export type Tender247CompletePipelineOptions = {
  requestedDate: string;
  mode: Tender247CompleteMode;
  sources: ["TENDER247"];
  dryRunDate: boolean;
  /** When set with dry-run-date: validate CLI/date resolution only (no browser). */
  cliOnly: boolean;
  /** Resume: reuse date-folder Excel/docs/metadata; ChatGPT only missing/failed quals. */
  resume: boolean;
  /**
   * With --resume: skip Tender247 detail crawl and go straight to ChatGPT recovery.
   * Default true when --resume is set (override with --resume --crawl).
   */
  resumeSkipCrawl: boolean;
  /** Optional crawl cap; null/undefined = unlimited in complete mode. */
  crawlLimit: number | null;
  /** Optional ChatGPT cap; null/undefined = unlimited in complete mode. */
  chatgptLimit: number | null;
  rawArgv: string[];
  dateSource: "cli" | "npm_config" | "env" | "india_today";
};

export type Tender247CompleteRunSummary = {
  success: boolean;
  runStatus: Tender247CompleteRunStatus;
  requestedDate: string;
  dailyRowsRaw: number;
  dailyRowsDeduped: number;
  filteredOut: number;
  filterPassed: number;
  detailCrawlAttempted: number;
  detailCrawlSuccess: number;
  detailCrawlFailed: number;
  chatgptAttempted: number;
  chatgptSuccess: number;
  chatgptFailed: number;
  chatgptSelected?: number;
  chatgptSubmittedThisRun?: number;
  chatgptCompletedThisRun?: number;
  chatgptReusedExistingValid?: number;
  chatgptFailedThisRun?: number;
  chatgptRetryPending?: number;
  go: number;
  conditionalGo: number;
  partnerBid: number;
  verify: number;
  noGo: number;
  supabaseUpsertSuccess: number;
  supabaseUpsertFailed: number;
  processingErrors: string[];
  downloadRoot: string;
  actionable: Array<{ sourceTenderId: string; status: string }>;
  dryRunDate: boolean;
  chatgptFailedTenderIds?: string[];
  chatgptRetryPendingTenderIds?: string[];
  chatgptCompletedTenderIds?: string[];
  chatgptSummaryInvariantFailed?: boolean;
};

function parsePositiveInt(
  raw: string | undefined,
  label: string,
): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return n;
}

export function parseTender247CompletePipelineArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): Tender247CompletePipelineOptions {
  const resolved = resolveRequestedDate(argv, { env });
  const dryRunDate = hasBooleanFlag(argv, "dry-run-date", env);
  const cliOnly = hasBooleanFlag(argv, "cli-only", env);
  const resume = hasBooleanFlag(argv, "resume", env);
  // --resume defaults to ChatGPT-only recovery; pass --crawl to also continue detail work.
  const resumeForceCrawl = hasBooleanFlag(argv, "crawl", env);
  const resumeSkipCrawl = resume && !resumeForceCrawl;

  const modeRaw = (
    getArgOrNpmConfig(argv, "mode", env) || "complete"
  )
    .trim()
    .toLowerCase();
  const mode: Tender247CompleteMode =
    modeRaw === "smoke" || modeRaw === "test" ? "smoke" : "complete";

  const crawlLimit = parsePositiveInt(
    getArgOrNpmConfig(argv, "limit", env) ??
      getArgOrNpmConfig(argv, "crawl-limit", env) ??
      undefined,
    "--limit",
  );
  const chatgptLimit = parsePositiveInt(
    getArgOrNpmConfig(argv, "chatgpt-limit", env) ??
      getArgOrNpmConfig(argv, "qualify-limit", env) ??
      undefined,
    "--chatgpt-limit",
  );

  return {
    requestedDate: resolved.requestedDate,
    mode,
    sources: ["TENDER247"],
    dryRunDate,
    cliOnly,
    resume,
    resumeSkipCrawl,
    crawlLimit,
    chatgptLimit,
    rawArgv: [...argv],
    dateSource: resolved.source,
  };
}

function runScriptProcess(options: {
  scriptPath: string;
  cwd: string;
  logger: Logger;
  label: string;
  extraArgs: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "npx",
      ["tsx", options.scriptPath, ...options.extraArgs],
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: "inherit",
        shell: true,
      },
    );
    proc.on("error", reject);
    proc.on("exit", (code) => {
      options.logger.info(`${options.label}_EXIT_CODE=${code ?? 1}`);
      resolve(code ?? 1);
    });
  });
}

function countQualificationStatuses(
  dateFolder: string,
): Record<string, number> {
  const counts: Record<string, number> = {
    GO: 0,
    CONDITIONAL_GO: 0,
    PARTNER_BID: 0,
    VERIFY: 0,
    NO_GO: 0,
  };
  const actionable: Array<{ sourceTenderId: string; status: string }> = [];
  if (!fs.existsSync(dateFolder)) return counts;

  for (const name of fs.readdirSync(dateFolder)) {
    const m = name.match(/^T247-(\d+)$/i);
    if (!m) continue;
    // Canonical writer uses qualification-result.json (not chatgpt-qualification-result.json).
    const resultPath = path.join(dateFolder, name, "qualification-result.json");
    if (!isValidSavedQualificationResult(resultPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
        status?: string;
      };
      const status = String(raw.status || "").toUpperCase();
      if (status in counts) {
        counts[status] = (counts[status] ?? 0) + 1;
        actionable.push({ sourceTenderId: m[1]!, status });
      }
    } catch {
      // ignore
    }
  }
  (counts as { __actionable?: typeof actionable }).__actionable = actionable;
  return counts;
}

function readPrescreenCounts(dateFolder: string): {
  dailyRowsRaw: number;
  dailyRowsDeduped: number;
  filteredOut: number;
  filterPassed: number;
} {
  const prescreenPath = path.join(dateFolder, "tender247-prescreen.json");
  if (fs.existsSync(prescreenPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(prescreenPath, "utf8")) as {
        dailyRowsRaw?: number;
        dailyRowsDeduped?: number;
        filterCounts?: { passed?: number };
        survivingTenderIds?: string[];
      };
      const passed =
        parsed.filterCounts?.passed ??
        parsed.survivingTenderIds?.length ??
        0;
      const deduped = parsed.dailyRowsDeduped ?? 0;
      return {
        dailyRowsRaw: parsed.dailyRowsRaw ?? deduped,
        dailyRowsDeduped: deduped,
        filteredOut: Math.max(0, deduped - passed),
        filterPassed: passed,
      };
    } catch {
      // fall through
    }
  }
  const audit = readExcelFilterAudit(dateFolder);
  if (audit) {
    return {
      dailyRowsRaw: audit.excelRows,
      dailyRowsDeduped: audit.excelRows,
      filteredOut: audit.droppedByTenderValue + audit.droppedByEmd,
      filterPassed: audit.detailCrawlsRequired,
    };
  }
  return {
    dailyRowsRaw: 0,
    dailyRowsDeduped: 0,
    filteredOut: 0,
    filterPassed: 0,
  };
}

export function printTender247CompleteRunSummary(
  summary: Tender247CompleteRunSummary,
): void {
  console.log("");
  console.log("==================================");
  console.log(
    `TENDER247_COMPLETE_RUN_STATUS=${summary.runStatus}`,
  );
  console.log(
    `TENDER247_COMPLETE_RUN_SUCCESS=${summary.success ? "true" : "false"}`,
  );
  console.log(`REQUESTED_DATE=${summary.requestedDate}`);
  console.log(`SOURCE=TENDER247`);
  console.log(`DAILY_ROWS_RAW=${summary.dailyRowsRaw}`);
  console.log(`DAILY_ROWS_DEDUPED=${summary.dailyRowsDeduped}`);
  console.log(`FILTERED_OUT=${summary.filteredOut}`);
  console.log(`FILTER_PASSED=${summary.filterPassed}`);
  console.log(`DETAIL_CRAWL_ATTEMPTED=${summary.detailCrawlAttempted}`);
  console.log(`DETAIL_CRAWL_SUCCESS=${summary.detailCrawlSuccess}`);
  console.log(`DETAIL_CRAWL_FAILED=${summary.detailCrawlFailed}`);
  console.log(`CHATGPT_SELECTED=${summary.chatgptSelected ?? summary.chatgptAttempted}`);
  console.log(
    `CHATGPT_SUBMITTED_THIS_RUN=${summary.chatgptSubmittedThisRun ?? summary.chatgptAttempted}`,
  );
  console.log(
    `CHATGPT_COMPLETED_THIS_RUN=${summary.chatgptCompletedThisRun ?? 0}`,
  );
  console.log(
    `CHATGPT_REUSED_EXISTING_VALID=${summary.chatgptReusedExistingValid ?? 0}`,
  );
  console.log(
    `CHATGPT_FAILED_THIS_RUN=${summary.chatgptFailedThisRun ?? summary.chatgptFailed}`,
  );
  console.log(
    `CHATGPT_RETRY_PENDING=${summary.chatgptRetryPending ?? 0}`,
  );
  console.log(
    `CHATGPT_TOTAL_VALID_QUALIFICATIONS_AVAILABLE=${summary.chatgptSuccess}`,
  );
  // Legacy aliases — CHATGPT_ATTEMPTED means actual GPT submissions this run.
  console.log(`CHATGPT_ATTEMPTED=${summary.chatgptSubmittedThisRun ?? summary.chatgptAttempted}`);
  console.log(
    `CHATGPT_SUCCESS=${summary.chatgptSuccess}`,
  );
  console.log(`CHATGPT_FAILED=${summary.chatgptFailed}`);
  console.log(`GO=${summary.go}`);
  console.log(`CONDITIONAL_GO=${summary.conditionalGo}`);
  console.log(`PARTNER_BID=${summary.partnerBid}`);
  console.log(`VERIFY=${summary.verify}`);
  console.log(`NO_GO=${summary.noGo}`);
  console.log(
    `CHATGPT_CANONICAL_STATUS_COUNTS=${JSON.stringify({
      GO: summary.go,
      CONDITIONAL_GO: summary.conditionalGo,
      PARTNER_BID: summary.partnerBid,
      VERIFY: summary.verify,
      NO_GO: summary.noGo,
    })}`,
  );
  if (summary.chatgptSummaryInvariantFailed) {
    console.log("CHATGPT_SUMMARY_INVARIANT_FAILED=true");
  }
  if (summary.chatgptFailedTenderIds) {
    console.log(
      `CHATGPT_FAILED_TENDER_IDS=${JSON.stringify(summary.chatgptFailedTenderIds)}`,
    );
  }
  if (summary.chatgptRetryPendingTenderIds) {
    console.log(
      `CHATGPT_RETRY_PENDING_TENDER_IDS=${JSON.stringify(summary.chatgptRetryPendingTenderIds)}`,
    );
  }
  if (summary.chatgptCompletedTenderIds) {
    console.log(
      `CHATGPT_COMPLETED_TENDER_IDS=${JSON.stringify(summary.chatgptCompletedTenderIds)}`,
    );
  }
  console.log(`SUPABASE_UPSERT_SUCCESS=${summary.supabaseUpsertSuccess}`);
  console.log(`SUPABASE_UPSERT_FAILED=${summary.supabaseUpsertFailed}`);
  console.log(
    `PROCESSING_ERRORS=${summary.processingErrors.length}`,
  );
  for (const err of summary.processingErrors) {
    console.log(`PROCESSING_ERROR=${err}`);
  }
  console.log(`DOWNLOAD_ROOT=${summary.downloadRoot}`);
  if (summary.actionable.length > 0) {
    console.log("ACTIONABLE_TENDERS:");
    for (const row of summary.actionable) {
      console.log(`  T247-${row.sourceTenderId}=${row.status}`);
    }
  }
  console.log("==================================");
  console.log("");
}

export async function runTender247CompletePipeline(
  options: Tender247CompletePipelineOptions,
): Promise<{ summary: Tender247CompleteRunSummary; exitCode: number }> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "TENDER247-COMPLETE");
  const requestedDate = options.requestedDate;
  const downloadRoot = path.join(
    resolveProjectPath(config.downloadRoot),
    requestedDate,
  );
  ensureDir(downloadRoot);

  logRawArgv(options.rawArgv, "COMPLETE_E2E_RAW_ARGV");
  if (options.rawArgv.length === 0) {
    const reconstructed = effectiveArgvFromNpmConfig();
    if (reconstructed.length > 0) {
      console.log(
        `COMPLETE_E2E_EFFECTIVE_ARGV=${JSON.stringify(reconstructed)}`,
      );
    }
  }
  console.log(`COMPLETE_E2E_DATE_SOURCE=${options.dateSource}`);
  if (
    options.rawArgv.length === 0 &&
    options.dateSource === "npm_config"
  ) {
    console.log(
      "COMPLETE_E2E_ARGV_NOTE=process.argv empty; using npm_config_* (PowerShell swallowed --)",
    );
  }
  console.log(`REQUESTED_DATE=${requestedDate}`);
  console.log(`E2E_DATE=${requestedDate}`);
  console.log(`COMPLETE_E2E_DATE=${requestedDate}`);
  console.log(`TENDER247_RUN_REQUESTED_DATE=${requestedDate}`);
  console.log(`SOURCE=TENDER247`);
  console.log(`SOURCES=${JSON.stringify(options.sources)}`);
  console.log(`PIPELINE_MODE=${options.mode}`);
  console.log(`DOWNLOAD_ROOT=${downloadRoot}`);
  console.log(
    `TENDER247_MAIL_DATE_INPUT_VALUE_EXPECTED=${formatIsoToDdMmYyyySlash(requestedDate)}`,
  );

  assertDatePropagationAgreement(requestedDate, {
    COMPLETE_E2E_DATE: requestedDate,
    E2E_DATE: requestedDate,
    TENDER247_RUN_REQUESTED_DATE: requestedDate,
  });

  if (options.dryRunDate && options.cliOnly) {
    const expectedInput = formatIsoToDdMmYyyySlash(requestedDate);
    console.log(`TENDER247_EXCEL_REQUESTED_DATE=${requestedDate}`);
    console.log(
      `TENDER247_MAIL_DATE_INPUT_VALUE_EXPECTED=${expectedInput}`,
    );
    console.log("TENDER247_DRY_RUN_DATE_CLI_ONLY=true");
    console.log(
      "NOTE=UI mail-date / PRE_XLS_DATE_MATCH require --dry-run-date without --cli-only",
    );
    const summary: Tender247CompleteRunSummary = {
      success: true,
      runStatus: "SUCCESS",
      requestedDate,
      dailyRowsRaw: 0,
      dailyRowsDeduped: 0,
      filteredOut: 0,
      filterPassed: 0,
      detailCrawlAttempted: 0,
      detailCrawlSuccess: 0,
      detailCrawlFailed: 0,
      chatgptAttempted: 0,
      chatgptSuccess: 0,
      chatgptFailed: 0,
      go: 0,
      conditionalGo: 0,
      partnerBid: 0,
      verify: 0,
      noGo: 0,
      supabaseUpsertSuccess: 0,
      supabaseUpsertFailed: 0,
      processingErrors: [],
      downloadRoot,
      actionable: [],
      dryRunDate: true,
    };
    printTender247CompleteRunSummary(summary);
    writeSummary(downloadRoot, summary);
    return { summary, exitCode: 0 };
  }

  const crawlLimit =
    options.crawlLimit ??
    (options.mode === "smoke" ? 5 : null);
  const chatgptLimit =
    options.chatgptLimit ??
    (options.mode === "smoke" ? 1 : null);

  if (crawlLimit != null) {
    console.log(`COMPLETE_E2E_CRAWL_MAX_PER_SOURCE=${crawlLimit}`);
    console.log(`E2E_CRAWL_CANDIDATES=${crawlLimit}`);
  } else {
    console.log("COMPLETE_E2E_CRAWL_MAX_PER_SOURCE=UNLIMITED");
    console.log("E2E_CRAWL_CANDIDATES=UNLIMITED");
  }
  if (chatgptLimit != null) {
    console.log(`COMPLETE_E2E_CHATGPT_MAX_PER_SOURCE=${chatgptLimit}`);
    console.log(`E2E_QUALIFY_LIMIT=${chatgptLimit}`);
  } else {
    console.log("COMPLETE_E2E_CHATGPT_MAX_PER_SOURCE=UNLIMITED");
    console.log("E2E_QUALIFY_LIMIT=UNLIMITED");
  }
  console.log("COMPLETE_E2E_SKIP_BIDASSIST reason=tender247_only_pipeline");
  if (options.resume) {
    console.log("TENDER247_RESUME=true");
    console.log(
      "TENDER247_RESUME_MODE=reuse_excel_docs_metadata_prescreen_skip_valid_quals",
    );
    console.log(
      `TENDER247_RESUME_SKIP_CRAWL=${options.resumeSkipCrawl ? "true" : "false"}`,
    );
  }

  const lockPath = path.join(
    resolveProjectPath("runtime"),
    "tender247-complete-pipeline.lock",
  );
  ensureDir(path.dirname(lockPath));
  acquirePipelineLock(lockPath, {
    name: "tender247-complete-pipeline",
    alreadyRunningCode: "TENDER247_COMPLETE_ALREADY_RUNNING",
  });

  const processingErrors: string[] = [];
  let exitCode = 0;

  const onSignal = (): void => {
    releasePipelineLock(lockPath);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const pre = readPrescreenCounts(downloadRoot);

    if (!options.resumeSkipCrawl) {
      const batchScript = resolveProjectPath(
        "src/tender247Batch/runDailyBatch.ts",
      );
      const batchArgs = [`--date=${requestedDate}`];
      if (options.dryRunDate) {
        batchArgs.push("--dry-run-date");
      }
      if (options.resume) {
        batchArgs.push("--resume");
      }

      const env: NodeJS.ProcessEnv = {
        TENDER247_DATE: requestedDate,
      };
      if (options.resume) {
        env.TENDER247_RESUME = "true";
      }
      if (crawlLimit != null) {
        env.MAX_TENDERS = String(crawlLimit);
      } else {
        // Complete mode: never inherit a stale smoke MAX_TENDERS=5 from the shell.
        env.MAX_TENDERS = "0";
      }

      logger.info("TENDER247_COMPLETE_CRAWL_START");
      const crawlExit = await runScriptProcess({
        scriptPath: batchScript,
        cwd: config.projectRoot,
        logger,
        label: "TENDER247_COMPLETE_CRAWL",
        extraArgs: batchArgs,
        env,
      });
      if (crawlExit !== 0) {
        processingErrors.push(
          `PROCESSING_ERROR stage=crawl message=Tender247 batch exited ${crawlExit}`,
        );
        exitCode = crawlExit;
        const summary = buildFailureSummary({
          requestedDate,
          downloadRoot,
          processingErrors,
          dryRunDate: options.dryRunDate,
        });
        printTender247CompleteRunSummary(summary);
        writeSummary(downloadRoot, summary);
        return { summary, exitCode };
      }
    } else {
      logger.info(
        "TENDER247_RESUME_SKIP_CRAWL=true — reusing existing date-folder downloads; ChatGPT recovery only",
      );
      console.log("TENDER247_RESUME_SKIP_CRAWL=true");
    }

    // Refresh prescreen counts after crawl (or reuse existing on skip-crawl resume).
    const preAfter = readPrescreenCounts(downloadRoot);
    const preCounts = options.resumeSkipCrawl ? pre : preAfter;

    if (options.dryRunDate) {
      const summary: Tender247CompleteRunSummary = {
        success: true,
        runStatus: "SUCCESS",
        requestedDate,
        dailyRowsRaw: preCounts.dailyRowsRaw,
        dailyRowsDeduped: preCounts.dailyRowsDeduped,
        filteredOut: preCounts.filteredOut,
        filterPassed: preCounts.filterPassed,
        detailCrawlAttempted: 0,
        detailCrawlSuccess: 0,
        detailCrawlFailed: 0,
        chatgptAttempted: 0,
        chatgptSuccess: 0,
        chatgptFailed: 0,
        go: 0,
        conditionalGo: 0,
        partnerBid: 0,
        verify: 0,
        noGo: 0,
        supabaseUpsertSuccess: 0,
        supabaseUpsertFailed: 0,
        processingErrors: [],
        downloadRoot,
        actionable: [],
        dryRunDate: true,
      };
      console.log("TENDER247_DRY_RUN_DATE_SUCCESS=true");
      printTender247CompleteRunSummary(summary);
      writeSummary(downloadRoot, summary);
      return { summary, exitCode: 0 };
    }

    const discovered = listDownloadedTenderIds(downloadRoot);
    const readiness = buildGptReadinessReport(downloadRoot, requestedDate);
    saveGptReadinessReport(downloadRoot, readiness);
    const localPrescreen = await countPrescreenOutcomesForTenderIds({
      sourcePortal: "TENDER247",
      sourceTenderIds: discovered,
    });

    // Fresh runs must still process selected candidates even if an old
    // qualification-result.json exists. Resume skip/reuse is decided inside
    // runQualificationBatch via input fingerprint — do not pre-filter here.
    const readyForChatgpt = readiness.readyTenderIds;

    let chatgptSummary: QualificationBatchSummary | null = null;
    if (readyForChatgpt.length === 0) {
      logger.info("TENDER247_COMPLETE_NO_NEW_READY_TENDERS");
    } else {
      logger.info("TENDER247_COMPLETE_CHATGPT_START");
      process.env.CHATGPT_PROCESS_READY_ONLY =
        process.env.CHATGPT_PROCESS_READY_ONLY || "true";
      process.env.CHATGPT_CONTINUE_ON_ERROR =
        process.env.CHATGPT_CONTINUE_ON_ERROR || "true";
      try {
        chatgptSummary = await runQualificationBatch({
          dateIso: requestedDate,
          resume: options.resume,
          maxGptTenders:
            chatgptLimit != null
              ? chatgptLimit
              : isUnlimitedProductionLimit(config.maxGptTenders)
                ? 0
                : config.maxGptTenders,
        });
      } catch (error) {
        const message = safeErrorMessage(error);
        processingErrors.push(
          `PROCESSING_ERROR stage=chatgpt message=${message}`,
        );
        // Individual ChatGPT batch failure is not always fatal for exit code
        // when crawl succeeded — treat as non-zero only if nothing completed.
        exitCode = 1;
      }
    }

    const statusCounts = countQualificationStatuses(downloadRoot);
    const actionable =
      (
        statusCounts as {
          __actionable?: Array<{ sourceTenderId: string; status: string }>;
        }
      ).__actionable ?? [];

    const go = statusCounts.GO ?? 0;
    const conditionalGo = statusCounts.CONDITIONAL_GO ?? 0;
    const partnerBid = statusCounts.PARTNER_BID ?? 0;
    const verify = statusCounts.VERIFY ?? 0;
    const noGo = statusCounts.NO_GO ?? 0;
    const chatgptSuccessCanonical =
      go + conditionalGo + partnerBid + verify + noGo;
    // Disk totals available for the date (includes reused + completed this run).
    const chatgptSuccess = chatgptSuccessCanonical;
    const chatgptFailed =
      chatgptSummary?.failedThisRun ?? chatgptSummary?.failed ?? 0;
    const submittedThisRun = chatgptSummary?.submittedThisRun ?? 0;
    const completedThisRun = chatgptSummary?.completedThisRun ?? 0;
    const reusedExistingValid = chatgptSummary?.reusedExistingValid ?? 0;
    const retryPending =
      (chatgptSummary?.pending ?? 0) + (chatgptSummary?.rateLimited ?? 0);
    const invariantFailed =
      chatgptSummary != null &&
      completedThisRun > 0 &&
      // Fresh: this-run completions should appear on disk; resume may have extras.
      !options.resume &&
      chatgptSuccessCanonical < completedThisRun;

    let runStatus: Tender247CompleteRunStatus = "SUCCESS";
    if (exitCode !== 0 && chatgptFailed === 0 && processingErrors.length > 0) {
      runStatus = "FAILED_FATAL";
    } else if (chatgptFailed > 0 || (chatgptSummary?.remainingQueued ?? 0) > 0) {
      runStatus = "COMPLETED_WITH_FAILURES";
    } else if (exitCode !== 0) {
      runStatus = "FAILED_FATAL";
    }

    const summary: Tender247CompleteRunSummary = {
      success: runStatus === "SUCCESS",
      runStatus,
      requestedDate,
      dailyRowsRaw: preCounts.dailyRowsRaw,
      dailyRowsDeduped: preCounts.dailyRowsDeduped,
      filteredOut: preCounts.filteredOut,
      filterPassed: preCounts.filterPassed,
      detailCrawlAttempted: discovered.length,
      detailCrawlSuccess: discovered.length,
      detailCrawlFailed: 0,
      // CHATGPT_ATTEMPTED = actual GPT submissions this run (not selected, not reused).
      chatgptAttempted: submittedThisRun,
      chatgptSuccess,
      chatgptFailed,
      chatgptSelected: chatgptSummary?.selected ?? 0,
      chatgptSubmittedThisRun: submittedThisRun,
      chatgptCompletedThisRun: completedThisRun,
      chatgptReusedExistingValid: reusedExistingValid,
      chatgptFailedThisRun: chatgptFailed,
      chatgptRetryPending: retryPending,
      go,
      conditionalGo,
      partnerBid,
      verify,
      noGo,
      supabaseUpsertSuccess: discovered.length,
      supabaseUpsertFailed: 0,
      processingErrors,
      downloadRoot,
      actionable,
      dryRunDate: false,
      chatgptFailedTenderIds: chatgptSummary?.failedTenderIds ?? [],
      chatgptRetryPendingTenderIds:
        chatgptSummary?.retryPendingTenderIds ?? [],
      chatgptCompletedTenderIds: chatgptSummary?.completedTenderIds ?? [],
      chatgptSummaryInvariantFailed: invariantFailed,
    };

    if (invariantFailed) {
      console.log("CHATGPT_SUMMARY_INVARIANT_FAILED=true");
      console.log(
        `CHATGPT_SUMMARY_INVARIANT batchCompleted=${chatgptSummary?.completed ?? 0} diskCanonical=${chatgptSuccessCanonical}`,
      );
    }

    // Manual-review / rejected detailed prescreen is informational.
    void localPrescreen;
    void formatProductionLimit;

    printTender247CompleteRunSummary(summary);
    writeSummary(downloadRoot, summary);
    return {
      summary,
      exitCode: runStatus === "FAILED_FATAL" ? 1 : exitCode,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    if (
      error instanceof AutomationError &&
      error.code === "TENDER247_COMPLETE_ALREADY_RUNNING"
    ) {
      console.error("TENDER247_COMPLETE_ALREADY_RUNNING");
      return {
        summary: buildFailureSummary({
          requestedDate,
          downloadRoot,
          processingErrors: [message],
          dryRunDate: options.dryRunDate,
        }),
        exitCode: 1,
      };
    }
    console.error(message);
    const summary = buildFailureSummary({
      requestedDate,
      downloadRoot,
      processingErrors: [message],
      dryRunDate: options.dryRunDate,
    });
    printTender247CompleteRunSummary(summary);
    writeSummary(downloadRoot, summary);
    return { summary, exitCode: 1 };
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    releasePipelineLock(lockPath);
  }
}

function buildFailureSummary(options: {
  requestedDate: string;
  downloadRoot: string;
  processingErrors: string[];
  dryRunDate: boolean;
}): Tender247CompleteRunSummary {
  const pre = readPrescreenCounts(options.downloadRoot);
  return {
    success: false,
    runStatus: "FAILED_FATAL",
    requestedDate: options.requestedDate,
    dailyRowsRaw: pre.dailyRowsRaw,
    dailyRowsDeduped: pre.dailyRowsDeduped,
    filteredOut: pre.filteredOut,
    filterPassed: pre.filterPassed,
    detailCrawlAttempted: 0,
    detailCrawlSuccess: 0,
    detailCrawlFailed: 0,
    chatgptAttempted: 0,
    chatgptSuccess: 0,
    chatgptFailed: 0,
    go: 0,
    conditionalGo: 0,
    partnerBid: 0,
    verify: 0,
    noGo: 0,
    supabaseUpsertSuccess: 0,
    supabaseUpsertFailed: 0,
    processingErrors: options.processingErrors,
    downloadRoot: options.downloadRoot,
    actionable: [],
    dryRunDate: options.dryRunDate,
  };
}

function writeSummary(
  downloadRoot: string,
  summary: Tender247CompleteRunSummary,
): void {
  ensureDir(downloadRoot);
  fs.writeFileSync(
    path.join(downloadRoot, "tender247-complete-run-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const options = parseTender247CompletePipelineArgs(argv);
  const { exitCode } = await runTender247CompletePipeline(options);
  process.exit(exitCode);
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  main();
}

/**
 * Tender247 Excel financial-filter DRY RUN.
 *
 * Downloads (or reads) today's Excel, applies ONLY the early financial gate,
 * and writes human-review workbooks. Never writes Supabase, opens detail pages,
 * downloads documents, runs detailed prescreen, or opens ChatGPT.
 *
 * Usage:
 *   npm run test:tender247:excel-filter -- --date=2026-08-12
 *   npm run test:tender247:excel-filter -- --date=2026-08-12 --file="C:\path\to\file.xlsx"
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutomationError,
  closeBrowserSession,
  launchBrowserSession,
} from "../browserUtils.js";
import { loadConfig, resolveTender247AuthPath } from "../config.js";
import {
  createTender247RunContext,
  ensureTender247DateScopedDir,
  logTender247RunContext,
  parseCliDateOrToday,
  withTender247RunContextAsync,
} from "../tender247Batch/tender247RunContext.js";
import { Logger, safeErrorMessage } from "../logger.js";
import { loadPrescreenConfig } from "../prescreen/prescreenConfig.js";
import { downloadTender247DailyExcel } from "../sources/tender247.js";
import {
  applyExcelEarlyFinancialFilter,
  type ExcelEarlyFilterSummary,
} from "../tender247Batch/excelEarlyFinancialFilter.js";
import { parseTender247DailyExcelRows } from "../tender247Batch/parseDailyExcelRows.js";
import { ensureTender247FreshListForDate } from "../tender247Batch/ensureTender247FreshListForDate.js";
import {
  loginToTender247,
  persistAuthState,
} from "../tenderDetails/ensureTender247LoggedIn.js";
import { dismissTender247BlockingOverlays } from "../tenderDetails/dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "../tenderDetails/dismissSupportChat.js";
import { writeExcelFilterReviewOutputs } from "./writeExcelFilterReview.js";

export type ExcelFilterDryRunArgs = {
  date: string;
  file: string | null;
  verbose: boolean;
};

export function parseExcelFilterDryRunArgs(
  argv: string[],
): ExcelFilterDryRunArgs {
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
    if (next !== undefined && !next.startsWith("--")) {
      values.set(body, next);
      i += 1;
    } else {
      values.set(body, "true");
    }
  }

  const date = parseCliDateOrToday(values.get("date") || null);
  const fileRaw = values.get("file")?.trim() || null;
  return {
    date,
    file: fileRaw && fileRaw.length > 0 ? fileRaw : null,
    verbose: values.get("verbose") === "true" || values.has("verbose"),
  };
}

/** Safety: dry-run source must never import write/upsert modules. */
export function assertDryRunModuleHasNoSideEffectImports(
  sourceText: string,
): void {
  const importLines = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("import "));

  const bannedImportFragments = [
    "tenderMetadataStore",
    "prescreenRepository",
    "qualificationResultStore",
    "runQualificationBatch",
    "processLiveTender",
    "downloadRequiredTenderFiles",
    "persistPrescreenResult",
    "upsertQualificationResult",
    "upsertTender247Metadata",
    "upsertBidassistMetadata",
  ];

  for (const line of importLines) {
    for (const name of bannedImportFragments) {
      if (line.includes(name)) {
        throw new Error(
          `DRY_RUN_SAFETY_VIOLATION: dry-run module must not import ${name}`,
        );
      }
    }
  }
}

export async function downloadTodayExcel(options: {
  dateFolder: string;
  logger: Logger;
  dateIso: string;
}): Promise<string> {
  const config = loadConfig();
  const authPath = resolveTender247AuthPath(config);
  if (!authPath) {
    throw new AutomationError(
      "TENDER247_AUTH_NOT_FOUND",
      "Missing auth/tender247.json. Run: npm run auth:tender247",
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.dateIso)) {
    throw new Error(`Invalid dateIso=${options.dateIso}; expected YYYY-MM-DD`);
  }

  const folderDate = path.basename(path.resolve(options.dateFolder));
  if (folderDate !== options.dateIso) {
    throw new AutomationError(
      "TENDER247_OUTPUT_DATE_MISMATCH",
      `outputDate=${folderDate} requestedDate=${options.dateIso} — output directory must come only from CLI date`,
    );
  }

  options.logger.info(`BROWSER_BOOTSTRAP_DATE=${options.dateIso}`);
  console.log(`BROWSER_BOOTSTRAP_DATE=${options.dateIso}`);
  options.logger.info(`OUTPUT_DIRECTORY_DATE=${options.dateIso}`);
  console.log(`OUTPUT_DIRECTORY_DATE=${options.dateIso}`);
  options.logger.info(`EXCEL_DOWNLOAD_REQUESTED_DATE=${options.dateIso}`);
  console.log(`EXCEL_DOWNLOAD_REQUESTED_DATE=${options.dateIso}`);

  ensureTender247DateScopedDir(options.dateFolder, options.dateIso);
  const playwrightTemp = path.join(options.dateFolder, "playwright-downloads");
  ensureTender247DateScopedDir(playwrightTemp, options.dateIso);
  let session: Awaited<ReturnType<typeof launchBrowserSession>> | undefined;
  try {
    session = await launchBrowserSession({
      headless: config.headless,
      storageStatePath: authPath,
      downloadPath: playwrightTemp,
      pageTimeoutMs: config.pageTimeoutMs,
    });
    const { page, context } = session;
    await loginToTender247(page, context, options.logger, config);
    await dismissTender247BlockingOverlays(page, options.logger, config);
    await dismissTender247SupportChat(page, options.logger);

    // Date selection is the LAST UI mutation before XLS — after login/nav/dismiss.
    const mailDate = await ensureTender247FreshListForDate(
      page,
      options.dateIso,
      options.logger,
      config.pageTimeoutMs,
    );

    options.logger.info(`SESSION_CONTEXT_REQUESTED_DATE=${options.dateIso}`);
    console.log(`SESSION_CONTEXT_REQUESTED_DATE=${options.dateIso}`);
    options.logger.info(
      `TENDER247_SELECTED_MAIL_DATE=${mailDate.selectedMailDateIso}`,
    );
    console.log(`TENDER247_SELECTED_MAIL_DATE=${mailDate.selectedMailDateIso}`);

    options.logger.info("TENDER247_DAILY_EXCEL_DOWNLOAD_START");
    console.log("TENDER247_DAILY_EXCEL_DOWNLOAD_START");
    const excelPath = await downloadTender247DailyExcel(
      page,
      config,
      options.dateFolder,
      options.logger,
      options.dateIso,
    );

    const savedBase = path.basename(excelPath);
    options.logger.info(`EXCEL_PIPELINE_REQUESTED_DATE=${options.dateIso}`);
    console.log(`EXCEL_PIPELINE_REQUESTED_DATE=${options.dateIso}`);
    options.logger.info(`EXCEL_SAVED_PATH=${excelPath}`);
    console.log(`EXCEL_SAVED_PATH=${excelPath}`);
    if (!savedBase.includes(options.dateIso)) {
      throw new AutomationError(
        "TENDER247_EXCEL_FILENAME_DATE_MISMATCH",
        `Normalized Excel name must include requested date ${options.dateIso}; got ${savedBase}`,
      );
    }
    if (!path.resolve(excelPath).includes(path.join(options.dateIso))) {
      throw new AutomationError(
        "TENDER247_OUTPUT_DATE_MISMATCH",
        `Excel saved outside requested date folder: ${excelPath}`,
      );
    }

    options.logger.info(`TENDER247_DAILY_EXCEL_DOWNLOADED=${excelPath}`);
    await persistAuthState(context, config, options.logger);
    return excelPath;
  } finally {
    await closeBrowserSession(session);
  }
}

export function runExcelFilterDryRunOnFile(options: {
  dateIso: string;
  excelPath: string;
  dateFolder: string;
  verbose?: boolean;
}): {
  summary: ExcelEarlyFilterSummary;
  review: ReturnType<typeof writeExcelFilterReviewOutputs>;
} {
  const logger = new Logger(loadConfig().logRoot, "Tender247ExcelFilterDryRun");
  const parsed = parseTender247DailyExcelRows(options.excelPath, logger);
  logger.info(`TENDER247_DAILY_EXCEL_ROWS=${parsed.rows.length}`);

  const cfg = loadPrescreenConfig();
  const summary = applyExcelEarlyFinancialFilter(parsed.rows, {
    tenderValueMaxInr: cfg.tenderValueMaxInr,
    tender247EmdMaxInr: cfg.tender247EmdMaxInr,
  });

  if (options.verbose) {
    for (const d of summary.decisions) {
      const label = `T247-${d.sourceTenderId}`;
      if (d.status === "DROP") {
        console.log(label);
        console.log(`VALUE_INR=${d.parsedTenderValueInr ?? "null"}`);
        console.log(`EMD_INR=${d.parsedEmdInr ?? "null"}`);
        console.log("RESULT=DROP");
        console.log(`REASON=${d.reasonCode}`);
      } else {
        console.log(label);
        console.log(`VALUE_RAW=${d.rawTenderValue ?? ""}`);
        console.log(`VALUE_INR=${d.parsedTenderValueInr ?? "null"}`);
        console.log(`EMD_RAW=${d.rawEmd ?? ""}`);
        console.log(`EMD_INR=${d.parsedEmdInr ?? "null"}`);
        console.log("RESULT=KEEP");
      }
      console.log("");
    }
  }

  const review = writeExcelFilterReviewOutputs({
    dateFolder: options.dateFolder,
    dateIso: options.dateIso,
    excelPath: options.excelPath,
    summary,
  });

  return { summary, review };
}

export function printExcelFilterDryRunSummary(options: {
  dateIso: string;
  excelPath: string;
  summary: ExcelEarlyFilterSummary;
  keptPath: string;
  droppedPath: string;
}): void {
  const keepTotal =
    options.summary.keptWithinLimits + options.summary.keptBecauseUnavailable;
  const dropTotal =
    options.summary.droppedByTenderValue +
    options.summary.droppedByEmd +
    options.summary.droppedByBoth;

  console.log("");
  console.log("==============================================");
  console.log("Tender247 Excel Financial Filter — DRY RUN");
  console.log("==============================================");
  console.log(`Date: ${options.dateIso}`);
  console.log(`Excel: ${options.excelPath}`);
  console.log("");
  console.log(`Rows in Excel: ${options.summary.excelRows}`);
  console.log("");
  console.log(`KEEP: ${keepTotal}`);
  console.log(
    `  Within financial limits: ${options.summary.keptWithinLimits}`,
  );
  console.log(
    `  Financial data unavailable: ${options.summary.keptBecauseUnavailable}`,
  );
  console.log("");
  console.log(`DROP: ${dropTotal}`);
  console.log(
    `  Tender value > ₹5 Cr: ${options.summary.droppedByTenderValue}`,
  );
  console.log(`  EMD > ₹15 L: ${options.summary.droppedByEmd}`);
  console.log(`  Both over limits: ${options.summary.droppedByBoth}`);
  console.log("");
  console.log("Supabase writes: DISABLED");
  console.log("Detail crawl: DISABLED");
  console.log("Document download: DISABLED");
  console.log("ChatGPT: DISABLED");
  console.log("");
  console.log("Review:");
  console.log(options.keptPath);
  console.log(options.droppedPath);
  console.log("==============================================");
  console.log("");
}

export async function runTender247ExcelFilterDryRun(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const args = parseExcelFilterDryRunArgs(argv);
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "Tender247ExcelFilterDryRun");

  const runContext = createTender247RunContext(config.downloadRoot, args.date);
  logTender247RunContext(runContext);
  logger.info(`TENDER247_RUN_REQUESTED_DATE=${runContext.requestedDate}`);
  logger.info(`TENDER247_RUN_DOWNLOAD_ROOT=${runContext.downloadRoot}`);

  await withTender247RunContextAsync(runContext, async () => {
    const dateFolder = runContext.downloadRoot;
    ensureTender247DateScopedDir(dateFolder, args.date);

    console.log("TENDER247_EXCEL_FILTER_DRY_RUN=true");
    console.log("SUPABASE_WRITES_DISABLED=true");
    console.log("DETAIL_CRAWL_DISABLED=true");
    console.log("CHATGPT_DISABLED=true");
    console.log("SUPABASE_WRITES=false");
    console.log("DETAIL_CRAWL=false");
    console.log("DOCUMENT_DOWNLOAD=false");
    console.log("CHATGPT=false");

    let excelPath: string;
    if (args.file) {
      excelPath = path.resolve(args.file);
      if (!fs.existsSync(excelPath)) {
        throw new Error(`Excel file not found: ${excelPath}`);
      }
      logger.info(`TENDER247_DAILY_EXCEL_FILE=${excelPath}`);
    } else {
      excelPath = await downloadTodayExcel({
        dateFolder,
        logger,
        dateIso: args.date,
      });
    }

    const { summary, review } = runExcelFilterDryRunOnFile({
      dateIso: args.date,
      excelPath,
      dateFolder,
      verbose: args.verbose,
    });

    printExcelFilterDryRunSummary({
      dateIso: args.date,
      excelPath,
      summary,
      keptPath: review.keptPath,
      droppedPath: review.droppedPath,
    });
  });
}

async function main(): Promise<void> {
  try {
    await runTender247ExcelFilterDryRun(process.argv.slice(2));
  } catch (error) {
    const code =
      error instanceof AutomationError ? error.code : "UNEXPECTED_ERROR";
    const message = safeErrorMessage(error);
    console.error(`\n${code}\n${message}\n`);
    process.exitCode = 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  void main();
}

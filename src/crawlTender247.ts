import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";
import {
  AutomationError,
  closeBrowserSession,
  launchBrowserSession,
} from "./browserUtils.js";
import {
  loadConfig,
  resolveTender247AuthPath,
  type AppConfig,
} from "./config.js";
import { formatDurationMs, getTodayIsoDate } from "./dateUtils.js";
import { downloadDirForToday, ensureDir } from "./fileUtils.js";
import { Logger, safeErrorMessage } from "./logger.js";
import { collectTodayTenderLinks } from "./tenderDetails/collectTenderLinks.js";
import {
  loginToTender247,
  persistAuthState,
} from "./tenderDetails/ensureTender247LoggedIn.js";
import { ensureTodayTendersSelected } from "./tenderDetails/ensureTodayTendersSelected.js";
import { openSingleTenderDirectly } from "./tenderDetails/openSingleTenderDirectly.js";
import { processTenderQueue } from "./tenderDetails/processTenderQueue.js";
import {
  buildCrawlReport,
  writeCrawlReport,
} from "./tenderDetails/processingReport.js";
import type { CrawlOptions, TenderListItem } from "./tenderDetails/types.js";

/** Parse --name=value or --name value from process.argv.slice(2). */
function getCliArgument(name: string): string | undefined {
  const args = process.argv.slice(2);

  const normalizedName = name.startsWith("--")
    ? name
    : `--${name}`;

  // Supports:
  // --t247-id=101466917
  for (const arg of args) {
    if (arg.startsWith(`${normalizedName}=`)) {
      const value = arg.slice(
        `${normalizedName}=`.length
      ).trim();

      return value || undefined;
    }
  }

  // Supports:
  // --t247-id 101466917
  const index = args.indexOf(normalizedName);

  if (
    index >= 0 &&
    index + 1 < args.length
  ) {
    const value = args[index + 1]?.trim();

    if (
      value &&
      !value.startsWith("--")
    ) {
      return value;
    }
  }

  return undefined;
}

function parseMaxTenders(): number | undefined {
  for (const arg of process.argv) {
    if (arg.startsWith("--max-tenders=")) {
      const n = Number.parseInt(arg.split("=")[1] ?? "", 10);
      return Number.isFinite(n) ? n : undefined;
    }
  }
  return undefined;
}

function acquireLock(lockFilePath: string): void {
  try {
    const fd = fs.openSync(lockFilePath, "wx");
    fs.writeFileSync(
      fd,
      JSON.stringify(
        { pid: process.pid, startedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    fs.closeSync(fd);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "EEXIST") {
      throw new AutomationError(
        "DUPLICATE_EXECUTION",
        `Another crawl is already running (lock: ${lockFilePath})`,
      );
    }
    throw error;
  }
}

function releaseLock(lockFilePath: string): void {
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch {
    // ignore
  }
}

async function processSingleTenderDetail(
  detailPage: Page,
  item: TenderListItem,
  context: BrowserContext,
  listPage: Page,
  dateFolder: string,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  fs.writeFileSync(
    path.join(dateFolder, "discovered-tenders.json"),
    JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        mode: "single-tender-direct",
        count: 1,
        tenders: [item],
      },
      null,
      2,
    ),
    "utf8",
  );

  const results = await processTenderQueue({
    context,
    listPage,
    items: [item],
    dateFolder,
    config,
    logger,
    preOpenedPages: new Map([
      [
        item.t247Id,
        { page: detailPage, openedVia: "popup", closeOnFinish: true },
      ],
    ]),
  });

  const discoveredListPath = path.join(dateFolder, "discovered-tenders.json");
  const dateIso = getTodayIsoDate();
  const report = buildCrawlReport({
    dateIso,
    startTime: new Date().toISOString(),
    discoveredListPath,
    tendersDiscovered: 1,
    results,
  });
  const reportPath = writeCrawlReport(dateFolder, dateIso, report, logger);

  console.log("");
  console.log("Tender247 single-tender crawl completed");
  console.log(`T247 ID: ${item.t247Id}`);
  console.log(`Success: ${report.successfulTenders}`);
  console.log(`Failed: ${report.failedTenders}`);
  console.log(`Documents: ${report.totalDocumentsDownloaded}`);
  console.log(`Corrigenda: ${report.totalCorrigendaDownloaded}`);
  console.log(`Duration: ${formatDurationMs(report.durationMs)}`);
  console.log(`Report: ${path.relative(process.cwd(), reportPath)}`);
  console.log("");

  if (report.failedTenders > 0 && report.successfulTenders === 0) {
    process.exitCode = 1;
  }
}

async function runCrawl(args: {
  requestedT247Id: string | undefined;
  singleTenderMode: boolean;
  npmCommand: string;
  maxTenders?: number;
}): Promise<void> {
  const { requestedT247Id, singleTenderMode, npmCommand, maxTenders } = args;
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "Tender247Crawl");
  const startTime = new Date().toISOString();
  const dateIso = getTodayIsoDate();
  const dateFolder = downloadDirForToday(config.downloadRoot);
  ensureDir(dateFolder);

  logger.info("=== Tender247 detail crawl started ===");
  logger.info(`CLI requestedT247Id=${requestedT247Id ?? "NONE"}`);
  logger.info(`CLI npmLifecycleEvent=${npmCommand}`);
  logger.info(`CLI singleTenderMode=${singleTenderMode}`);
  logger.info(`HEADLESS=${config.headless}`);
  logger.info(`TENDER_DETAIL_CONCURRENCY=${config.tenderDetailConcurrency}`);
  logger.info(`TENDER_DETAIL_MAX_RETRIES=${config.tenderDetailMaxRetries}`);
  logger.info(`MAX_TENDERS=${config.maxTenders}`);
  logger.info(`DOWNLOAD_ALL_DOCUMENTS_TOO=${config.downloadAllDocumentsToo}`);

  if (npmCommand === "crawl:tender247:one" && !requestedT247Id) {
    throw new AutomationError(
      "T247_ID_REQUIRED",
      "npm run crawl:tender247:one requires --t247-id=<id>. Example: npm run crawl:tender247:one -- --t247-id=101466917",
    );
  }

  if (singleTenderMode && !requestedT247Id) {
    throw new AutomationError(
      "T247_ID_REQUIRED",
      "Single-tender mode requires --t247-id=<id>",
    );
  }

  const authPath = resolveTender247AuthPath(config);
  if (!authPath) {
    throw new AutomationError(
      "TENDER247_AUTH_NOT_FOUND",
      `Missing auth/tender247.json (or auth/tender247-session.json). Run: npm run auth:tender247`,
    );
  }
  logger.info(`Using auth storage: ${path.relative(process.cwd(), authPath)}`);

  acquireLock(config.crawlLockFilePath);
  let session: Awaited<ReturnType<typeof launchBrowserSession>> | undefined;

  try {
    session = await launchBrowserSession({
      headless: config.headless,
      storageStatePath: authPath,
      downloadPath: dateFolder,
      pageTimeoutMs: config.pageTimeoutMs,
    });

    const { page, context } = session;

    // Auth only — never selects Today Tenders
    await loginToTender247(page, context, logger, config);

    // ============================================================
    // SINGLE TENDER BRANCH — must run BEFORE ensureTodayTendersSelected
    // ============================================================
    if (singleTenderMode) {
      if (!requestedT247Id) {
        throw new AutomationError("T247_ID_REQUIRED", "T247_ID_REQUIRED");
      }

      logger.info("SINGLE_TENDER_DIRECT_MODE");

      const opened = await openSingleTenderDirectly(
        page,
        context,
        requestedT247Id,
        config,
        logger,
      );

      await processSingleTenderDetail(
        opened.page,
        opened.item,
        context,
        page,
        dateFolder,
        config,
        logger,
      );

      await persistAuthState(context, config, logger);
      return;
    }

    // ============================================================
    // FULL CRAWL ONLY from here
    // ============================================================
    logger.info("FULL_TENDER_CRAWL_MODE");
    logger.info("FULL_CRAWL_CALLING_ENSURE_TODAY");
    await ensureTodayTendersSelected(page, logger, config, "full");

    let items = await collectTodayTenderLinks(page, logger, dateFolder);
    items = applyFilters(items, { onlyT247Id: undefined, maxTenders }, config, logger);

    if (items.length === 0) {
      throw new AutomationError(
        "NO_TENDERS_DISCOVERED",
        "No tenders discovered on the Fresh/Today listing",
      );
    }

    const discoveredListPath = path.join(dateFolder, "discovered-tenders.json");

    const results = await processTenderQueue({
      context,
      listPage: page,
      items,
      dateFolder,
      config,
      logger,
    });

    await persistAuthState(context, config, logger);

    const report = buildCrawlReport({
      dateIso,
      startTime,
      discoveredListPath,
      tendersDiscovered: items.length,
      results,
    });
    const reportPath = writeCrawlReport(dateFolder, dateIso, report, logger);

    console.log("");
    console.log("Tender247 crawl completed");
    console.log(`Discovered: ${report.tendersDiscovered}`);
    console.log(`Processed: ${report.tendersProcessed}`);
    console.log(`Success: ${report.successfulTenders}`);
    console.log(`Partial: ${report.partiallySuccessfulTenders}`);
    console.log(`Failed: ${report.failedTenders}`);
    console.log(`Documents: ${report.totalDocumentsDownloaded}`);
    console.log(`Corrigenda: ${report.totalCorrigendaDownloaded}`);
    console.log(`Bytes: ${report.totalBytesDownloaded}`);
    console.log(`Duration: ${formatDurationMs(report.durationMs)}`);
    console.log(`Report: ${path.relative(process.cwd(), reportPath)}`);
    console.log("");

    if (report.failedTenders > 0 && report.successfulTenders === 0) {
      process.exitCode = 1;
    }
  } finally {
    await closeBrowserSession(session);
    releaseLock(config.crawlLockFilePath);
    logger.info("Crawl browser closed; lock released");
  }
}

function applyFilters(
  items: TenderListItem[],
  cliOptions: CrawlOptions,
  config: AppConfig,
  logger: Logger,
): TenderListItem[] {
  let filtered = items;

  const max =
    cliOptions.maxTenders && Number.isFinite(cliOptions.maxTenders)
      ? cliOptions.maxTenders
      : config.maxTenders;

  if (max > 0 && filtered.length > max) {
    logger.info(`Applying MAX_TENDERS=${max}`);
    filtered = filtered.slice(0, max);
  }

  return filtered;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "Tender247Crawl");

  logger.info(
    `CLI argv=${JSON.stringify(process.argv.slice(2))}`,
  );

  // Parse CLI BEFORE all crawl logic
  const requestedT247Id = getCliArgument("t247-id");
  const npmCommand = process.env.npm_lifecycle_event ?? "";
  const singleTenderMode =
    npmCommand === "crawl:tender247:one" || Boolean(requestedT247Id);

  logger.info(`CLI requestedT247Id=${requestedT247Id ?? "NONE"}`);
  logger.info(`CLI npmLifecycleEvent=${npmCommand}`);
  logger.info(`CLI singleTenderMode=${singleTenderMode}`);

  try {
    if (
      requestedT247Id &&
      !/^\d+$/.test(requestedT247Id)
    ) {
      throw new AutomationError(
        "INVALID_T247_ID",
        `Invalid T247 ID argument`,
      );
    }

    if (npmCommand === "crawl:tender247:one" && !requestedT247Id) {
      throw new AutomationError(
        "T247_ID_REQUIRED",
        "npm run crawl:tender247:one requires --t247-id=<id>. Example: npm run crawl:tender247:one -- --t247-id=101466917",
      );
    }

    await runCrawl({
      requestedT247Id,
      singleTenderMode,
      npmCommand,
      maxTenders: parseMaxTenders(),
    });
  } catch (error) {
    const code =
      error instanceof AutomationError
        ? error.code
        : error instanceof Error && error.message === "T247_ID_REQUIRED"
          ? "T247_ID_REQUIRED"
          : error instanceof Error &&
              error.message === "BUG_SINGLE_MODE_CALLED_ENSURE_TODAY"
            ? "BUG_SINGLE_MODE_CALLED_ENSURE_TODAY"
            : "UNEXPECTED_ERROR";
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

/**
 * BidAssist crawler entry — OTP login, filters, ZIP download/extract.
 * Does not run ChatGPT qualification.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AutomationError } from "../browserUtils.js";
import { ensureDir } from "../fileUtils.js";
import { Logger, safeErrorMessage } from "../logger.js";
import {
  closeBidassistSession,
  ensureBidassistLoggedIn,
  launchBidassistPersistentSession,
  type BidassistBrowserSession,
} from "./bidassistAuth.js";
import {
  bidassistDayRoot,
  loadBidassistConfig,
  parseCliLimit,
} from "./bidassistConfig.js";
import { runBidassistCrawl } from "./bidassistCrawler.js";

export async function runBidassistCrawlerMain(): Promise<void> {
  const config = loadBidassistConfig();
  const logger = new Logger(config.logRoot, "BidAssist");
  const cliLimit = parseCliLimit(process.argv.slice(2));
  const limit = cliLimit !== null ? cliLimit : config.maxTenders;

  logger.info("=== BidAssist crawl started ===");
  logger.info(`BIDASSIST_TENDERS_URL=${config.tendersUrl}`);
  logger.info(`BIDASSIST_CATEGORY=${config.category}`);
  logger.info(`BIDASSIST_OPENING_DATE_FROM=${config.openingDateFrom}`);
  logger.info(`BIDASSIST_OPENING_DATE_TO=${config.openingDateTo ?? ""}`);
  logger.info(`MAX_BIDASSIST_TENDERS=${limit === 0 ? "ALL" : limit}`);

  const dayRoot = bidassistDayRoot(config);
  ensureDir(dayRoot);
  const tempDownloads = path.join(dayRoot, ".playwright-downloads");
  ensureDir(tempDownloads);

  let session: BidassistBrowserSession | undefined;
  try {
    session = await launchBidassistPersistentSession({
      config,
      logger,
      downloadPath: tempDownloads,
    });

    await ensureBidassistLoggedIn({
      page: session.page,
      context: session.context,
      config,
      logger,
    });

    // Stay on tenders after login
    const summary = await runBidassistCrawl({
      page: session.page,
      config,
      logger,
      limit,
    });

    console.log("");
    console.log("==================================");
    console.log("BidAssist Crawl");
    console.log(`Pages visited: ${summary.pagesVisited}`);
    console.log(`Tenders discovered: ${summary.discovered}`);
    console.log(`Unique tenders selected: ${summary.selected}`);
    console.log(`Completed: ${summary.completed}`);
    console.log(`Skipped existing: ${summary.skippedExisting}`);
    console.log(`Duplicate skipped: ${summary.duplicateSkipped}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Not downloaded: ${summary.notDownloaded}`);
    console.log(`Last page visited: ${summary.lastPageVisited}`);
    console.log("==================================");
    console.log("");

    logger.info(
      `BIDASSIST_CRAWL_SUMMARY pages=${summary.pagesVisited} discovered=${summary.discovered} selected=${summary.selected} completed=${summary.completed} skipped=${summary.skippedExisting} duplicates=${summary.duplicateSkipped} failed=${summary.failed} lastPage=${summary.lastPageVisited}`,
    );

    if (summary.failed > 0 && summary.completed === 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    const code =
      error instanceof AutomationError ? error.code : "BIDASSIST_CRAWL_FAILED";
    const message = safeErrorMessage(error);
    logger.error(`[${code}] ${message}`);
    console.error(`\n${code}\n${message}\n`);
    process.exitCode = 1;
  } finally {
    // Clean temp download dir leftovers
    try {
      if (fs.existsSync(tempDownloads)) {
        for (const name of fs.readdirSync(tempDownloads)) {
          fs.rmSync(path.join(tempDownloads, name), {
            recursive: true,
            force: true,
          });
        }
      }
    } catch {
      // ignore
    }
    await closeBidassistSession(session);
    logger.info("BIDASSIST_BROWSER_CLOSED");
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(invoked) === path.resolve(thisFile)) {
  void runBidassistCrawlerMain();
}

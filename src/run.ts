import fs from "node:fs";
import { AutomationError } from "./browserUtils.js";
import { loadConfig, type AppConfig } from "./config.js";
import { formatDurationMs } from "./dateUtils.js";
import { Logger, safeErrorMessage } from "./logger.js";
import { runBidAssist } from "./sources/bidassist.js";
import { runTender247, type SourceResult } from "./sources/tender247.js";

type SourceFilter = "all" | "tender247" | "bidassist";

function parseSourceFilter(argv: string[]): SourceFilter {
  const arg = argv.find((a) => a.startsWith("--source="));
  if (!arg) {
    return "all";
  }
  const value = arg.split("=")[1]?.toLowerCase() ?? "all";
  if (value === "tender247" || value === "bidassist") {
    return value;
  }
  return "all";
}

function acquireLock(lockFilePath: string): void {
  try {
    const fd = fs.openSync(lockFilePath, "wx");
    fs.writeFileSync(
      fd,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
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
      let details = "";
      try {
        details = fs.readFileSync(lockFilePath, "utf8");
      } catch {
        details = "(unable to read lock contents)";
      }
      throw new AutomationError(
        "DUPLICATE_EXECUTION",
        `Another automation run is already in progress (lock: ${lockFilePath}). Details: ${details}`,
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
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error(`Warning: failed to remove lock file: ${message}`);
  }
}

function printSummary(results: SourceResult[]): void {
  console.log("");
  console.log("Tender automation completed");
  console.log("");

  for (const result of results) {
    console.log(`${result.source}: ${result.status}`);
    if (result.filePath) {
      console.log(`File: ${result.filePath}`);
    }
    if (result.reason) {
      console.log(`Reason: ${result.reason}`);
    }
    console.log(`Duration: ${formatDurationMs(result.durationMs)}`);
    console.log("");
  }
}

async function executeSources(
  config: AppConfig,
  filter: SourceFilter,
  logger: Logger,
): Promise<SourceResult[]> {
  // npm run test:tender247 → always run Tender247 only
  if (filter === "tender247") {
    logger.info("Test mode: running Tender247 only");
    return [await runTender247(config)];
  }

  if (filter === "bidassist") {
    logger.info("Test mode: running BidAssist only");
    return [await runBidAssist(config)];
  }

  const results: SourceResult[] = [];

  if (config.tender247Enabled) {
    logger.info("Executing enabled source: Tender247");
    results.push(await runTender247(config));
  } else {
    logger.info("Tender247 disabled via TENDER247_ENABLED=false");
    results.push({
      source: "Tender247",
      status: "SKIPPED",
      reason: "TENDER247_DISABLED",
      durationMs: 0,
    });
  }

  if (config.bidAssistEnabled) {
    logger.info("Executing enabled source: BidAssist");
    results.push(await runBidAssist(config));
  } else {
    logger.info("BidAssist disabled via BIDASSIST_ENABLED=false");
    results.push({
      source: "BidAssist",
      status: "SKIPPED",
      reason: "BIDASSIST_NOT_CONFIGURED",
      durationMs: 0,
    });
  }

  return results;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logRoot);
  const filter = parseSourceFilter(process.argv.slice(2));
  const started = Date.now();

  logger.info("=== Tender automation runner started ===");
  logger.info(`Source filter: ${filter}`);
  logger.info(`HEADLESS=${config.headless}`);
  logger.info(`TENDER247_ENABLED=${config.tender247Enabled}`);
  logger.info(`BIDASSIST_ENABLED=${config.bidAssistEnabled}`);

  let exitCode = 0;

  try {
    acquireLock(config.lockFilePath);
    logger.info(`Lock acquired: ${config.lockFilePath}`);

    const results = await executeSources(config, filter, logger);
    printSummary(results);

    const enabledFailed = results.filter((r) => r.status === "FAILED");
    if (enabledFailed.length > 0) {
      exitCode = 1;
      logger.error(
        `Completed with failures: ${enabledFailed.map((r) => r.source).join(", ")}`,
      );
    } else {
      logger.info("All enabled sources succeeded (or were skipped intentionally)");
    }
  } catch (error) {
    exitCode = 1;
    if (error instanceof AutomationError && error.code === "DUPLICATE_EXECUTION") {
      logger.error(error.message);
      console.error(`\nDUPLICATE_EXECUTION\n${error.message}\n`);
    } else {
      logger.error(`Runner failed: ${safeErrorMessage(error)}`);
    }
  } finally {
    releaseLock(config.lockFilePath);
    logger.info("Lock released");
    logger.info(`Runner total duration: ${formatDurationMs(Date.now() - started)}`);
  }

  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});

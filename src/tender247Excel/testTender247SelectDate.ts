/**
 * Tender247 Select Mail Date smoke test.
 *
 * Opens Tender247, authenticates, opens the real calendar UI, selects --date,
 * verifies the visible input, waits briefly for human confirmation, exits.
 *
 * NO Excel / documents / Supabase / ChatGPT.
 *
 * Usage:
 *   npm run test:tender247:select-date -- --date=2026-08-11
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutomationError,
  closeBrowserSession,
  launchBrowserSession,
} from "../browserUtils.js";
import { loadConfig, resolveTender247AuthPath } from "../config.js";
import {
  formatIsoToDdMmYyyySlash,
  getTodayIsoDate,
} from "../dateUtils.js";
import { Logger, safeErrorMessage } from "../logger.js";
import {
  loginToTender247,
  persistAuthState,
} from "../tenderDetails/ensureTender247LoggedIn.js";
import { dismissTender247BlockingOverlays } from "../tenderDetails/dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "../tenderDetails/dismissSupportChat.js";
import {
  createMailDateScreenshotHook,
  readCurrentSelectMailDate,
} from "../tenderDetails/selectTender247MailDate.js";
import { ensureTender247FreshListForDate } from "../tender247Batch/ensureTender247FreshListForDate.js";

export function parseSelectDateArgs(argv: string[]): { date: string } {
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
  const fromArg = values.get("date")?.trim();
  const fromEnv = process.env.TENDER247_DATE?.trim() || process.env.DATE?.trim();
  const date = (fromArg || fromEnv || getTodayIsoDate()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid --date=${date}; expected YYYY-MM-DD`);
  }
  return { date };
}

export async function runTender247SelectDateSmokeTest(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  console.log(`SELECT_DATE_RAW_ARGV=${JSON.stringify(argv)}`);
  const args = parseSelectDateArgs(argv);
  const config = loadConfig();
  const logger = new Logger(config.logRoot, "Tender247SelectDateSmoke");

  console.log(`UNTIL_GO_CLI_DATE=${args.date}`);
  console.log(`TENDER247_REQUESTED_DATE=${args.date}`);
  logger.info(`TENDER247_REQUESTED_DATE=${args.date}`);

  const authPath = resolveTender247AuthPath(config);
  if (!authPath) {
    throw new AutomationError(
      "TENDER247_AUTH_NOT_FOUND",
      "Missing auth/tender247.json. Run: npm run auth:tender247",
    );
  }

  let session: Awaited<ReturnType<typeof launchBrowserSession>> | undefined;
  try {
    session = await launchBrowserSession({
      headless: config.headless,
      storageStatePath: authPath,
      downloadPath: path.join(config.downloadRoot, args.date),
      pageTimeoutMs: config.pageTimeoutMs,
    });
    const { page, context } = session;

    console.log(`BROWSER_BOOTSTRAP_DATE=${args.date}`);
    await loginToTender247(page, context, logger, config);
    await dismissTender247BlockingOverlays(page, logger, config);
    await dismissTender247SupportChat(page, logger);

    const screenshotDir = path.join(
      config.screenshotRoot,
      "tender247-select-date",
      args.date,
    );
    const screenshotHook = createMailDateScreenshotHook(page, screenshotDir);
    console.log(`TENDER247_MAIL_DATE_SCREENSHOT_DIR=${screenshotDir}`);

    console.log(`FRESH_PREP_DATE=${args.date}`);
    console.log(`DATE_SELECTOR_REQUESTED_DATE=${args.date}`);
    // Force real calendar click even if UI already shows the date — proves path.
    await ensureTender247FreshListForDate(
      page,
      args.date,
      logger,
      config.pageTimeoutMs,
      {
        screenshotHook,
        forceCalendarClick: true,
      },
    );

    const visible = await readCurrentSelectMailDate(page);
    const expected = formatIsoToDdMmYyyySlash(args.date);
    console.log(
      `TENDER247_VISIBLE_MAIL_DATE=${visible.inputValue || visible.iso || "null"}`,
    );
    console.log(
      `TENDER247_MAIL_DATE_INPUT_VALUE=${visible.inputValue || visible.iso || "null"}`,
    );
    logger.info(
      `TENDER247_VISIBLE_MAIL_DATE=${visible.inputValue || visible.iso || "null"}`,
    );

    if (visible.iso !== args.date) {
      console.log("TENDER247_DATE_FILTER_VERIFIED=false");
      throw new AutomationError(
        "TENDER247_DATE_FILTER_MISMATCH",
        `expected ${expected} / ${args.date}; visible=${visible.inputValue || visible.iso || "null"}`,
      );
    }

    await screenshotHook("04-before-xls");

    console.log("TENDER247_DATE_FILTER_VERIFIED=true");
    logger.info("TENDER247_DATE_FILTER_VERIFIED=true");
    console.log("TENDER247_DATE_SMOKE_TEST_SUCCESS");
    logger.info("TENDER247_DATE_SMOKE_TEST_SUCCESS");

    // Brief pause so a human can visually confirm Select Mail Date.
    await page.waitForTimeout(5_000);
    await persistAuthState(context, config, logger);
  } finally {
    await closeBrowserSession(session);
  }
}

async function main(): Promise<void> {
  try {
    await runTender247SelectDateSmokeTest(process.argv.slice(2));
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

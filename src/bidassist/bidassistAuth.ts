import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { AutomationError } from "../browserUtils.js";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import {
  type BidassistConfig,
  resolveBidassistProfilePath,
  resolveBidassistStorageStatePath,
  resolveBidassistTargetUrl,
} from "./bidassistConfig.js";
import { openBidassistTendersPage } from "./bidassistFilters.js";

export interface BidassistBrowserSession {
  context: BrowserContext;
  page: Page;
  persistent: true;
}

export async function launchBidassistPersistentSession(options: {
  config: BidassistConfig;
  logger: Logger;
  downloadPath?: string;
}): Promise<BidassistBrowserSession> {
  const { config, logger } = options;
  const profileDir = resolveBidassistProfilePath(config);
  ensureDir(profileDir);
  ensureDir(path.dirname(resolveBidassistStorageStatePath(config)));

  // OTP login requires a visible browser
  const headless = false;

  logger.info(`BIDASSIST_BROWSER_OPENED profile=${profileDir}`);

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      channel: "chrome",
      chromiumSandbox: true,
      acceptDownloads: true,
      viewport: null,
      ...(options.downloadPath
        ? { downloadsPath: options.downloadPath }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Chrome channel launch failed (${message}); falling back to Chromium`,
    );
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      chromiumSandbox: true,
      acceptDownloads: true,
      viewport: null,
      ...(options.downloadPath
        ? { downloadsPath: options.downloadPath }
        : {}),
    });
  }

  context.setDefaultTimeout(Math.max(config.pageTimeoutMs, 60_000));
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(Math.max(config.pageTimeoutMs, 60_000));

  return { context, page, persistent: true };
}

export async function closeBidassistSession(
  session: BidassistBrowserSession | undefined,
): Promise<void> {
  if (!session) {
    return;
  }
  try {
    await session.context.close();
  } catch {
    // ignore
  }
}

export async function isBidassistAuthenticated(page: Page): Promise<boolean> {
  // Login/Register absent + authenticated affordances present
  const loginVisible = await page
    .getByRole("button", { name: /sign\s*in|log\s*in|login|register/i })
    .or(page.getByRole("link", { name: /sign\s*in|log\s*in|login|register/i }))
    .first()
    .isVisible()
    .catch(() => false);

  const downloadVisible = await page
    .getByRole("button", { name: /^download$/i })
    .first()
    .isVisible()
    .catch(() => false);

  const profileVisible = await page
    .locator(
      [
        '[aria-label*="profile" i]',
        '[aria-label*="account" i]',
        '[aria-label*="notification" i]',
        'img[alt*="profile" i]',
        'button:has-text("Logout")',
        'button:has-text("Log out")',
      ].join(", "),
    )
    .first()
    .isVisible()
    .catch(() => false);

  if (downloadVisible || profileVisible) {
    return true;
  }
  // If login CTA is gone on tenders page, treat as authenticated
  if (!loginVisible) {
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    if (/indian tenders|active|download/i.test(body)) {
      return true;
    }
  }
  return false;
}

async function fillMobileAndRequestOtp(
  page: Page,
  mobileNumber: string,
  logger: Logger,
): Promise<void> {
  const mobileInput = page
    .getByPlaceholder(/mobile|phone|number/i)
    .or(page.locator('input[type="tel"]'))
    .or(page.locator('input[name*="mobile" i]'))
    .or(page.locator('input[name*="phone" i]'))
    .first();

  if (await mobileInput.isVisible().catch(() => false)) {
    await mobileInput.fill(mobileNumber);
    logger.info("BIDASSIST_MOBILE_NUMBER_FILLED");
  } else {
    logger.warn(
      "BIDASSIST_MOBILE_INPUT_NOT_FOUND — enter mobile number manually",
    );
    return;
  }

  const otpButton = page
    .getByRole("button", {
      name: /get\s*otp|send\s*otp|request\s*otp|continue|submit|verify/i,
    })
    .first();
  if (await otpButton.isVisible().catch(() => false)) {
    await otpButton.click({ timeout: 10_000 }).catch(() => undefined);
    logger.info("BIDASSIST_OTP_REQUESTED");
  }
}

/**
 * Ensure BidAssist session is authenticated.
 * First run waits for manual OTP entry in a visible browser.
 */
export async function ensureBidassistLoggedIn(options: {
  page: Page;
  context: BrowserContext;
  config: BidassistConfig;
  logger: Logger;
}): Promise<void> {
  const { page, context, config, logger } = options;

  // Authentication state is only meaningful on a real tender listing page
  await openBidassistTendersPage({ page, config, logger });

  if (await isBidassistAuthenticated(page)) {
    logger.info("BIDASSIST_EXISTING_SESSION_VALID");
    await persistBidassistStorageState(context, config, logger);
    return;
  }

  logger.info("BIDASSIST_OTP_LOGIN_REQUIRED");

  // Open login UI if a Sign In control is present
  const signIn = page
    .getByRole("button", { name: /sign\s*in|log\s*in|login/i })
    .or(page.getByRole("link", { name: /sign\s*in|log\s*in|login/i }))
    .first();
  if (await signIn.isVisible().catch(() => false)) {
    await signIn.click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
  }

  if (config.mobileNumber) {
    await fillMobileAndRequestOtp(page, config.mobileNumber, logger);
  } else {
    logger.info(
      "BIDASSIST_MOBILE_NUMBER blank — enter mobile number and OTP manually",
    );
  }

  logger.info("BIDASSIST_WAITING_FOR_MANUAL_OTP");
  console.log("");
  console.log("==================================");
  console.log("BidAssist OTP login required");
  console.log("Enter the OTP in the open browser window.");
  console.log(`Waiting up to ${Math.round(config.manualLoginTimeoutMs / 1000)}s…`);
  console.log("==================================");
  console.log("");

  const deadline = Date.now() + config.manualLoginTimeoutMs;
  while (Date.now() < deadline) {
    if (await isBidassistAuthenticated(page)) {
      logger.info("BIDASSIST_LOGIN_SUCCESS");
      await persistBidassistStorageState(context, config, logger);
      await reopenBidassistCategoryPage({ page, config, logger });
      return;
    }
    await page.waitForTimeout(2000);
  }

  throw new AutomationError(
    "BIDASSIST_LOGIN_TIMEOUT",
    `BidAssist OTP login not completed within ${config.manualLoginTimeoutMs}ms`,
  );
}

export async function persistBidassistStorageState(
  context: BrowserContext,
  config: BidassistConfig,
  logger: Logger,
): Promise<void> {
  const storagePath = resolveBidassistStorageStatePath(config);
  ensureDir(path.dirname(storagePath));
  await context.storageState({ path: storagePath });
  logger.info("BIDASSIST_STORAGE_STATE_SAVED");
  if (fs.existsSync(storagePath)) {
    logger.info(`BIDASSIST_STORAGE_STATE_PATH=${storagePath}`);
  }
}

/** Return to the filtered category route once the OTP login completes. */
async function reopenBidassistCategoryPage(options: {
  page: Page;
  config: BidassistConfig;
  logger: Logger;
}): Promise<void> {
  const { page, config, logger } = options;
  const targetUrl = resolveBidassistTargetUrl(config);
  if (page.url().startsWith(targetUrl)) {
    logger.info("BIDASSIST_CATEGORY_PAGE_REOPENED");
    return;
  }
  await openBidassistTendersPage({ page, config, logger });
  logger.info("BIDASSIST_CATEGORY_PAGE_REOPENED");
}

/** Standalone auth entry: open browser, wait for OTP, save session, exit. */
export async function runBidassistAuthOnly(): Promise<void> {
  const { loadBidassistConfig } = await import("./bidassistConfig.js");
  const { Logger, safeErrorMessage } = await import("../logger.js");
  const config = loadBidassistConfig();
  const logger = new Logger(config.logRoot, "BidAssistAuth");
  let session: BidassistBrowserSession | undefined;
  try {
    session = await launchBidassistPersistentSession({ config, logger });
    await ensureBidassistLoggedIn({
      page: session.page,
      context: session.context,
      config,
      logger,
    });
    logger.info("BIDASSIST_AUTH_COMPLETE");
  } catch (error) {
    logger.error(safeErrorMessage(error));
    process.exitCode = 1;
  } finally {
    await session?.page.waitForTimeout(1500).catch(() => undefined);
    await closeBidassistSession(session);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && path.resolve(thisFile) === path.resolve(invoked)) {
  void runBidassistAuthOnly();
}

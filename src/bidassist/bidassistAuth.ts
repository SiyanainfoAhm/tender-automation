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
  releaseProfileLock: () => void;
}

function acquireBidassistProfileLock(profileDir: string): () => void {
  const lockPath = path.join(profileDir, ".bidassist-browser.lock");
  const token = `${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(lockPath, token, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const owner = fs.readFileSync(lockPath, "utf8").trim() || "another process";
      throw new AutomationError(
        "BIDASSIST_SESSION_ALREADY_RUNNING",
        `BidAssist browser profile is already in use (${owner}). Wait for that run to finish before starting another.`,
      );
    }
    throw error;
  }

  return () => {
    try {
      if (fs.readFileSync(lockPath, "utf8").trim() === token) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // The lock is best-effort cleanup; never hide a browser-close error.
    }
  };
}

export async function launchBidassistPersistentSession(options: {
  config: BidassistConfig;
  logger: Logger;
  downloadPath?: string;
}): Promise<BidassistBrowserSession> {
  const { config, logger } = options;
  // Keep Playwright downloads in a persistent controlled folder. This prevents
  // a page/navigation race from deleting a completed BidAssist download before
  // the result agent can save and extract it.
  const downloadPath = options.downloadPath || path.resolve(config.downloadRoot, "bidassist-playwright-downloads");
  const profileDir = resolveBidassistProfilePath(config);
  ensureDir(profileDir);
  ensureDir(path.dirname(resolveBidassistStorageStatePath(config)));
  const releaseProfileLock = acquireBidassistProfileLock(profileDir);

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
      downloadsPath: downloadPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/profile is already in use|opening in existing browser session/i.test(message)) {
      releaseProfileLock();
      throw new AutomationError(
        "BIDASSIST_PROFILE_IN_USE",
        "The BidAssist Chrome profile is already open. Close the other BidAssist browser/run, then retry.",
      );
    }
    logger.warn(
      `Chrome channel launch failed (${message}); falling back to Chromium`,
    );
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        headless,
        chromiumSandbox: true,
        acceptDownloads: true,
        viewport: null,
        downloadsPath: downloadPath,
      });
    } catch (fallbackError) {
      releaseProfileLock();
      throw fallbackError;
    }
  }

  context.setDefaultTimeout(Math.max(config.pageTimeoutMs, 60_000));
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(Math.max(config.pageTimeoutMs, 60_000));

  return { context, page, persistent: true, releaseProfileLock };
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
  } finally {
    session.releaseProfileLock();
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

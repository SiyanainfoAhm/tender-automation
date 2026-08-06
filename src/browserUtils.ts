import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { getLocalTimestamp } from "./dateUtils.js";
import {
  ensureDir,
  screenshotDirForToday,
} from "./fileUtils.js";
import type { Logger } from "./logger.js";

export interface LaunchOptions {
  headless: boolean;
  storageStatePath?: string;
  /**
   * Destination used for Playwright Chromium downloadsPath.
   * Must NOT be the daily tender output root — use a .playwright-downloads subdir.
   */
  downloadPath: string;
  pageTimeoutMs: number;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function launchBrowserSession(
  options: LaunchOptions,
): Promise<BrowserSession> {
  ensureDir(options.downloadPath);

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: options.headless,
      downloadsPath: options.downloadPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AutomationError(
      "BROWSER_LAUNCH_FAILED",
      `Failed to launch Chromium: ${message}`,
    );
  }

  const context = await browser.newContext({
    acceptDownloads: true,
    ...(options.storageStatePath
      ? { storageState: options.storageStatePath }
      : {}),
  });

  context.setDefaultTimeout(options.pageTimeoutMs);
  const page = await context.newPage();
  page.setDefaultTimeout(options.pageTimeoutMs);

  return { browser, context, page };
}

export async function closeBrowserSession(
  session: BrowserSession | undefined,
): Promise<void> {
  if (!session) {
    return;
  }
  try {
    await session.context.close();
  } catch {
    // context may already be closed
  }
  try {
    await session.browser.close();
  } catch {
    // browser may already be closed
  }
}

export async function captureErrorScreenshot(
  page: Page | undefined,
  screenshotRoot: string,
  sourceName: string,
  errorCode: string,
  logger: Logger,
): Promise<string | undefined> {
  if (!page || page.isClosed()) {
    logger.warn("Screenshot skipped: page is unavailable");
    return undefined;
  }

  const dir = screenshotDirForToday(screenshotRoot);
  ensureDir(dir);
  const fileName = `${sourceName}_${errorCode}_${getLocalTimestamp()}.png`;
  const filePath = path.join(dir, fileName);

  try {
    await page.screenshot({ path: filePath, fullPage: true });
    logger.info(`Screenshot saved: ${path.relative(process.cwd(), filePath)}`);
    return filePath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to capture screenshot: ${message}`);
    return undefined;
  }
}

export class AutomationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AutomationError";
    this.code = code;
  }
}

export function isLoginUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("/login") ||
    lower.includes("/signin") ||
    lower.includes("/sign-in") ||
    lower.includes("/auth/login") ||
    (lower.includes("tender247.com") &&
      !lower.includes("/auth/tender") &&
      (lower.includes("login") || lower.includes("signin")))
  );
}

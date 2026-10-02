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
   * Chrome user-data directory for a human-style, persistent session. When it
   * is supplied, the browser uses this profile instead of an ephemeral
   * storageState-only context.
   */
  profileDir?: string;
  /**
   * Destination used for Playwright Chromium downloadsPath.
   * Must NOT be the daily tender output root — use a .playwright-downloads subdir.
   */
  downloadPath: string;
  pageTimeoutMs: number;
}

export interface BrowserSession {
  /** Undefined for a persistent context, which owns its browser lifecycle. */
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  persistent: boolean;
}

export async function launchBrowserSession(
  options: LaunchOptions,
): Promise<BrowserSession> {
  ensureDir(options.downloadPath);

  if (options.profileDir) {
    ensureDir(options.profileDir);
    let context: BrowserContext;
    try {
      // Use installed Chrome and a dedicated profile. This keeps the same
      // cookies, local storage, and browser UI state that a manual Tender247
      // session uses instead of recreating an anonymous automation context.
      context = await chromium.launchPersistentContext(options.profileDir, {
        headless: false,
        channel: "chrome",
        chromiumSandbox: true,
        acceptDownloads: true,
        viewport: null,
        downloadsPath: options.downloadPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        context = await chromium.launchPersistentContext(options.profileDir, {
          headless: false,
          chromiumSandbox: true,
          acceptDownloads: true,
          viewport: null,
          downloadsPath: options.downloadPath,
        });
      } catch {
        throw new AutomationError(
          "BROWSER_LAUNCH_FAILED",
          `Failed to launch persistent Tender247 browser: ${message}`,
        );
      }
    }

    context.setDefaultTimeout(options.pageTimeoutMs);
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(options.pageTimeoutMs);
    return { context, page, persistent: true };
  }

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

  return { browser, context, page, persistent: false };
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
  if (session.browser) {
    try {
      await session.browser.close();
    } catch {
      // browser may already be closed
    }
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

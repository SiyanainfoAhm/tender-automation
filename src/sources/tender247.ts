import fs from "node:fs";
import path from "node:path";
import type { Download, Locator, Page } from "playwright";
import {
  AutomationError,
  captureErrorScreenshot,
  closeBrowserSession,
  launchBrowserSession,
  type BrowserSession,
} from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import { formatDurationMs, getLocalDateParts, getTodayIsoDate } from "../dateUtils.js";
import {
  downloadDirForToday,
  ensureDir,
  getFileSizeBytes,
  isSpreadsheetExtension,
  relocateFile,
  uniqueDestinationPath,
} from "../fileUtils.js";
import { Logger, safeErrorMessage } from "../logger.js";
import {
  dismissTender247BlockingOverlays,
  registerPromotionalPopupHandlers,
} from "../tenderDetails/dismissPromotionalPopups.js";

/** Straight apostrophe and curly apostrophe (U+2019) variants */
const DONT_SHOW_AGAIN_STRAIGHT = "Don't show again";
const DONT_SHOW_AGAIN_CURLY = "Don\u2019t show again";
const B2B_POPUP_HEADING = "Tender247 B2B Marketplace";

/**
 * Centralized Tender247 locators.
 *
 * Prefer role/text/title/alt over generated CSS class names.
 * The XLS control is expected near the "PRICE: HIGH TO LOW" sort dropdown.
 * Exact XLS DOM attributes still require live-page confirmation — see
 * dumpLocatorDebug() when XLS_NOT_FOUND is raised.
 */
const selectors = {
  /** Optional B2B Marketplace promotional popup heading */
  b2bPopupHeading: (page: Page): Locator =>
    page.getByText(B2B_POPUP_HEADING, { exact: true }),

  /**
   * Popup container scoped by the B2B heading.
   * Used to find close controls without touching CAPTCHA inputs.
   */
  b2bPopupRoot: (page: Page): Locator => {
    const heading = selectors.b2bPopupHeading(page);
    return page
      .locator(
        '[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="popup" i], [class*="overlay" i]',
      )
      .filter({ has: heading })
      .or(heading.locator("xpath=ancestor::*[self::div or self::section or self::aside][1]"))
      .first();
  },

  /** “Don’t show again” link — straight and curly apostrophe */
  dontShowAgain: (page: Page): Locator => {
    const root = selectors.b2bPopupRoot(page);
    return root
      .getByRole("link", { name: /Don['\u2019]t show again/i })
      .or(root.getByRole("button", { name: /Don['\u2019]t show again/i }))
      .or(root.getByText(DONT_SHOW_AGAIN_STRAIGHT, { exact: true }))
      .or(root.getByText(DONT_SHOW_AGAIN_CURLY, { exact: true }))
      .or(page.getByRole("link", { name: /Don['\u2019]t show again/i }))
      .or(page.getByText(DONT_SHOW_AGAIN_STRAIGHT, { exact: true }))
      .or(page.getByText(DONT_SHOW_AGAIN_CURLY, { exact: true }))
      .first();
  },

  /** Close (X) control inside the B2B popup — never CAPTCHA fields */
  b2bPopupClose: (page: Page): Locator => {
    const root = selectors.b2bPopupRoot(page);
    return root
      .getByRole("button", { name: /close|dismiss|×|✕|ｘ/i })
      .or(
        root.locator(
          'button[aria-label*="close" i], button[title*="close" i], [aria-label*="close" i][role="button"], [title*="close" i]',
        ),
      )
      .or(root.locator('button:has(svg), [class*="close" i][role="button"], [class*="close" i]'))
      .first();
  },

  /** Highlighted “Today Tenders” summary card */
  todayTendersCard: (page: Page): Locator =>
    page.getByText(/Today\s+Tenders/i).first(),

  /** Collapsible filters section header */
  tenderFiltersHeader: (page: Page): Locator =>
    page
      .getByText("Tender Filters", { exact: true })
      .or(page.getByText("FILTERS", { exact: true }))
      .or(page.getByRole("button", { name: /tender\s*filters|filters/i }))
      .first(),

  /** At least one tender result card marker */
  t247Id: (page: Page): Locator => page.getByText(/T247\s*ID/i),

  /** Obvious page-level loading indicators (not individual card skeletons) */
  loadingIndicator: (page: Page): Locator =>
    page
      .getByText(/^LOADING\.{0,3}$/i)
      .or(page.locator('[aria-busy="true"]'))
      .or(page.locator('.loading, .spinner, [class*="loading" i][class*="overlay" i]'))
      .first(),

  /** Date-range field that opens the calendar shortcuts panel */
  dateField: (page: Page): Locator =>
    page
      .getByPlaceholder(/date|select date|dd|mm|yyyy|start|end/i)
      .or(page.getByLabel(/date|tender date|due date|published|period/i))
      .or(page.getByRole("textbox", { name: /date|period|range/i }))
      .or(page.getByRole("button", { name: /date|period|range|calendar/i }))
      .or(
        page.locator(
          'input[placeholder*="Date" i], input[name*="date" i], [data-testid*="date" i], .ant-picker, [class*="date-picker" i], [class*="datepicker" i]',
        ),
      )
      .first(),

  /** Calendar shortcut labeled exactly "Today" */
  todayOption: (page: Page): Locator =>
    page.getByText("Today", { exact: true }).first(),

  /** Primary search action */
  searchButton: (page: Page): Locator =>
    page
      .getByRole("button", { name: /^SEARCH$/i })
      .or(page.getByText("SEARCH", { exact: true }))
      .first(),

  /** Sort control used as an anchor for nearby XLS export */
  priceSort: (page: Page): Locator =>
    page.getByText(/PRICE:\s*HIGH\s*TO\s*LOW/i).first(),

  /**
   * XLS download control near the price sort dropdown.
   * Candidates use accessible name, title, alt, and href patterns.
   * NEEDS LIVE CONFIRMATION against authenticated Tender247 page.
   */
  xlsButton: (page: Page): Locator => {
    const byRole = page.getByRole("button", {
      name: /xls|xlsx|excel|export|download/i,
    });
    const byLink = page.getByRole("link", {
      name: /xls|xlsx|excel|export|download/i,
    });
    const byTitle = page.locator(
      '[title*="XLS" i], [title*="Excel" i], [title*="Download" i], [aria-label*="XLS" i], [aria-label*="Excel" i], [aria-label*="Download" i]',
    );
    const byAlt = page.locator(
      'img[alt*="XLS" i], img[alt*="Excel" i], img[alt*="Download" i]',
    );
    const byHref = page.locator(
      'a[href*="xls" i], a[href*="excel" i], a[href*="export" i], button[data-export*="xls" i]',
    );
    return byRole.or(byLink).or(byTitle).or(byAlt).or(byHref).first();
  },

  /** All XLS-like export controls (for counting, not clicking) */
  xlsCandidates: (page: Page): Locator =>
    page
      .getByRole("button", { name: /xls|xlsx|excel|export/i })
      .or(page.getByRole("link", { name: /xls|xlsx|excel|export/i }))
      .or(
        page.locator(
          '[title*="XLS" i], [title*="Excel" i], [aria-label*="XLS" i], [aria-label*="Excel" i], img[alt*="XLS" i], img[alt*="Excel" i], a[href*="xls" i], a[href*="excel" i]',
        ),
      ),

  /**
   * Real login-form fields only.
   * Do NOT use header "Log in" text/button — Tender247 shows that even when authenticated.
   */
  loginUsernameField: (page: Page): Locator =>
    page
      .locator(
        'form input[type="email"], form input[name*="email" i], form input[name*="user" i], form input[id*="email" i], form input[id*="user" i], form input[autocomplete="username"], form input[autocomplete="email"]',
      )
      .or(
        page.getByRole("textbox", {
          name: /^(email|username|user\s*name|mobile|phone)$/i,
        }),
      )
      .first(),

  loginPasswordField: (page: Page): Locator =>
    page
      .locator(
        'form input[type="password"], form input[name*="password" i], form input[id*="password" i], form input[autocomplete="current-password"]',
      )
      .first(),
};

export interface SourceResult {
  source: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  filePath?: string;
  reason?: string;
  durationMs: number;
}

/**
 * Dismiss Tender247 promotional popups (B2B Marketplace + Free Sample).
 * Delegates to shared dismissTender247BlockingOverlays.
 */
export async function dismissTender247Popups(
  page: Page,
  logger: Logger,
  config?: AppConfig,
): Promise<void> {
  await dismissTender247BlockingOverlays(page, logger, config);
}

async function registerB2bPopupHandler(page: Page, logger: Logger): Promise<void> {
  // B2B locator handler disabled — explicit dismissB2BMarketplacePopup only
  await registerPromotionalPopupHandlers(page, logger);
}

export async function runTender247(config: AppConfig): Promise<SourceResult> {
  const started = Date.now();
  const logger = new Logger(config.logRoot, "Tender247");
  const maxAttempts = Math.max(1, config.maxRetries + 1);
  let lastResult: SourceResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      logger.warn(`Retrying Tender247 (attempt ${attempt}/${maxAttempts})`);
    }
    lastResult = await runTender247Once(config, logger, started);
    if (lastResult.status === "SUCCESS") {
      return lastResult;
    }
    // Do not retry auth/config / popup-hard-fail problems
    const reason = lastResult.reason ?? "";
    if (
      reason.includes("TENDER247_AUTH_NOT_FOUND") ||
      reason.includes("TENDER247_LOGIN_REQUIRED") ||
      reason.includes("TENDER247_POPUP_DISMISS_FAILED") ||
      reason.includes("TENDER247_PROMOTIONAL_POPUP_DISMISS_FAILED") ||
      reason.includes("DUPLICATE_EXECUTION")
    ) {
      break;
    }
  }

  return (
    lastResult ?? {
      source: "Tender247",
      status: "FAILED",
      reason: "UNEXPECTED_ERROR: no result",
      durationMs: Date.now() - started,
    }
  );
}

async function runTender247Once(
  config: AppConfig,
  logger: Logger,
  started: number,
): Promise<SourceResult> {
  let session: BrowserSession | undefined;

  logger.info("=== Tender247 download started ===");
  logger.info(`Browser mode: ${config.headless ? "headless" : "visible"}`);
  logger.info(`Page URL: ${config.tender247Url}`);

  try {
    if (!fs.existsSync(config.tender247AuthPath)) {
      throw new AutomationError(
        "TENDER247_AUTH_NOT_FOUND",
        `Authentication file not found at ${config.tender247AuthPath}. Run: npm run auth:tender247`,
      );
    }
    logger.info("Authentication status: storageState file present");

    const dayDir = downloadDirForToday(config.downloadRoot);
    ensureDir(dayDir);

    session = await launchBrowserSession({
      headless: config.headless,
      storageStatePath: config.tender247AuthPath,
      downloadPath: dayDir,
      pageTimeoutMs: config.pageTimeoutMs,
    });

    const { page, context } = session;

    await registerB2bPopupHandler(page, logger);

    await page.goto(config.tender247Url, {
      waitUntil: "domcontentloaded",
      timeout: config.pageTimeoutMs,
    });
    await page.waitForLoadState("networkidle", { timeout: config.pageTimeoutMs }).catch(() => {
      logger.warn("networkidle wait timed out; continuing with DOM readiness checks");
    });
    logger.info("Page opened");

    await dismissTender247Popups(page, logger, config);
    await assertAuthenticated(page, config.tender247Url, logger);

    await waitForTenderPageSettle(page, logger, config.pageTimeoutMs);

    if (await areTodayResultsLoaded(page)) {
      logger.info("TENDER247_TODAY_RESULTS_ALREADY_LOADED");
      logger.info(
        "Skipping Tender Filters / Today / SEARCH — proceeding directly to XLS download",
      );
    } else {
      logger.info(
        "Today's results not ready; applying Tender Filters date fallback",
      );
      await applyTodayFilterFallback(page, logger, config.pageTimeoutMs);
    }

    const savedPath = await downloadExcel(page, config, dayDir, logger);

    // Persist “Don’t show again” / session cookies for future runs
    await context.storageState({ path: config.tender247AuthPath });
    logger.info(
      `Updated storage state saved to ${path.relative(process.cwd(), config.tender247AuthPath)}`,
    );

    const durationMs = Date.now() - started;
    logger.info(`Completion time: ${new Date().toISOString()}`);
    logger.info(`Total execution duration: ${formatDurationMs(durationMs)}`);
    logger.info("=== Tender247 download completed successfully ===");

    return {
      source: "Tender247",
      status: "SUCCESS",
      filePath: path.relative(process.cwd(), savedPath),
      durationMs,
    };
  } catch (error) {
    const code =
      error instanceof AutomationError ? error.code : classifyGenericError(error);
    const message = safeErrorMessage(error);
    logger.error(`Failure reason [${code}]: ${message}`);

    if (session?.page) {
      await captureErrorScreenshot(
        session.page,
        config.screenshotRoot,
        "Tender247",
        code,
        logger,
      );
    }

    const durationMs = Date.now() - started;
    logger.info(`Total execution duration: ${formatDurationMs(durationMs)}`);

    return {
      source: "Tender247",
      status: "FAILED",
      reason: `${code}: ${message}`,
      durationMs,
    };
  } finally {
    await closeBrowserSession(session);
  }
}

export async function assertAuthenticated(
  page: Page,
  expectedUrl: string,
  logger: Logger,
): Promise<void> {
  // Header "Log in" is present on authenticated tender pages — never treat it as session expiry.
  logger.info(
    "Header 'Log in' control (if present) is explicitly ignored for authentication checks",
  );

  const currentUrl = page.url();
  const pageTitle = await page.title().catch(() => "(unavailable)");

  const filtersVisible = await page
    .getByText("FILTERS", { exact: true })
    .first()
    .isVisible()
    .catch(() => false);

  const t247IdVisible = await page
    .getByText(/T247\s*ID/i)
    .first()
    .isVisible()
    .catch(() => false);

  const searchAllVisible = await page
    .getByText("Search All", { exact: true })
    .first()
    .isVisible()
    .catch(() => false);

  const indianTenderVisible = await page
    .getByText("Indian Tender", { exact: true })
    .first()
    .isVisible()
    .catch(() => false);

  const xlsElementCount = await selectors
    .xlsCandidates(page)
    .count()
    .catch(() => 0);
  const xlsVisible = xlsElementCount > 0;

  const urlOnTenderPage = currentUrl.includes("/auth/tender");

  const usernameVisible = await selectors
    .loginUsernameField(page)
    .isVisible()
    .catch(() => false);
  const passwordVisible = await selectors
    .loginPasswordField(page)
    .isVisible()
    .catch(() => false);
  const realLoginFormVisible = usernameVisible && passwordVisible;

  const markerFlags = [
    filtersVisible,
    t247IdVisible,
    searchAllVisible,
    indianTenderVisible,
    xlsVisible,
    urlOnTenderPage,
  ];
  const markerCount = markerFlags.filter(Boolean).length;
  const tenderPageLoaded = markerCount >= 2;

  const dedicatedLoginRoute = isDedicatedLoginRoute(currentUrl);

  logger.info(`Auth diagnostics: current URL=${currentUrl}`);
  logger.info(`Auth diagnostics: page title=${pageTitle}`);
  logger.info(`Auth diagnostics: FILTERS visible=${filtersVisible}`);
  logger.info(`Auth diagnostics: T247 ID visible=${t247IdVisible}`);
  logger.info(`Auth diagnostics: Search All visible=${searchAllVisible}`);
  logger.info(`Auth diagnostics: Indian Tender visible=${indianTenderVisible}`);
  logger.info(`Auth diagnostics: XLS element count=${xlsElementCount}`);
  logger.info(`Auth diagnostics: URL contains /auth/tender=${urlOnTenderPage}`);
  logger.info(`Auth diagnostics: Actual username field visible=${usernameVisible}`);
  logger.info(`Auth diagnostics: Actual password field visible=${passwordVisible}`);
  logger.info(
    `Auth diagnostics: tender markers matched=${markerCount}/6 (need >= 2)`,
  );

  if (tenderPageLoaded) {
    logger.info(
      "Final authentication decision: AUTHENTICATED (tender-page markers present; header Log in ignored)",
    );
    logger.info("Authentication status: session appears valid for tender page");
    return;
  }

  // Only require re-login when tender markers are absent AND (login route OR real form)
  if ((dedicatedLoginRoute || realLoginFormVisible) && !tenderPageLoaded) {
    logger.info(
      "Final authentication decision: TENDER247_LOGIN_REQUIRED (no tender markers; login route or real login form detected)",
    );
    throw new AutomationError(
      "TENDER247_LOGIN_REQUIRED",
      dedicatedLoginRoute
        ? `Redirected to login page: ${currentUrl}. Re-run: npm run auth:tender247`
        : "Real login form (username/email + password) is visible and tender-page markers are absent. Re-run: npm run auth:tender247",
    );
  }

  logger.info(
    `Final authentication decision: CONTINUE (markers=${markerCount}; expectedUrl=${expectedUrl}; not treating as login required)`,
  );
  logger.info("Authentication status: proceeding without LOGIN_REQUIRED");
}

/** Dedicated login/sign-in routes only — never /auth/tender. */
function isDedicatedLoginRoute(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.includes("/auth/tender")) {
      return false;
    }
    return (
      /\/login\/?$/.test(path) ||
      /\/signin\/?$/.test(path) ||
      /\/sign-in\/?$/.test(path) ||
      /\/auth\/login\/?$/.test(path) ||
      path === "/login" ||
      path === "/signin" ||
      path === "/sign-in"
    );
  } catch {
    const lower = url.toLowerCase();
    if (lower.includes("/auth/tender")) {
      return false;
    }
    return (
      lower.includes("/login") ||
      lower.includes("/signin") ||
      lower.includes("/sign-in")
    );
  }
}

async function waitForTenderPageSettle(
  page: Page,
  logger: Logger,
  pageTimeoutMs: number,
): Promise<void> {
  logger.info("Waiting for tender page content to finish loading");

  // Prefer content markers over a fixed sleep; networkidle is secondary.
  await Promise.race([
    selectors.todayTendersCard(page).waitFor({ state: "visible", timeout: pageTimeoutMs }),
    selectors.t247Id(page).first().waitFor({ state: "visible", timeout: pageTimeoutMs }),
    selectors.priceSort(page).waitFor({ state: "visible", timeout: pageTimeoutMs }),
  ]).catch(() => {
    logger.warn("Primary tender content markers soft-timed out; continuing checks");
  });

  await page.waitForLoadState("networkidle", { timeout: Math.min(pageTimeoutMs, 30_000) }).catch(() => {
    logger.warn("networkidle settle timed out after content wait");
  });

  // Wait until a page-level LOADING overlay (if any) is gone
  const loading = selectors.loadingIndicator(page);
  if (await loading.isVisible().catch(() => false)) {
    await loading.waitFor({ state: "hidden", timeout: pageTimeoutMs }).catch(() => {
      logger.warn("Loading indicator still present after wait; continuing");
    });
  }
}

/**
 * Detect whether Tender247 already shows today's tenders (default landing state).
 * One visible T247 ID card + XLS is enough — do not wait for every card.
 */
export async function areTodayResultsLoaded(page: Page): Promise<boolean> {
  const todayTendersVisible = await selectors
    .todayTendersCard(page)
    .isVisible()
    .catch(() => false);

  const t247Count = await selectors.t247Id(page).count().catch(() => 0);
  const t247Visible =
    t247Count > 0 &&
    (await selectors
      .t247Id(page)
      .first()
      .isVisible()
      .catch(() => false));

  let xlsVisible = false;
  try {
    const xls = await getTender247XlsLocator(page);
    xlsVisible = await xls.isVisible().catch(() => false);
  } catch {
    xlsVisible = await selectors
      .xlsCandidates(page)
      .first()
      .isVisible()
      .catch(() => false);
  }

  const loadingVisible = await selectors
    .loadingIndicator(page)
    .isVisible()
    .catch(() => false);

  // Optional: today's local date shown in/near the Today Tenders card
  const optionalDateOk = await isOptionalTodayDateNearCard(page);

  if (!todayTendersVisible || !t247Visible || !xlsVisible || loadingVisible) {
    return false;
  }

  // optionalDateOk does not block success when other required markers pass
  void optionalDateOk;
  return true;
}

async function isOptionalTodayDateNearCard(page: Page): Promise<boolean> {
  const card = selectors.todayTendersCard(page);
  if (!(await card.isVisible().catch(() => false))) {
    return false;
  }

  const variants = getLocalDateDisplayVariants();
  const scope = card.locator(
    "xpath=ancestor::*[self::div or self::section or self::article][1]",
  );

  for (const variant of variants) {
    const hit = scope.getByText(variant, { exact: false });
    if (await hit.first().isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

/** Common local-date string forms that may appear in the Today Tenders card. */
function getLocalDateDisplayVariants(date: Date = new Date()): string[] {
  const { year, month, day } = getLocalDateParts(date);
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ] as const;
  const monthName = monthNames[Number(month) - 1] ?? month;
  const dayNum = String(Number(day));
  const monthNum = String(Number(month));

  return [
    `${day}-${month}-${year}`,
    `${month}-${day}-${year}`,
    `${day}/${month}/${year}`,
    `${month}/${day}/${year}`,
    `${year}-${month}-${day}`,
    `${dayNum} ${monthName} ${year}`,
    `${monthName} ${dayNum}, ${year}`,
    `${dayNum}-${monthName}-${year}`,
    `${dayNum}/${monthNum}/${year}`,
    `${monthNum}/${dayNum}/${year}`,
  ];
}

async function applyTodayFilterFallback(
  page: Page,
  logger: Logger,
  pageTimeoutMs: number,
): Promise<void> {
  await dismissTender247Popups(page, logger);
  await expandTenderFiltersIfCollapsed(page, logger);

  const dateField = selectors.dateField(page);
  try {
    await dateField.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    throw new AutomationError(
      "DATE_FIELD_NOT_FOUND",
      "Could not find the tender date-range field",
    );
  }

  await dateField.click();
  logger.info("Date-range field opened");

  const today = selectors.todayOption(page);
  try {
    await today.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    throw new AutomationError(
      "TODAY_OPTION_NOT_FOUND",
      'Visible option "Today" was not found in the date picker',
    );
  }

  await today.click();
  logger.info('Today filter selected (GeM / Non-GeM left as "All")');

  await dismissTender247Popups(page, logger);

  const searchButton = selectors.searchButton(page);
  try {
    await searchButton.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    throw new AutomationError(
      "SEARCH_BUTTON_NOT_FOUND",
      'Could not find the visible "SEARCH" button',
    );
  }

  const responsePromise = page
    .waitForResponse(
      (response) => {
        const url = response.url().toLowerCase();
        return (
          response.request().method() !== "OPTIONS" &&
          (url.includes("tender") || url.includes("search") || url.includes("filter")) &&
          response.status() < 500
        );
      },
      { timeout: pageTimeoutMs },
    )
    .catch(() => undefined);

  await searchButton.click();
  logger.info("Search clicked");

  await responsePromise;
  await page.waitForLoadState("networkidle", { timeout: pageTimeoutMs }).catch(() => {
    logger.warn("Post-search networkidle timed out; checking UI readiness");
  });

  try {
    await selectors.t247Id(page).first().waitFor({ state: "visible", timeout: pageTimeoutMs });
  } catch {
    throw new AutomationError(
      "TENDER_RESULTS_NOT_FOUND",
      "No tender result cards containing T247 ID appeared after SEARCH",
    );
  }

  const xls = await getTender247XlsLocator(page);
  await xls.waitFor({ state: "visible", timeout: pageTimeoutMs });
  logger.info("Tender results and XLS control ready after filter fallback");
}

async function expandTenderFiltersIfCollapsed(
  page: Page,
  logger: Logger,
): Promise<void> {
  const dateField = selectors.dateField(page);
  if (await dateField.isVisible().catch(() => false)) {
    logger.info("Tender Filters already expanded (date field visible)");
    return;
  }

  const header = selectors.tenderFiltersHeader(page);
  if (await header.isVisible().catch(() => false)) {
    await header.click();
    logger.info("Expanded Tender Filters section");
    await dateField.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
      logger.warn("Date field still not visible after expanding Tender Filters");
    });
    return;
  }

  logger.warn("Tender Filters header not found; attempting date field directly");
}

async function downloadExcel(
  page: Page,
  config: AppConfig,
  dayDir: string,
  logger: Logger,
): Promise<string> {
  await dismissTender247Popups(page, logger);

  let xlsLocator: Locator;
  try {
    xlsLocator = await getTender247XlsLocator(page);
  } catch (error) {
    await dumpXlsLocatorDiagnostics(page, logger);
    throw error instanceof AutomationError
      ? error
      : new AutomationError(
          "TENDER247_XLS_NOT_FOUND",
          "XLS download icon was not found near PRICE: HIGH TO LOW",
        );
  }

  await xlsLocator.waitFor({ state: "visible", timeout: 30_000 });
  const enabled = await xlsLocator.isEnabled().catch(() => true);
  if (!enabled) {
    throw new AutomationError(
      "TENDER247_XLS_NOT_FOUND",
      "XLS download control is visible but not enabled",
    );
  }

  const downloadPromise = page.waitForEvent("download", {
    timeout: config.downloadTimeoutMs,
  });

  await xlsLocator.click();
  logger.info("XLS clicked");

  let download: Download;
  try {
    download = await downloadPromise;
  } catch {
    throw new AutomationError(
      "DOWNLOAD_DID_NOT_START",
      "No download event occurred after clicking the XLS control",
    );
  }

  const originalName = download.suggestedFilename();
  logger.info(`Original downloaded filename: ${originalName}`);

  if (!isSpreadsheetExtension(originalName)) {
    throw new AutomationError(
      "DOWNLOAD_INVALID_EXTENSION",
      `Downloaded file is not .xls/.xlsx: ${originalName}`,
    );
  }

  const tempPath = path.join(dayDir, `.__tmp_${Date.now()}_${originalName}`);
  await download.saveAs(tempPath);

  if (!fs.existsSync(tempPath)) {
    throw new AutomationError(
      "DOWNLOAD_FILE_MISSING",
      "Download event completed but saved file is missing",
    );
  }

  const size = getFileSizeBytes(tempPath);
  if (size <= 0) {
    fs.unlinkSync(tempPath);
    throw new AutomationError(
      "DOWNLOAD_FILE_EMPTY",
      "Downloaded spreadsheet is empty (0 bytes)",
    );
  }

  const today = getTodayIsoDate();
  const destination = uniqueDestinationPath(dayDir, `Tender247_${today}`, ".xlsx");
  relocateFile(tempPath, destination);

  const finalSize = getFileSizeBytes(destination);
  const relative = path.relative(process.cwd(), destination);
  logger.info(`Final saved path: ${relative}`);
  logger.info(`File size: ${finalSize} bytes`);

  return destination;
}

/**
 * Resolve the Tender247 XLS/export control using stable strategies (no coordinates).
 */
export async function getTender247XlsLocator(page: Page): Promise<Locator> {
  // 1) Button or link with accessible name containing Excel / XLS / Export / Download
  const byAccessibleName = page
    .getByRole("button", { name: /excel|xls|export|download/i })
    .or(page.getByRole("link", { name: /excel|xls|export|download/i }));
  if (await firstVisible(byAccessibleName)) {
    return byAccessibleName.first();
  }

  // 2) Image with alt or title containing XLS / Excel / Export / Download
  const byImageMeta = page.locator(
    'img[alt*="XLS" i], img[alt*="Excel" i], img[alt*="Export" i], img[alt*="Download" i], img[title*="XLS" i], img[title*="Excel" i], img[title*="Export" i], img[title*="Download" i]',
  );
  if (await firstVisible(byImageMeta)) {
    const img = byImageMeta.first();
    const clickableParent = img.locator(
      "xpath=ancestor::a[1] | ancestor::button[1] | ancestor::*[@role='button'][1]",
    );
    if (await firstVisible(clickableParent)) {
      return clickableParent.first();
    }
    return img;
  }

  // 3) Clickable parent containing an image whose src contains xls / excel / export
  const bySrcImage = page.locator(
    'img[src*="xls" i], img[src*="excel" i], img[src*="export" i]',
  );
  if (await firstVisible(bySrcImage)) {
    const img = bySrcImage.first();
    const clickableParent = img.locator(
      "xpath=ancestor::a[1] | ancestor::button[1] | ancestor::*[@role='button'][1]",
    );
    if (await firstVisible(clickableParent)) {
      return clickableParent.first();
    }
    // Also try immediate parent if it is clickable-looking
    const parent = img.locator("xpath=..");
    if (await firstVisible(parent)) {
      return parent;
    }
    return img;
  }

  // 4) Clickable element immediately before / near the PRICE: HIGH TO LOW dropdown
  const priceSort = selectors.priceSort(page);
  if (await priceSort.isVisible().catch(() => false)) {
    const preceding = priceSort.locator(
      "xpath=preceding-sibling::*[self::a or self::button or self::img or @role='button'][1]",
    );
    if (await firstVisible(preceding)) {
      return preceding.first();
    }

    const nearContainer = priceSort.locator(
      "xpath=ancestor::*[self::div or self::section or self::header][1]",
    );
    const nearCandidates = nearContainer.locator(
      'a, button, [role="button"], img[src*="xls" i], img[src*="excel" i], img[src*="export" i], img[alt*="XLS" i], img[alt*="Excel" i], [title*="XLS" i], [title*="Excel" i], [aria-label*="XLS" i], [aria-label*="Excel" i], [aria-label*="Export" i], [aria-label*="Download" i]',
    );
    const count = await nearCandidates.count();
    for (let i = 0; i < count; i += 1) {
      const candidate = nearCandidates.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      const meta = await describeLocator(candidate).catch(() => "");
      if (/xls|xlsx|excel|export|download/i.test(meta)) {
        return candidate;
      }
    }

    // If only one small icon-like control sits beside the sort control, prefer it
    if (count === 1 && (await nearCandidates.first().isVisible().catch(() => false))) {
      return nearCandidates.first();
    }
  }

  throw new AutomationError(
    "TENDER247_XLS_NOT_FOUND",
    "XLS download icon was not found using accessible name, image meta, src, or proximity to PRICE: HIGH TO LOW",
  );
}

async function firstVisible(locator: Locator): Promise<boolean> {
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 10); i += 1) {
    if (await locator.nth(i).isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function describeLocator(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    const htmlEl = el as HTMLElement;
    const tag = htmlEl.tagName.toLowerCase();
    const title = htmlEl.getAttribute("title") ?? "";
    const aria = htmlEl.getAttribute("aria-label") ?? "";
    const alt = htmlEl.getAttribute("alt") ?? "";
    const href = htmlEl.getAttribute("href") ?? "";
    const src = htmlEl.getAttribute("src") ?? "";
    const text = (htmlEl.innerText || htmlEl.textContent || "").trim().slice(0, 80);
    return [tag, title, aria, alt, href, src, text].filter(Boolean).join(" | ");
  });
}

/**
 * Locator diagnostics when XLS cannot be found — no coordinate clicking.
 */
async function dumpXlsLocatorDiagnostics(page: Page, logger: Logger): Promise<void> {
  logger.warn("=== LOCATOR DEBUG MODE (XLS) ===");

  const priceSort = selectors.priceSort(page);
  const nearImages = await page
    .evaluate(() => {
      const sort = Array.from(document.querySelectorAll("*")).find((el) =>
        /PRICE:\s*HIGH\s*TO\s*LOW/i.test(el.textContent ?? ""),
      );
      const root =
        (sort as HTMLElement | undefined)?.closest("div, section, header") ?? document.body;
      return Array.from(root.querySelectorAll("img")).slice(0, 40).map((img) => ({
        src: img.getAttribute("src"),
        alt: img.getAttribute("alt"),
        title: img.getAttribute("title"),
      }));
    })
    .catch(() => [] as Array<{ src: string | null; alt: string | null; title: string | null }>);

  for (const img of nearImages) {
    logger.debug(
      `near-sort img: src="${img.src ?? ""}" alt="${img.alt ?? ""}" title="${img.title ?? ""}"`,
    );
  }

  const exportControls = page
    .getByRole("button", { name: /export|excel|xls|download/i })
    .or(page.getByRole("link", { name: /export|excel|xls|download/i }));
  const exportCount = await exportControls.count().catch(() => 0);
  for (let i = 0; i < Math.min(exportCount, 20); i += 1) {
    const meta = await describeLocator(exportControls.nth(i)).catch(() => "(unavailable)");
    logger.debug(`export-like control[${i}]: ${meta}`);
  }

  void priceSort;
  logger.warn("=== END LOCATOR DEBUG ===");
}

function classifyGenericError(error: unknown): string {
  const message = safeErrorMessage(error).toLowerCase();
  if (message.includes("timeout")) {
    return "TIMEOUT";
  }
  if (message.includes("browser") && message.includes("launch")) {
    return "BROWSER_LAUNCH_FAILED";
  }
  return "UNEXPECTED_ERROR";
}

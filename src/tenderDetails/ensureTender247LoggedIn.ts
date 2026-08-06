import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { AutomationError, captureErrorScreenshot } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "./dismissSupportChat.js";

const HOME_URL = "https://www.tender247.com/";
const DASHBOARD_URL = "https://www.tender247.com/auth/tender";
/** Wait for login form inputs or authenticated dashboard after Log in click. */
const LOGIN_FORM_WAIT_MS = 20_000;
const POST_SUBMIT_WAIT_MS = 45_000;

/** Re-export for existing call sites. */
export {
  dismissB2BMarketplacePopup,
  dismissTender247BlockingOverlays,
  dismissTender247BlockingOverlays as dismissPromotionalPopups,
  dismissTender247BlockingOverlays as dismissTender247PromotionalPopups,
  registerPromotionalPopupHandlers,
} from "./dismissPromotionalPopups.js";
export { dismissTender247SupportChat } from "./dismissSupportChat.js";

/**
 * Startup flow (auth only):
 * /auth/tender → dismiss promos → auth check → (login if needed).
 *
 * Does NOT select Today Tenders. Full crawl must call ensureTodayTendersSelected
 * after this returns. Single-tender mode must never call it.
 */
export async function loginToTender247(
  page: Page,
  context: BrowserContext,
  logger: Logger,
  config: AppConfig,
): Promise<void> {
  const dashboardUrl = config.tender247Url.trim() || DASHBOARD_URL;

  const emailConfigured = Boolean(process.env.TENDER247_EMAIL?.trim());
  const passwordConfigured = Boolean(process.env.TENDER247_PASSWORD?.trim());
  logger.info(`TENDER247_EMAIL_CONFIGURED=${emailConfigured}`);
  logger.info(`TENDER247_PASSWORD_CONFIGURED=${passwordConfigured}`);

  // 1–2. Open authenticated URL first, then dismiss blocking promo popups
  logger.info(`Opening Tender247 dashboard URL: ${dashboardUrl}`);
  await page.goto(dashboardUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.pageTimeoutMs,
  });
  await page
    .waitForLoadState("networkidle", { timeout: Math.min(config.pageTimeoutMs, 30_000) })
    .catch(() => undefined);
  await dismissTender247BlockingOverlays(page, logger, config);

  // 3–4. Authenticated dashboard check (only after popups dismissed)
  if (await isTender247DashboardAuthenticated(page)) {
    logger.info("TENDER247_ALREADY_AUTHENTICATED");
    logger.info("TENDER247_DASHBOARD_AUTHENTICATED");
    return;
  }

  // 5. Not logged in — homepage Log in flow
  logger.info(`Dashboard not authenticated; opening homepage for LOGIN: ${HOME_URL}`);
  await page.goto(HOME_URL, {
    waitUntil: "domcontentloaded",
    timeout: config.pageTimeoutMs,
  });
  await dismissTender247BlockingOverlays(page, logger, config);

  // From Log in click until auth succeeds/fails: NO popup dismissal
  // (generic dismiss can close the real LOGIN dialog).
  await performHomepageLoginWithExclusiveFormControl(
    page,
    context,
    logger,
    config,
    dashboardUrl,
  );
}

/**
 * Click header Log in, detect form by Email/Password inputs (not LOGIN heading),
 * fill immediately, submit, wait for dashboard. At most one reopen retry if the
 * form disappears before fill. Never dismiss promotional overlays during this.
 */
async function performHomepageLoginWithExclusiveFormControl(
  page: Page,
  context: BrowserContext,
  logger: Logger,
  config: AppConfig,
  dashboardUrl: string,
): Promise<void> {
  let reopenAttempted = false;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt === 1) {
      await clickHeaderLogIn(page, logger);
    } else {
      logger.info("TENDER247_LOGIN_FORM_DISAPPEARED_RETRYING");
      reopenAttempted = true;
      if (!page.url().includes("tender247.com") || page.url().includes("/auth/")) {
        await page.goto(HOME_URL, {
          waitUntil: "domcontentloaded",
          timeout: config.pageTimeoutMs,
        });
      }
      // Still no dismiss here — exclusive login control
      await clickHeaderLogIn(page, logger);
    }

    const race = await waitForLoginFormOrDashboard(page, LOGIN_FORM_WAIT_MS);

    if (race === "authenticated") {
      logger.info("TENDER247_AUTHENTICATED_WITHOUT_LOGIN_FORM");
      await ensureOnDashboardAndFinish(page, context, logger, config, dashboardUrl);
      return;
    }

    if (race === "form") {
      try {
        await fillAndSubmitLoginForm(page, logger, config);
      } catch (error) {
        // Form may have disappeared mid-fill — check auth, else retry once
        if (
          !reopenAttempted &&
          !(await isLoginFormReady(page)) &&
          !(await isTender247DashboardAuthenticated(page))
        ) {
          logger.warn(
            `Login form disappeared during fill: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          continue;
        }
        throw error;
      }

      await waitForAuthAfterSubmit(page, logger, config, dashboardUrl);
      await finishSuccessfulAuth(page, context, logger, config);
      return;
    }

    // timeout on this attempt
    if (await isTender247DashboardAuthenticated(page)) {
      logger.info("TENDER247_AUTHENTICATED_WITHOUT_LOGIN_FORM");
      await ensureOnDashboardAndFinish(page, context, logger, config, dashboardUrl);
      return;
    }

    if (!reopenAttempted) {
      continue;
    }
  }

  await logAuthFailureDiagnostics(page, logger);
  await failWithScreenshot(
    page,
    config,
    logger,
    "TENDER247_LOGIN_FAILED",
    `Neither usable login form nor authenticated dashboard after Log in click (url=${page.url()})`,
  );
}

async function ensureOnDashboardAndFinish(
  page: Page,
  context: BrowserContext,
  logger: Logger,
  config: AppConfig,
  dashboardUrl: string,
): Promise<void> {
  if (!(await isTender247DashboardAuthenticated(page))) {
    if (!page.url().includes("/auth/tender")) {
      logger.info(`Navigating to authenticated dashboard: ${dashboardUrl}`);
      await page.goto(dashboardUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.pageTimeoutMs,
      });
    }
    await waitForDashboardMarkers(page, Math.min(config.pageTimeoutMs, 30_000)).catch(
      () => undefined,
    );
  }
  if (!(await isTender247DashboardAuthenticated(page))) {
    await logAuthFailureDiagnostics(page, logger);
    await failWithScreenshot(
      page,
      config,
      logger,
      "TENDER247_PUBLIC_PAGE_AFTER_LOGIN",
      `Authenticated markers missing after login (url=${page.url()})`,
    );
  }
  await finishSuccessfulAuth(page, context, logger, config);
}

async function finishSuccessfulAuth(
  page: Page,
  context: BrowserContext,
  logger: Logger,
  config: AppConfig,
): Promise<void> {
  // Promo dismissal only AFTER login succeeds
  await dismissTender247BlockingOverlays(page, logger, config).catch(() => undefined);
  await dismissTender247SupportChat(page, logger).catch(() => undefined);
  logger.info("TENDER247_LOGIN_SUCCESS");
  logger.info("TENDER247_DASHBOARD_AUTHENTICATED");
  await persistAuthState(context, config, logger);
}

/**
 * After Log in click: poll for email+password inputs OR authenticated dashboard.
 * Does NOT call popup dismissal. Does NOT require LOGIN heading.
 */
async function waitForLoginFormOrDashboard(
  page: Page,
  timeoutMs: number,
): Promise<"authenticated" | "form" | "timeout"> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isTender247DashboardAuthenticated(page)) {
      return "authenticated";
    }
    if (await isLoginFormReady(page)) {
      return "form";
    }
    await page.waitForTimeout(300);
  }

  if (await isTender247DashboardAuthenticated(page)) {
    return "authenticated";
  }
  if (await isLoginFormReady(page)) {
    return "form";
  }
  return "timeout";
}

async function isLoginFormReady(page: Page): Promise<boolean> {
  const emailCount = await page
    .locator('input[placeholder*="Email" i]:visible')
    .count()
    .catch(() => 0);
  const passwordCount = await page
    .locator('input[type="password"]:visible')
    .count()
    .catch(() => 0);
  return emailCount > 0 && passwordCount > 0;
}

function loginEmailLocator(page: Page) {
  return page.locator('input[placeholder*="Email" i]:visible').first();
}

function loginPasswordLocator(page: Page) {
  return page.locator('input[type="password"]:visible').first();
}

function loginSubmitLocator(page: Page) {
  return page
    .locator("button:visible")
    .filter({ hasText: /^Submit$/i })
    .first();
}

/** Fill Email/Password and click Submit. No popup dismissal. */
async function fillAndSubmitLoginForm(
  page: Page,
  logger: Logger,
  config: AppConfig,
): Promise<void> {
  const email = process.env.TENDER247_EMAIL?.trim() ?? "";
  const password = process.env.TENDER247_PASSWORD?.trim() ?? "";
  if (!email || !password) {
    throw new AutomationError(
      "TENDER247_CREDENTIALS_NOT_CONFIGURED",
      "TENDER247_EMAIL / TENDER247_PASSWORD are not set in .env",
    );
  }

  const emailInput = loginEmailLocator(page);
  const passwordInput = loginPasswordLocator(page);
  const submitButton = loginSubmitLocator(page);

  await emailInput.waitFor({ state: "visible", timeout: 10_000 });
  await passwordInput.waitFor({ state: "visible", timeout: 10_000 });

  logger.info("TENDER247_LOGIN_FORM_DETECTED");

  await emailInput.fill(email, { timeout: 10_000 });
  logger.info("TENDER247_EMAIL_FILLED");

  await passwordInput.fill(password, { timeout: 10_000 });
  logger.info("TENDER247_PASSWORD_FILLED");

  if ((await emailInput.inputValue()).length === 0) {
    throw new AutomationError(
      "TENDER247_EMAIL_NOT_FILLED",
      "Tender247 email input remained empty",
    );
  }
  if ((await passwordInput.inputValue()).length === 0) {
    throw new AutomationError(
      "TENDER247_PASSWORD_NOT_FILLED",
      "Tender247 password input remained empty",
    );
  }

  await submitButton.waitFor({ state: "visible", timeout: 10_000 });
  await submitButton.click({ timeout: 10_000 });
  logger.info("TENDER247_LOGIN_SUBMITTED");

  if (await hasManualVerificationChallenge(page)) {
    await failWithScreenshot(
      page,
      config,
      logger,
      "TENDER247_MANUAL_LOGIN_REQUIRED",
      "OTP, CAPTCHA, or other manual verification appeared during real LOGIN",
    );
  }
}

/**
 * After Submit: wait for dashboard /auth/tender, markers, or password input hidden.
 * Navigate to dashboard once if still on homepage after success signals.
 */
async function waitForAuthAfterSubmit(
  page: Page,
  logger: Logger,
  config: AppConfig,
  dashboardUrl: string,
): Promise<void> {
  const deadline = Date.now() + POST_SUBMIT_WAIT_MS;
  let navigatedToDashboard = false;

  while (Date.now() < deadline) {
    if (await isTender247DashboardAuthenticated(page)) {
      return;
    }

    const url = page.url();
    if (url.includes("/auth/tender")) {
      await page.waitForTimeout(500);
      if (await isTender247DashboardAuthenticated(page)) {
        return;
      }
    }

    const passwordStillVisible = await page
      .locator('input[type="password"]:visible')
      .first()
      .isVisible()
      .catch(() => false);

    // Form gone and still on homepage — navigate to dashboard once
    if (
      !passwordStillVisible &&
      !url.includes("/auth/tender") &&
      !navigatedToDashboard
    ) {
      navigatedToDashboard = true;
      logger.info(`Navigating to authenticated dashboard: ${dashboardUrl}`);
      await page.goto(dashboardUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.pageTimeoutMs,
      });
      try {
        await waitForDashboardMarkers(page, Math.min(config.pageTimeoutMs, 30_000));
        return;
      } catch {
        // continue polling
      }
    }

    if (await hasManualVerificationChallenge(page)) {
      await failWithScreenshot(
        page,
        config,
        logger,
        "TENDER247_MANUAL_LOGIN_REQUIRED",
        "OTP, CAPTCHA, or other manual verification appeared after LOGIN submit",
      );
    }

    await page.waitForTimeout(400);
  }

  // Final navigation attempt if still not authenticated
  if (!(await isTender247DashboardAuthenticated(page))) {
    if (!page.url().includes("/auth/tender")) {
      logger.info(`Navigating to authenticated dashboard: ${dashboardUrl}`);
      await page.goto(dashboardUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.pageTimeoutMs,
      });
    }
    try {
      await waitForDashboardMarkers(page, Math.min(config.pageTimeoutMs, 30_000));
    } catch {
      await logAuthFailureDiagnostics(page, logger);
      await failWithScreenshot(
        page,
        config,
        logger,
        "TENDER247_PUBLIC_PAGE_AFTER_LOGIN",
        `Login finished but authenticated dashboard markers did not appear (url=${page.url()})`,
      );
    }
  }

  if (!(await isTender247DashboardAuthenticated(page))) {
    await logAuthFailureDiagnostics(page, logger);
    await failWithScreenshot(
      page,
      config,
      logger,
      "TENDER247_PUBLIC_PAGE_AFTER_LOGIN",
      `Login finished but authenticated dashboard markers did not appear (url=${page.url()})`,
    );
  }
}

/** @deprecated Prefer loginToTender247 — kept as alias for existing call sites. */
export async function ensureTender247DashboardAuthenticated(
  page: Page,
  context: BrowserContext,
  logger: Logger,
  config: AppConfig,
): Promise<void> {
  await loginToTender247(page, context, logger, config);
}

/**
 * Authenticate / recover a tender detail page opened in the shared BrowserContext.
 */
export async function ensureTender247DetailAuthenticated(
  detailPage: Page,
  context: BrowserContext,
  logger: Logger,
  config: AppConfig,
): Promise<void> {
  await dismissTender247BlockingOverlays(detailPage, logger, config);

  if (await isDetailPageReady(detailPage)) {
    return;
  }

  if (await isLoginModalVisible(detailPage)) {
    await submitRealLoginModal(detailPage, context, logger, config, "detail");
  }

  await dismissTender247BlockingOverlays(detailPage, logger, config);

  try {
    await waitForDetailMarkers(detailPage, config.pageTimeoutMs);
  } catch {
    if (await isPublicUnauthenticatedPage(detailPage)) {
      await failWithScreenshot(
        detailPage,
        config,
        logger,
        "TENDER247_PUBLIC_PAGE_AFTER_LOGIN",
        `Detail page looks like the public homepage after login (url=${detailPage.url()})`,
      );
    }
    await failWithScreenshot(
      detailPage,
      config,
      logger,
      "TENDER247_LOGIN_FAILED",
      `Tender detail markers did not appear (url=${detailPage.url()})`,
    );
  }

  if (await isPublicUnauthenticatedPage(detailPage) && !(await isDetailPageReady(detailPage))) {
    await failWithScreenshot(
      detailPage,
      config,
      logger,
      "TENDER247_PUBLIC_PAGE_AFTER_LOGIN",
      `Public page accepted as detail page is not allowed (url=${detailPage.url()})`,
    );
  }
}

/**
 * Backward-compatible helper: satisfy LOGIN modal when visible (detail or list).
 */
export async function ensureTender247LoggedIn(
  page: Page,
  context: BrowserContext,
  logger: Logger,
  config: AppConfig,
): Promise<void> {
  await dismissTender247BlockingOverlays(page, logger, config);
  if (!(await isLoginFormReady(page))) {
    return;
  }
  await submitRealLoginModal(page, context, logger, config, "modal-only");
}

async function submitRealLoginModal(
  page: Page,
  context: BrowserContext,
  logger: Logger,
  config: AppConfig,
  mode: "dashboard" | "detail" | "modal-only",
): Promise<void> {
  // Wait for email+password inputs — do not require LOGIN heading
  const formReady = await waitForLoginFormOnly(page, 10_000);
  if (!formReady) {
    if (mode === "modal-only") {
      return;
    }
    if (await isTender247DashboardAuthenticated(page)) {
      logger.info("TENDER247_AUTHENTICATED_WITHOUT_LOGIN_FORM");
      return;
    }
    if (mode === "detail" && (await isDetailPageReady(page))) {
      return;
    }
    await failWithScreenshot(
      page,
      config,
      logger,
      "TENDER247_LOGIN_FAILED",
      `Neither login form nor authenticated page after waiting (url=${page.url()})`,
    );
  }

  await fillAndSubmitLoginForm(page, logger, config);

  if (mode !== "dashboard") {
    // Wait briefly for form to dismiss / detail to become ready
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (!(await isLoginFormReady(page))) {
        break;
      }
      await page.waitForTimeout(300);
    }
    if (await isLoginFormReady(page)) {
      await failWithScreenshot(
        page,
        config,
        logger,
        "TENDER247_LOGIN_FAILED",
        `LOGIN form remained visible after Submit (url=${page.url()})`,
      );
    }
    logger.info("TENDER247_LOGIN_SUCCESS");
    await persistAuthState(context, config, logger);
  }
}

async function waitForLoginFormOnly(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoginFormReady(page)) {
      return true;
    }
    await page.waitForTimeout(300);
  }
  return isLoginFormReady(page);
}

export async function isTender247DashboardAuthenticated(
  page: Page,
): Promise<boolean> {
  // Never treat a blurred dashboard behind a promo popup as authenticated
  const promoVisible =
    (await page
      .getByText("Tender247 B2B Marketplace", { exact: true })
      .isVisible()
      .catch(() => false)) ||
    (await page
      .getByText("Get Your Free Sample", { exact: true })
      .isVisible()
      .catch(() => false));
  if (promoVisible) {
    return false;
  }

  if (!page.url().includes("/auth/tender")) {
    return false;
  }
  const markers = await collectDashboardMarkers(page);
  const count = Object.values(markers).filter(Boolean).length;
  return count >= 2;
}

/** @deprecated Prefer isTender247DashboardAuthenticated */
export async function isDashboardAuthenticated(page: Page): Promise<boolean> {
  return isTender247DashboardAuthenticated(page);
}

async function logAuthFailureDiagnostics(page: Page, logger: Logger): Promise<void> {
  const markers = await collectDashboardMarkers(page);
  const b2b = await page
    .getByText("Tender247 B2B Marketplace", { exact: true })
    .isVisible()
    .catch(() => false);
  const freeSample = await page
    .getByText("Get Your Free Sample", { exact: true })
    .isVisible()
    .catch(() => false);
  logger.error(`Auth failure diagnostics: url=${page.url()}`);
  logger.error(`popup B2B visible=${b2b}; Free Sample visible=${freeSample}`);
  logger.error(
    `markers: indianTender=${markers.indianTender} todayTenders=${markers.todayTenders} tenderFilters=${markers.tenderFilters} fresh=${markers.fresh} t247Id=${markers.t247Id} xls=${markers.xls}`,
  );
}

async function collectDashboardMarkers(page: Page): Promise<Record<string, boolean>> {
  return {
    indianTender: await page
      .getByText("Indian Tender", { exact: true })
      .first()
      .isVisible()
      .catch(() => false),
    todayTenders: await page
      .getByText(/Today\s+Tenders/i)
      .first()
      .isVisible()
      .catch(() => false),
    tenderFilters: await page
      .getByText(/Tender\s+Filters|FILTERS/i)
      .first()
      .isVisible()
      .catch(() => false),
    fresh: await page
      .getByText(/Fresh(\s*\(|$)/i)
      .first()
      .isVisible()
      .catch(() => false),
    t247Id: await page
      .getByText(/T247\s*ID/i)
      .first()
      .isVisible()
      .catch(() => false),
    xls: await page
      .locator(
        '[title*="XLS" i], [aria-label*="XLS" i], [alt*="XLS" i], a[href*="xls" i], button:has-text("XLS")',
      )
      .or(page.getByRole("button", { name: /xls|excel|export/i }))
      .first()
      .isVisible()
      .catch(() => false),
  };
}

async function waitForDashboardMarkers(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isTender247DashboardAuthenticated(page)) {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("dashboard markers timeout");
}

export async function isPublicUnauthenticatedPage(page: Page): Promise<boolean> {
  if (await isDashboardAuthenticated(page)) {
    return false;
  }
  if (await isDetailPageReady(page)) {
    return false;
  }

  const url = page.url();
  let pathName = "/";
  try {
    pathName = new URL(url).pathname;
  } catch {
    pathName = url;
  }

  const headerLogIn = await page
    .getByRole("button", { name: /^Log\s*in$/i })
    .or(page.getByRole("link", { name: /^Log\s*in$/i }))
    .first()
    .isVisible()
    .catch(() => false);

  const freeSample = await page
    .getByText(/Get\s+Your\s+Free\s+Sample/i)
    .first()
    .isVisible()
    .catch(() => false);

  const agentic = await page
    .getByText(/AGENTIC\s+AI\s+FOR/i)
    .first()
    .isVisible()
    .catch(() => false);

  const aiSearch = await page
    .getByPlaceholder(/AI\s*Search|search/i)
    .or(page.getByText(/AI\s*Search/i))
    .first()
    .isVisible()
    .catch(() => false);

  const publicUrl =
    pathName === "/" ||
    pathName === "" ||
    pathName.includes("/keyword/") ||
    (!pathName.includes("/auth/tender") && !pathName.includes("/auth/"));

  return headerLogIn || freeSample || agentic || aiSearch || publicUrl;
}

async function clickHeaderLogIn(page: Page, logger: Logger): Promise<void> {
  const logIn = page
    .getByRole("button", { name: /^Log\s*in$/i })
    .or(page.getByRole("link", { name: /^Log\s*in$/i }))
    .first();

  if (!(await logIn.isVisible().catch(() => false))) {
    logger.warn("Header Log in button not found on public homepage");
    return;
  }

  await logIn.click({ timeout: 10_000 });
  logger.info("TENDER247_LOGIN_BUTTON_CLICKED");
  // Do NOT wait solely for LOGIN heading — session may redirect to /auth/tender immediately.
}

export async function isDetailPageReady(page: Page): Promise<boolean> {
  const markers = [
    page.getByText(/^Brief$/i),
    page.getByText(/^Description$/i),
    page.getByText(/Submission\s*Date/i),
    page.getByText(/Opening\s*Date/i),
    page.getByText(/Tender\s*Documents/i),
    page.getByText(/Corrigendum\s*Documents?/i),
    page.getByText(/AI\s*(Generated\s*)?Tender\s*Summary/i),
  ];
  let visible = 0;
  for (const marker of markers) {
    if (await marker.first().isVisible().catch(() => false)) {
      visible += 1;
    }
  }
  return visible >= 1;
}

async function waitForDetailMarkers(page: Page, timeoutMs: number): Promise<void> {
  await page
    .getByText(
      /Brief|Description|Submission\s*Date|Opening\s*Date|Tender\s*Documents|Corrigendum\s*Documents?|AI\s*(Generated\s*)?Tender\s*Summary/i,
    )
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs });
}

export async function isLoginModalVisible(page: Page): Promise<boolean> {
  // Detect by usable Email + Password inputs — do NOT require LOGIN heading.
  // Free Sample promo has Email but no password, so password check excludes it.
  return isLoginFormReady(page);
}

async function hasManualVerificationChallenge(page: Page): Promise<boolean> {
  // Ignore Free Sample captcha if that popup is the only captcha present
  const freeSampleVisible = await page
    .getByText(/Get\s+Your\s+Free\s+Sample/i)
    .first()
    .isVisible()
    .catch(() => false);

  const otp = page.getByText(
    /\bOTP\b|one[-\s]?time\s*password|enter\s*otp|verification\s*code/i,
  );
  if (await otp.first().isVisible().catch(() => false)) {
    return true;
  }

  if (freeSampleVisible) {
    return false;
  }

  const captcha = page.locator(
    'iframe[src*="recaptcha" i], iframe[title*="captcha" i], .g-recaptcha, [class*="captcha" i]',
  );
  const captchaText = page.getByText(/\bcaptcha\b|i'?m\s*not\s*a\s*robot/i);
  return (
    (await captcha.first().isVisible().catch(() => false)) ||
    (await captchaText.first().isVisible().catch(() => false))
  );
}

async function failWithScreenshot(
  page: Page,
  config: AppConfig,
  logger: Logger,
  code: string,
  message: string,
): Promise<never> {
  logger.error(`${code}: ${message}`);
  await captureErrorScreenshot(page, config.screenshotRoot, "Tender247", code, logger);
  throw new AutomationError(code, message);
}

export async function persistAuthState(
  context: BrowserContext,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  fs.mkdirSync(config.authDir, { recursive: true });

  const primary = config.tender247AuthPath;
  await context.storageState({
    path: primary,
    indexedDB: true,
  });
  logger.info(
    `Auth storage refreshed: ${path.relative(process.cwd(), primary)} (indexedDB included)`,
  );

  const sessionPath = config.tender247SessionPath;
  if (sessionPath && sessionPath !== primary) {
    await context.storageState({
      path: sessionPath,
      indexedDB: true,
    });
    logger.info(
      `Auth session storage refreshed: ${path.relative(process.cwd(), sessionPath)}`,
    );
  }
}

export function assertSameBrowserContext(
  page: Page,
  expectedContext: BrowserContext,
  logger: Logger,
  label: string,
): void {
  const same = page.context() === expectedContext;
  logger.info(`BrowserContext check [${label}]: sameContext=${same}`);
  if (!same) {
    throw new AutomationError(
      "TENDER247_CONTEXT_MISMATCH",
      `Detail page is not using the shared authenticated BrowserContext (${label})`,
    );
  }
}

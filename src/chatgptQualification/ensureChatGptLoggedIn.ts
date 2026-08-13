import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import type { Logger } from "../logger.js";

export interface ChatGptBrowserSession {
  context: BrowserContext;
  page: Page;
  /** Persistent context owns the browser; no separate Browser handle. */
  persistent: true;
}

export interface AuthMarkerSnapshot {
  projectsVisible: boolean;
  configuredProjectVisible: boolean;
  accountMenuVisible: boolean;
  workspaceMenuVisible: boolean;
  chatHistoryVisible: boolean;
  planOrAccountVisible: boolean;
  strongCount: number;
}

/**
 * Launch ChatGPT with a persistent Chrome user-data profile.
 * First login must always be headful.
 */
export async function launchChatGptPersistentSession(options: {
  config: AppConfig;
  logger: Logger;
  downloadPath?: string;
}): Promise<ChatGptBrowserSession> {
  const { config, logger } = options;
  const profileDir = resolveProjectPath(config.chatgptAuthProfile);
  ensureDir(profileDir);
  ensureDir(path.dirname(resolveProjectPath(config.chatgptStorageState)));

  const headless = false;

  logger.info(`Opening ChatGPT (persistent profile=${profileDir})`);

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      channel: "chrome",
      // Keep Chromium sandbox enabled on Windows Chrome (avoids --no-sandbox warning).
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

  // Response wait uses its own non-blocking poll loop — never set default
  // locator timeout to CHATGPT_RESPONSE_TIMEOUT_MS (20m) or isVisible/evaluate hang.
  context.setDefaultTimeout(config.pageTimeoutMs);

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(config.pageTimeoutMs);

  return { context, page, persistent: true };
}

export async function closeChatGptSession(
  session: ChatGptBrowserSession | undefined,
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

/**
 * Open ChatGPT and ensure the user is authenticated with strong markers.
 * Does not close the browser. Continues in the same page after login.
 */
export async function ensureChatGptLoggedIn(options: {
  page: Page;
  context: BrowserContext;
  config: AppConfig;
  logger: Logger;
}): Promise<void> {
  const { context, config, logger } = options;
  let page = options.page;
  const projectName = config.chatgptProjectName;

  logger.info("Opening ChatGPT");
  await page.goto(config.chatgptUrl, {
    waitUntil: "domcontentloaded",
    timeout: Math.max(config.pageTimeoutMs, 60_000),
  });
  await page.waitForTimeout(2000);

  // Never trust a pre-existing storage-state file alone — verify live UI.
  const alreadyAuthed = await waitForStableAuthentication({
    page,
    projectName,
    timeoutMs: 8_000,
    logger,
    quiet: true,
  });

  if (alreadyAuthed) {
    page = await resolveActiveChatGptPage(page, projectName);
    logger.info("CHATGPT_EXISTING_SESSION_FOUND");
    const saved = await tryFinalizeAuthenticatedSession({
      page,
      context,
      config,
      logger,
      existingSession: true,
    });
    if (saved) {
      return;
    }
    logger.error("CHATGPT_SAVED_SESSION_VALIDATION_FAILED");
    logger.info("CHATGPT_LOGIN_REQUIRED");
    logger.info("PLEASE_LOGIN_MANUALLY_IN_THE_OPEN_BROWSER");
    // Fall through to manual login
  } else {
    logger.info("CHATGPT_LOGIN_REQUIRED");
    logger.info("PLEASE_LOGIN_MANUALLY_IN_THE_OPEN_BROWSER");
    // Discard any prior false-positive storage-state file
    deleteStorageStateFile(config, logger);
  }
  console.log("");
  console.log("======================================================");
  console.log("  ChatGPT manual login");
  console.log("======================================================");
  console.log("Log in manually in the opened browser.");
  console.log(
    "After the ChatGPT sidebar, Projects, and your project appear,",
  );
  console.log("return to the terminal and press Enter (auto-detect preferred).");
  console.log(
    `Waiting up to ${Math.round(config.chatgptManualLoginTimeoutMs / 60000)} minutes...`,
  );
  console.log("======================================================");
  console.log("");

  const ok = await waitForManualLogin({
    page,
    projectName,
    timeoutMs: config.chatgptManualLoginTimeoutMs,
    logger,
  });

  if (!ok) {
    throw new AutomationError(
      "CHATGPT_LOGIN_TIMEOUT",
      `Manual ChatGPT login did not complete within ${config.chatgptManualLoginTimeoutMs}ms`,
    );
  }

  page = await resolveActiveChatGptPage(page, projectName);

  // Prefer returning to chatgpt.com home if still on an auth redirect host
  if (!page.isClosed()) {
    const url = page.url().toLowerCase();
    if (
      !url.includes("chatgpt.com") ||
      /\/auth(\/|$)/.test(url) ||
      url.includes("login.openai") ||
      url.includes("auth.openai")
    ) {
      await page
        .goto(config.chatgptUrl, {
          waitUntil: "domcontentloaded",
          timeout: Math.max(config.pageTimeoutMs, 60_000),
        })
        .catch(() => undefined);
      await page.waitForTimeout(1500);
    }
  }

  // Re-confirm stability after redirect settle
  const stable = await waitForStableAuthentication({
    page,
    projectName,
    timeoutMs: 30_000,
    logger,
    quiet: false,
  });
  if (!stable) {
    throw new AutomationError(
      "CHATGPT_AUTH_FAILED",
      "Login wait finished but strong authenticated markers (Projects / project / account) were not stable",
    );
  }

  const saved = await tryFinalizeAuthenticatedSession({
    page,
    context,
    config,
    logger,
    existingSession: false,
  });

  if (saved) {
    return;
  }

  // Validation failed — remain in manual-login wait mode until timeout
  logger.error("CHATGPT_SAVED_SESSION_VALIDATION_FAILED");
  logger.info("CHATGPT_LOGIN_REQUIRED");
  logger.info("PLEASE_LOGIN_MANUALLY_IN_THE_OPEN_BROWSER");
  console.log("");
  console.log("Saved session failed validation. Please finish login in the browser.");
  console.log("Waiting again for Projects + configured project...");
  console.log("");

  const retryOk = await waitForManualLogin({
    page,
    projectName,
    timeoutMs: Math.min(config.chatgptManualLoginTimeoutMs, 300_000),
    logger,
  });
  if (!retryOk) {
    throw new AutomationError(
      "CHATGPT_SAVED_SESSION_VALIDATION_FAILED",
      "Saved session failed fresh-page validation and retry login did not succeed",
    );
  }

  const savedRetry = await tryFinalizeAuthenticatedSession({
    page: await resolveActiveChatGptPage(page, projectName),
    context,
    config,
    logger,
    existingSession: false,
  });
  if (!savedRetry) {
    throw new AutomationError(
      "CHATGPT_SAVED_SESSION_VALIDATION_FAILED",
      "Saved session failed fresh-page validation (still looks logged out)",
    );
  }
}

async function tryFinalizeAuthenticatedSession(options: {
  page: Page;
  context: BrowserContext;
  config: AppConfig;
  logger: Logger;
  existingSession: boolean;
}): Promise<boolean> {
  const { page, context, config, logger, existingSession } = options;
  const projectName = config.chatgptProjectName;

  const markers = await collectAuthMarkers(page, projectName);
  logAuthMarkers(markers, logger);

  if (await isChatGptLoggedOut(page)) {
    logger.warn(
      "CHATGPT_AUTH_VERIFICATION_FAILED — Log in / Sign up still visible",
    );
    return false;
  }
  if (!(await isChatGptAuthenticated(page, projectName))) {
    logger.warn(
      "CHATGPT_AUTH_VERIFICATION_FAILED — strong markers missing before save",
    );
    return false;
  }

  try {
    await persistChatGptAuth(context, config, logger);
  } catch (error) {
    if (
      error instanceof AutomationError &&
      error.code === "CHATGPT_AUTH_VERIFICATION_FAILED"
    ) {
      logger.warn(error.message);
      return false;
    }
    throw error;
  }

  const validated = await validateSavedSessionInFreshPage({
    context,
    config,
    logger,
  });

  if (!validated) {
    deleteStorageStateFile(config, logger);
    return false;
  }

  if (!existingSession) {
    logger.info("CHATGPT_LOGIN_SUCCESS");
  }
  logger.info("CHATGPT_AUTHENTICATED");
  logger.info("CHATGPT_SAVED_SESSION_VALIDATED");
  console.log("");
  console.log("ChatGPT authentication saved successfully.");
  console.log(`Profile: ${config.chatgptAuthProfile}`);
  console.log(`Storage state: ${config.chatgptStorageState}`);
  return true;
}

/**
 * Poll until authenticated for 3 consecutive checks (1s apart).
 * Also accepts Enter as a nudge to re-check (does not skip stability).
 */
async function waitForManualLogin(options: {
  page: Page;
  projectName: string;
  timeoutMs: number;
  logger: Logger;
}): Promise<boolean> {
  const { page, projectName, timeoutMs, logger } = options;
  const deadline = Date.now() + timeoutMs;

  let enterPressed = false;
  const rl = readline.createInterface({ input, output });
  const enterPromise = rl
    .question(
      "Press Enter after Projects + your project appear (or wait for auto-detect)... ",
    )
    .then(() => {
      enterPressed = true;
    })
    .catch(() => undefined);

  try {
    return await waitForStableAuthentication({
      page,
      projectName,
      timeoutMs,
      logger,
      quiet: false,
      deadline,
      onPoll: async () => {
        if (enterPressed) {
          enterPressed = false;
          logger.info(
            "Enter received — re-checking strong auth markers (still requires stability)",
          );
          void rl
            .question(
              "If still waiting, finish login then press Enter again... ",
            )
            .then(() => {
              enterPressed = true;
            })
            .catch(() => undefined);
        }
      },
    });
  } finally {
    rl.close();
    void enterPromise;
  }
}

async function waitForStableAuthentication(options: {
  page: Page;
  projectName: string;
  timeoutMs: number;
  logger: Logger;
  quiet: boolean;
  deadline?: number;
  onPoll?: () => Promise<void>;
}): Promise<boolean> {
  const { page, projectName, logger, quiet } = options;
  const deadline = options.deadline ?? Date.now() + options.timeoutMs;
  let authenticatedStreak = 0;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      if (!quiet) {
        logger.error("Browser was closed during authentication wait");
      }
      return false;
    }

    const authPage = await resolveActiveChatGptPage(page, projectName);

    if (await isChatGptLoggedOut(authPage)) {
      authenticatedStreak = 0;
    } else if (await isChatGptAuthenticated(authPage, projectName)) {
      authenticatedStreak += 1;
      if (!quiet && authenticatedStreak === 1) {
        const markers = await collectAuthMarkers(authPage, projectName);
        logAuthMarkers(markers, logger);
      }
    } else {
      authenticatedStreak = 0;
    }

    if (authenticatedStreak >= 3) {
      if (!quiet) {
        logger.info("CHATGPT_AUTH_STABLE");
      }
      return true;
    }

    if (options.onPoll) {
      await options.onPoll();
    }

    await page.waitForTimeout(1000).catch(() => undefined);
  }

  return false;
}

async function resolveActiveChatGptPage(
  page: Page,
  projectName: string,
): Promise<Page> {
  if (page.isClosed()) {
    return page;
  }
  const context = page.context();
  const pages = context.pages().filter((p) => !p.isClosed());

  for (const p of pages) {
    const url = p.url().toLowerCase();
    if (
      url.includes("chatgpt.com") &&
      (await isChatGptAuthenticated(p, projectName))
    ) {
      return p;
    }
  }
  for (const p of pages) {
    if (p.url().toLowerCase().includes("chatgpt.com")) {
      return p;
    }
  }
  return page;
}

export async function persistChatGptAuth(
  context: BrowserContext,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  // Final gate immediately before write
  const pages = context.pages().filter((p) => !p.isClosed());
  const checkPage =
    pages.find((p) => p.url().toLowerCase().includes("chatgpt.com")) ??
    pages[0];
  if (!checkPage) {
    throw new AutomationError(
      "CHATGPT_AUTH_VERIFICATION_FAILED",
      "No open page available to verify before saving storage state",
    );
  }
  if (await isChatGptLoggedOut(checkPage)) {
    throw new AutomationError(
      "CHATGPT_AUTH_VERIFICATION_FAILED",
      "Log in / Sign up still visible — refusing to write auth/chatgpt.json",
    );
  }
  if (!(await isChatGptAuthenticated(checkPage, config.chatgptProjectName))) {
    throw new AutomationError(
      "CHATGPT_AUTH_VERIFICATION_FAILED",
      "Strong auth markers missing — refusing to write auth/chatgpt.json",
    );
  }

  const storagePath = resolveProjectPath(config.chatgptStorageState);
  ensureDir(path.dirname(storagePath));
  await context.storageState({
    path: storagePath,
    indexedDB: true,
  });
  logger.info("CHATGPT_STORAGE_STATE_SAVED");
  logger.info(
    `Saved ChatGPT storage state → ${path.relative(process.cwd(), storagePath)}`,
  );
}

function deleteStorageStateFile(config: AppConfig, logger: Logger): void {
  const storagePath = resolveProjectPath(config.chatgptStorageState);
  try {
    if (fs.existsSync(storagePath)) {
      fs.unlinkSync(storagePath);
      logger.warn(`Deleted untrusted storage state: ${storagePath}`);
    }
  } catch (error) {
    logger.warn(
      `Could not delete storage state: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * After saving, open a fresh page and confirm the session is really logged in.
 */
async function validateSavedSessionInFreshPage(options: {
  context: BrowserContext;
  config: AppConfig;
  logger: Logger;
}): Promise<boolean> {
  const { context, config, logger } = options;
  const projectName = config.chatgptProjectName;
  let fresh: Page | undefined;

  try {
    fresh = await context.newPage();
    await fresh.goto(config.chatgptUrl, {
      waitUntil: "domcontentloaded",
      timeout: Math.max(config.pageTimeoutMs, 60_000),
    });
    await fresh.waitForTimeout(2500);

    if (await isChatGptLoggedOut(fresh)) {
      logger.warn("Fresh-page validation: Log in / Sign up still visible");
      return false;
    }

    const markers = await collectAuthMarkers(fresh, projectName);
    if (!markers.projectsVisible) {
      logger.warn("Fresh-page validation: Projects not visible");
      return false;
    }
    if (!markers.configuredProjectVisible) {
      logger.warn(
        `Fresh-page validation: configured project not visible (${projectName})`,
      );
      return false;
    }
    if (!(await isChatGptAuthenticated(fresh, projectName))) {
      logger.warn("Fresh-page validation: strong auth check failed");
      return false;
    }

    return true;
  } catch (error) {
    logger.warn(
      `Fresh-page validation error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  } finally {
    if (fresh && !fresh.isClosed()) {
      await fresh.close().catch(() => undefined);
    }
  }
}

/** Detect logged-out ChatGPT landing / marketing UI. */
export async function isChatGptLoggedOut(page: Page): Promise<boolean> {
  if (page.isClosed()) {
    return true;
  }

  const loginButtons = page.getByRole("button", { name: /^Log in$/i });
  const loginLinks = page.getByRole("link", { name: /^Log in$/i });
  const signupControls = page
    .getByRole("button", { name: /^Sign up(?: for free)?$/i })
    .or(page.getByRole("link", { name: /^Sign up(?: for free)?$/i }))
    .or(page.getByText(/^Sign up(?: for free)?$/i));
  const tailored = page.getByText(/Get responses tailored to you/i).first();

  const checks = [
    loginButtons.first(),
    loginLinks.first(),
    signupControls.first(),
    tailored,
  ];

  for (const el of checks) {
    if (await el.isVisible().catch(() => false)) {
      return true;
    }
  }

  // Bottom / sidebar Log in (broader but still exact-ish name)
  const anyLogin = page.getByText(/^Log in$/i).first();
  if (await anyLogin.isVisible().catch(() => false)) {
    // Avoid matching unrelated "Log in" buried in docs — require nearby role
    const roleLogin = page
      .locator('a, button')
      .filter({ hasText: /^Log in$/i })
      .first();
    if (await roleLogin.isVisible().catch(() => false)) {
      return true;
    }
  }

  return false;
}

/**
 * Strong authentication check.
 * Requires: no Log in/Sign up, AND at least two strong logged-in markers.
 * Never uses New chat / Ask anything / composer / URL alone.
 */
export async function isChatGptAuthenticated(
  page: Page,
  projectName?: string,
): Promise<boolean> {
  if (page.isClosed()) {
    return false;
  }

  const url = page.url().toLowerCase();
  if (
    url.includes("accounts.google.com") ||
    url.includes("login.microsoftonline.com") ||
    url.includes("login.live.com") ||
    url.includes("auth0.com") ||
    url.includes("login.openai.com") ||
    url.includes("auth.openai.com")
  ) {
    return false;
  }

  if (await isChatGptLoggedOut(page)) {
    return false;
  }

  const markers = await collectAuthMarkers(page, projectName ?? "");
  return markers.strongCount >= 2;
}

export async function collectAuthMarkers(
  page: Page,
  projectName: string,
): Promise<AuthMarkerSnapshot> {
  const projectsVisible =
    (await page
      .getByRole("heading", { name: /^Projects$/i })
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await page
      .locator("nav, aside, [data-testid*='sidebar']")
      .getByText(/^Projects$/i)
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await page.getByText(/^Projects$/i).first().isVisible().catch(() => false));

  let configuredProjectVisible = false;
  if (projectName.trim()) {
    const projectRe = new RegExp(escapeRegExp(projectName.trim()), "i");
    configuredProjectVisible = await page
      .getByText(projectRe)
      .first()
      .isVisible()
      .catch(() => false);

    if (!configuredProjectVisible) {
      configuredProjectVisible = await page
        .locator(`[aria-label*="${cssEscapeAttr(projectName)}" i], [title*="${cssEscapeAttr(projectName)}" i]`)
        .first()
        .isVisible()
        .catch(() => false);
    }
  }

  const accountMenuVisible =
    (await page
      .locator(
        'button[aria-label*="profile" i], button[aria-label*="account" i], button[aria-label*="user menu" i], button[aria-label*="open menu" i], button[aria-label*="Open profile" i]',
      )
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await page
      .getByRole("button", { name: /profile|account|user menu|open menu/i })
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await page
      .locator('[data-testid="profile-button"], [data-testid="accounts-profile-button"]')
      .first()
      .isVisible()
      .catch(() => false));

  const workspaceMenuVisible = await page
    .getByRole("button", {
      name: /workspace|team|settings|my\s*gpt|upgrade/i,
    })
    .first()
    .isVisible()
    .catch(() => false);

  // Personal history: sidebar chat list items (not just "New chat")
  const chatHistoryVisible = await page
    .locator(
      'nav a[href*="/c/"], [data-testid*="history"] a, ol li a[href*="/c/"]',
    )
    .first()
    .isVisible()
    .catch(() => false);

  const planOrAccountVisible = await page
    .getByText(/\b(Plus|Pro|Team|Enterprise|Free plan|ChatGPT Plus)\b/i)
    .first()
    .isVisible()
    .catch(() => false);

  const flags = [
    projectsVisible,
    configuredProjectVisible,
    accountMenuVisible,
    workspaceMenuVisible,
    chatHistoryVisible,
    planOrAccountVisible,
  ];
  const strongCount = flags.filter(Boolean).length;

  return {
    projectsVisible,
    configuredProjectVisible,
    accountMenuVisible,
    workspaceMenuVisible,
    chatHistoryVisible,
    planOrAccountVisible,
    strongCount,
  };
}

function logAuthMarkers(markers: AuthMarkerSnapshot, logger: Logger): void {
  if (markers.projectsVisible) {
    logger.info("CHATGPT_PROJECTS_VISIBLE");
  }
  if (markers.configuredProjectVisible) {
    logger.info("CHATGPT_CONFIGURED_PROJECT_VISIBLE");
  }
  if (markers.accountMenuVisible) {
    logger.info("CHATGPT_ACCOUNT_MENU_VISIBLE");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssEscapeAttr(value: string): string {
  return value.replace(/["\\]/g, "");
}

export function chatgptAuthExists(config: AppConfig): boolean {
  const storage = resolveProjectPath(config.chatgptStorageState);
  const profile = resolveProjectPath(config.chatgptAuthProfile);
  return fs.existsSync(storage) || fs.existsSync(profile);
}

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import {
  CHATGPT_AUTH_BROWSER_CLOSED,
  CHATGPT_AUTH_READY,
  CHATGPT_AUTH_REQUIRED,
  CHATGPT_AUTH_TIMEOUT,
  CHATGPT_PROJECT_NAVIGATION_FAILED,
  collectAuthMarkers,
  inspectChatGptAuth,
  isChatGptAuthenticated,
  isChatGptLoggedOut,
  logChatGptAuthDiagnostics,
  waitForChatGptAuthentication,
  type AuthMarkerSnapshot,
} from "./chatgptAuthState.js";
import {
  buildChatGptPersistentLaunchOptions,
  CHATGPT_PROFILE_DIR,
  chatgptProfileExists,
  logChatGptProfileStartup,
} from "./chatgptProfile.js";
import { openChatGptProject } from "./openProject.js";

export type { AuthMarkerSnapshot };
export {
  collectAuthMarkers,
  isChatGptAuthenticated,
  isChatGptLoggedOut,
};

export interface ChatGptBrowserSession {
  context: BrowserContext;
  page: Page;
  /** Persistent context owns the browser; no separate Browser handle. */
  persistent: true;
}

/**
 * Launch ChatGPT with the canonical persistent Chrome profile.
 * First login must always be headful. Same options as `npm run chatgpt:login`.
 */
export async function launchChatGptPersistentSession(options: {
  config: AppConfig;
  logger: Logger;
  downloadPath?: string;
}): Promise<ChatGptBrowserSession> {
  const { config, logger } = options;
  const profileDir = CHATGPT_PROFILE_DIR;
  ensureDir(profileDir);
  logChatGptProfileStartup(logger);

  logger.info(`Opening ChatGPT (persistent profile=${profileDir})`);

  const launchOptions = buildChatGptPersistentLaunchOptions(options.downloadPath);
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Chrome channel launch failed (${message}); falling back to Chromium`,
    );
    const { channel: _channel, ...withoutChannel } = launchOptions;
    context = await chromium.launchPersistentContext(profileDir, withoutChannel);
  }

  // Response wait uses its own non-blocking poll loop — never set default
  // locator timeout to CHATGPT_RESPONSE_TIMEOUT_MS (20m) or isVisible/evaluate hang.
  context.setDefaultTimeout(config.pageTimeoutMs);

  // Needed for bulk Phase-1 prompt paste (keyboard.insertText hangs on long text).
  await context
    .grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "https://chatgpt.com",
    })
    .catch(() => undefined);

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
 * Open ChatGPT and ensure the user is authenticated with strong login markers.
 * Project navigation is a separate step and is never classified as LOGIN_REQUIRED.
 * Does not close the browser. Does not write or delete a storageState file.
 */
export async function ensureChatGptLoggedIn(options: {
  page: Page;
  context: BrowserContext;
  config: AppConfig;
  logger: Logger;
  navigateToProject?: boolean;
}): Promise<void> {
  const { context, config, logger } = options;
  let page = options.page;
  const projectName = config.chatgptProjectName;

  logChatGptProfileStartup(logger);
  logger.info("Opening ChatGPT");
  await page.goto(config.chatgptUrl, {
    waitUntil: "domcontentloaded",
    timeout: Math.max(config.pageTimeoutMs, 60_000),
  });
  await page.waitForTimeout(2000);

  page = await resolveActiveChatGptPage(page);
  const existing = await inspectChatGptAuth(page, projectName);
  await logChatGptAuthDiagnostics({ page, logger, projectName });

  if (existing.state === CHATGPT_AUTH_READY) {
    logger.info("CHATGPT_EXISTING_SESSION_FOUND");
    await finalizeAuthenticatedSession({
      page,
      context,
      config,
      logger,
      existingSession: true,
    });
    if (options.navigateToProject) {
      await navigateToConfiguredProject({ page, config, logger });
    }
    return;
  }

  logger.info(CHATGPT_AUTH_REQUIRED);
  logger.info("PLEASE_LOGIN_MANUALLY_IN_THE_OPEN_BROWSER");
  console.log("");
  console.log("======================================================");
  console.log("  ChatGPT manual login");
  console.log("======================================================");
  console.log("Log in manually in the opened browser.");
  console.log("After the ChatGPT app shell appears (sidebar / composer),");
  console.log("this process auto-detects login. Project open is separate.");
  console.log(
    `Waiting up to ${Math.round(config.chatgptManualLoginTimeoutMs / 60000)} minutes...`,
  );
  console.log("======================================================");
  console.log("");

  const outcome = await waitForManualLogin({
    page,
    timeoutMs: config.chatgptManualLoginTimeoutMs,
    logger,
    projectName,
  });

  if (outcome.status === CHATGPT_AUTH_BROWSER_CLOSED) {
    throw new AutomationError(
      CHATGPT_AUTH_BROWSER_CLOSED,
      "Browser was closed during authentication wait",
    );
  }
  if (outcome.status === CHATGPT_AUTH_TIMEOUT) {
    throw new AutomationError(
      CHATGPT_AUTH_TIMEOUT,
      `Manual ChatGPT login did not complete within ${config.chatgptManualLoginTimeoutMs}ms`,
    );
  }

  page = await resolveActiveChatGptPage(page);

  if (!page.isClosed()) {
    const url = page.url().toLowerCase();
    if (!url.includes("chatgpt.com") || /\/auth\/login(?:\/|$)/.test(url)) {
      await page
        .goto(config.chatgptUrl, {
          waitUntil: "domcontentloaded",
          timeout: Math.max(config.pageTimeoutMs, 60_000),
        })
        .catch(() => undefined);
      await page.waitForTimeout(1500);
    }
  }

  const stable = await waitForChatGptAuthentication({
    page,
    timeoutMs: 30_000,
    logger,
    quiet: false,
    projectName,
  });
  if (stable.status === CHATGPT_AUTH_BROWSER_CLOSED) {
    throw new AutomationError(
      CHATGPT_AUTH_BROWSER_CLOSED,
      "Browser was closed during authentication wait",
    );
  }
  if (stable.status !== CHATGPT_AUTH_READY) {
    throw new AutomationError(
      "CHATGPT_AUTH_FAILED",
      "Login wait finished but ChatGPT application shell was not stable",
    );
  }

  await finalizeAuthenticatedSession({
    page,
    context,
    config,
    logger,
    existingSession: false,
  });

  if (options.navigateToProject) {
    await navigateToConfiguredProject({ page, config, logger });
  }
}

async function navigateToConfiguredProject(options: {
  page: Page;
  config: AppConfig;
  logger: Logger;
}): Promise<void> {
  const { page, config, logger } = options;
  if (!(await isChatGptAuthenticated(page))) {
    throw new AutomationError(
      CHATGPT_AUTH_REQUIRED,
      "Cannot open ChatGPT project because login is not ready",
    );
  }
  try {
    await openChatGptProject({
      page,
      projectName: config.chatgptProjectName,
      projectUrl: config.chatgptProjectUrl,
      projectMatch: config.chatgptProjectMatch,
      config,
      logger,
    });
    await logChatGptAuthDiagnostics({
      page,
      logger,
      projectName: config.chatgptProjectName,
    });
  } catch (error) {
    if (
      error instanceof AutomationError &&
      error.code === CHATGPT_AUTH_REQUIRED
    ) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error(CHATGPT_PROJECT_NAVIGATION_FAILED);
    throw new AutomationError(
      CHATGPT_PROJECT_NAVIGATION_FAILED,
      `Authenticated, but failed to open "${config.chatgptProjectName}": ${message}`,
    );
  }
}

async function finalizeAuthenticatedSession(options: {
  page: Page;
  context: BrowserContext;
  config: AppConfig;
  logger: Logger;
  existingSession: boolean;
}): Promise<void> {
  const { page, logger, existingSession } = options;
  const markers = await collectAuthMarkers(page, options.config.chatgptProjectName);
  logAuthMarkers(markers, logger);

  if (!(await isChatGptAuthenticated(page))) {
    throw new AutomationError(
      CHATGPT_AUTH_REQUIRED,
      "ChatGPT application shell was not authenticated",
    );
  }

  // Persistent profile is the session. Do not write or delete auth/chatgpt.json.
  logger.info("CHATGPT_PERSISTENT_PROFILE_AUTHORITATIVE=true");
  logger.info(`CHATGPT_PROFILE_DIR=${CHATGPT_PROFILE_DIR}`);
  if (!existingSession) {
    logger.info("CHATGPT_LOGIN_SUCCESS");
  }
  logger.info(CHATGPT_AUTH_READY);
  logger.info("CHATGPT_AUTHENTICATED");
  console.log("");
  console.log("ChatGPT authentication is ready (persistent profile).");
  console.log(`PROFILE=${CHATGPT_PROFILE_DIR}`);
}

async function waitForManualLogin(options: {
  page: Page;
  timeoutMs: number;
  logger: Logger;
  projectName: string;
}): Promise<{ status: "CHATGPT_AUTH_READY" | "CHATGPT_AUTH_TIMEOUT" | "CHATGPT_AUTH_BROWSER_CLOSED" }> {
  const { page, timeoutMs, logger, projectName } = options;

  let enterPressed = false;
  const rl = readline.createInterface({ input, output });
  const enterPromise = rl
    .question(
      "Press Enter after ChatGPT is logged in (or wait for auto-detect)... ",
    )
    .then(() => {
      enterPressed = true;
    })
    .catch(() => undefined);

  try {
    return await waitForChatGptAuthentication({
      page,
      timeoutMs,
      logger,
      quiet: false,
      projectName,
      onPoll: async () => {
        if (enterPressed) {
          enterPressed = false;
          logger.info(
            "Enter received — re-checking ChatGPT login markers (project title not required)",
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

async function resolveActiveChatGptPage(page: Page): Promise<Page> {
  if (page.isClosed()) {
    return page;
  }
  const context = page.context();
  const pages = context.pages().filter((p) => !p.isClosed());

  for (const p of pages) {
    if (await isChatGptAuthenticated(p)) {
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

/**
 * @deprecated Persistent profile is authoritative. Kept as a no-op so callers
 * do not write a parallel storageState file.
 */
export async function persistChatGptAuth(
  _context: BrowserContext,
  _config: AppConfig,
  logger: Logger,
): Promise<void> {
  logger.info("CHATGPT_STORAGE_STATE_SKIPPED=persistent profile is authoritative");
  logger.info(`CHATGPT_PROFILE_DIR=${CHATGPT_PROFILE_DIR}`);
}

function logAuthMarkers(markers: AuthMarkerSnapshot, logger: Logger): void {
  if (markers.shellLoaded) {
    logger.info("CHATGPT_APP_SHELL_VISIBLE");
  }
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

export function chatgptAuthExists(_config?: AppConfig): boolean {
  return chatgptProfileExists();
}

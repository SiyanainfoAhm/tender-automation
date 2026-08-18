/**
 * ChatGPT authentication vs project-navigation classification.
 * Login is proven by chatgpt.com session shell, not by project title text.
 */
import type { Page } from "playwright";
import type { Logger } from "../logger.js";

export const CHATGPT_AUTH_BROWSER_CLOSED = "CHATGPT_AUTH_BROWSER_CLOSED";
export const CHATGPT_AUTH_TIMEOUT = "CHATGPT_AUTH_TIMEOUT";
export const CHATGPT_AUTH_REQUIRED = "CHATGPT_AUTH_REQUIRED";
export const CHATGPT_AUTH_READY = "CHATGPT_AUTH_READY";
export const CHATGPT_PROJECT_NAVIGATION_FAILED = "CHATGPT_PROJECT_NAVIGATION_FAILED";

export type ChatGptAuthState =
  | typeof CHATGPT_AUTH_BROWSER_CLOSED
  | typeof CHATGPT_AUTH_REQUIRED
  | typeof CHATGPT_AUTH_READY;

export type ChatGptAuthWaitStatus =
  | typeof CHATGPT_AUTH_READY
  | typeof CHATGPT_AUTH_TIMEOUT
  | typeof CHATGPT_AUTH_BROWSER_CLOSED;

export type ChatGptAuthWaitOutcome = {
  status: ChatGptAuthWaitStatus;
};

export interface AuthMarkerSnapshot {
  url: string;
  urlOnChatGpt: boolean;
  notAuthLoginRoute: boolean;
  loginSignupAbsent: boolean;
  shellLoaded: boolean;
  sidebarVisible: boolean;
  composerVisible: boolean;
  projectsVisible: boolean;
  configuredProjectVisible: boolean;
  accountMenuVisible: boolean;
  workspaceMenuVisible: boolean;
  chatHistoryVisible: boolean;
  planOrAccountVisible: boolean;
  /** Login-strength markers only — project title is excluded. */
  strongLoginCount: number;
  /** @deprecated alias of strongLoginCount */
  strongCount: number;
}

export function isChatGptBrowserGone(page: Page): boolean {
  try {
    if (page.isClosed()) return true;
    void page.url();
    return false;
  } catch {
    return true;
  }
}

export function isChatGptAuthLoginUrl(url: string): boolean {
  const lower = url.toLowerCase();
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host.includes("accounts.google.com")) return true;
    if (host.includes("login.microsoftonline.com")) return true;
    if (host.includes("login.live.com")) return true;
    if (host.includes("auth0.com")) return true;
    if (host.includes("login.openai.com")) return true;
    if (host.includes("auth.openai.com")) return true;
    if (host.includes("chatgpt.com") && /\/auth\/login(?:\/|$)/.test(path)) {
      return true;
    }
  } catch {
    if (lower.includes("/auth/login")) return true;
  }
  return (
    lower.includes("login.openai.com") ||
    lower.includes("auth.openai.com") ||
    lower.includes("accounts.google.com")
  );
}

export function isChatGptAppUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (!lower.includes("chatgpt.com")) return false;
  return !isChatGptAuthLoginUrl(url);
}

/** Detect logged-out ChatGPT landing / marketing UI. */
export async function isChatGptLoggedOut(page: Page): Promise<boolean> {
  if (isChatGptBrowserGone(page)) {
    return true;
  }
  if (isChatGptAuthLoginUrl(page.url())) {
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

  const anyLogin = page.getByText(/^Log in$/i).first();
  if (await anyLogin.isVisible().catch(() => false)) {
    const roleLogin = page
      .locator("a, button")
      .filter({ hasText: /^Log in$/i })
      .first();
    if (await roleLogin.isVisible().catch(() => false)) {
      return true;
    }
  }

  return false;
}

export async function collectAuthMarkers(
  page: Page,
  projectName = "",
): Promise<AuthMarkerSnapshot> {
  const url = page.isClosed() ? "" : page.url();
  const urlOnChatGpt = /chatgpt\.com/i.test(url);
  const notAuthLoginRoute = !isChatGptAuthLoginUrl(url);

  const sidebarVisible =
    (await page
      .locator("nav, aside, [data-testid*='sidebar' i], [class*='sidebar' i]")
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await page
      .locator("[data-testid='sidebar'], #stage-sidebar")
      .first()
      .isVisible()
      .catch(() => false));

  const composerVisible =
    (await page
      .locator(
        '#prompt-textarea, [contenteditable="true"]#prompt-textarea, [data-testid="send-button"]',
      )
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await page
      .locator('[contenteditable="true"][aria-label*="Message" i], [contenteditable="true"][aria-label*="chat" i]')
      .first()
      .isVisible()
      .catch(() => false));

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
      .catch(() => false));

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
        .locator(
          `[aria-label*="${cssEscapeAttr(projectName)}" i], [title*="${cssEscapeAttr(projectName)}" i]`,
        )
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

  const loginSignupAbsent = !(await isChatGptLoggedOut(page));
  const shellLoaded =
    sidebarVisible ||
    composerVisible ||
    accountMenuVisible ||
    workspaceMenuVisible ||
    chatHistoryVisible ||
    projectsVisible;

  const loginFlags = [
    urlOnChatGpt,
    notAuthLoginRoute,
    loginSignupAbsent,
    shellLoaded,
  ];
  const strongLoginCount = loginFlags.filter(Boolean).length;

  return {
    url,
    urlOnChatGpt,
    notAuthLoginRoute,
    loginSignupAbsent,
    shellLoaded,
    sidebarVisible,
    composerVisible,
    projectsVisible,
    configuredProjectVisible,
    accountMenuVisible,
    workspaceMenuVisible,
    chatHistoryVisible,
    planOrAccountVisible,
    strongLoginCount,
    strongCount: strongLoginCount,
  };
}

/**
 * Strong ChatGPT login check.
 * Does NOT require the configured project title to be visible.
 */
export async function isChatGptAuthenticated(page: Page): Promise<boolean> {
  if (isChatGptBrowserGone(page)) {
    return false;
  }
  const url = page.url();
  if (!isChatGptAppUrl(url)) {
    return false;
  }
  if (await isChatGptLoggedOut(page)) {
    return false;
  }
  const markers = await collectAuthMarkers(page);
  return markers.shellLoaded;
}

export async function isChatGptProjectAccessible(
  page: Page,
  projectName: string,
): Promise<boolean> {
  if (isChatGptBrowserGone(page) || !(await isChatGptAuthenticated(page))) {
    return false;
  }
  const url = page.url().toLowerCase();
  if (url.includes("/g/g-p-") && url.includes("/project")) {
    return true;
  }
  const markers = await collectAuthMarkers(page, projectName);
  return markers.configuredProjectVisible;
}

export async function inspectChatGptAuth(
  page: Page,
  projectName = "",
): Promise<{
  state: ChatGptAuthState;
  url: string;
  projectAccessible: boolean;
  markers: AuthMarkerSnapshot;
}> {
  if (isChatGptBrowserGone(page)) {
    return {
      state: CHATGPT_AUTH_BROWSER_CLOSED,
      url: "",
      projectAccessible: false,
      markers: emptyMarkers(),
    };
  }
  const markers = await collectAuthMarkers(page, projectName);
  const authenticated = await isChatGptAuthenticated(page);
  const state: ChatGptAuthState = authenticated
    ? CHATGPT_AUTH_READY
    : CHATGPT_AUTH_REQUIRED;
  return {
    state,
    url: markers.url,
    projectAccessible: authenticated
      ? await isChatGptProjectAccessible(page, projectName)
      : false,
    markers,
  };
}

export async function logChatGptAuthDiagnostics(options: {
  page: Page;
  logger: Logger;
  projectName?: string;
}): Promise<{
  state: ChatGptAuthState;
  url: string;
  projectAccessible: boolean;
}> {
  const { page, logger, projectName = "" } = options;
  const inspected = await inspectChatGptAuth(page, projectName);
  logger.info(`CHATGPT_AUTH_STATE=${inspected.state}`);
  logger.info(`CHATGPT_CURRENT_URL=${inspected.url || "<closed>"}`);
  logger.info(`CHATGPT_PROJECT_ACCESSIBLE=${inspected.projectAccessible}`);
  return inspected;
}

/**
 * Poll until login is stable, the browser is closed, or the timeout elapses.
 * Browser close is never reported as a timeout.
 */
export async function waitForChatGptAuthentication(options: {
  page: Page;
  timeoutMs?: number;
  logger: Logger;
  quiet?: boolean;
  projectName?: string;
  onPoll?: () => Promise<void>;
}): Promise<ChatGptAuthWaitOutcome> {
  const { page, logger, quiet = false, projectName = "" } = options;
  const timeoutMs = options.timeoutMs;
  const deadline =
    timeoutMs == null || !Number.isFinite(timeoutMs) || timeoutMs <= 0
      ? Number.POSITIVE_INFINITY
      : Date.now() + timeoutMs;
  let authenticatedStreak = 0;

  while (true) {
    if (isChatGptBrowserGone(page)) {
      if (!quiet) {
        logger.error(CHATGPT_AUTH_BROWSER_CLOSED);
        logger.error("Browser was closed during authentication wait");
      }
      return { status: CHATGPT_AUTH_BROWSER_CLOSED };
    }

    if (Date.now() >= deadline) {
      if (!quiet) {
        logger.error(CHATGPT_AUTH_TIMEOUT);
      }
      return { status: CHATGPT_AUTH_TIMEOUT };
    }

    const inspected = await inspectChatGptAuth(page, projectName);
    if (inspected.state === CHATGPT_AUTH_READY) {
      authenticatedStreak += 1;
      if (!quiet && authenticatedStreak === 1) {
        logger.info(CHATGPT_AUTH_READY);
      }
    } else {
      authenticatedStreak = 0;
    }

    if (authenticatedStreak >= 3) {
      if (!quiet) {
        logger.info("CHATGPT_AUTH_STABLE");
      }
      return { status: CHATGPT_AUTH_READY };
    }

    if (options.onPoll) {
      await options.onPoll();
    }

    await page.waitForTimeout(1000).catch(() => undefined);
  }
}

function emptyMarkers(): AuthMarkerSnapshot {
  return {
    url: "",
    urlOnChatGpt: false,
    notAuthLoginRoute: true,
    loginSignupAbsent: false,
    shellLoaded: false,
    sidebarVisible: false,
    composerVisible: false,
    projectsVisible: false,
    configuredProjectVisible: false,
    accountMenuVisible: false,
    workspaceMenuVisible: false,
    chatHistoryVisible: false,
    planOrAccountVisible: false,
    strongLoginCount: 0,
    strongCount: 0,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssEscapeAttr(value: string): string {
  return value.replace(/["\\]/g, "");
}

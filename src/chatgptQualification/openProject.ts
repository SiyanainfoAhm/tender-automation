import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { isChatGptLoggedOut } from "./chatgptAuthState.js";

const PROJECT_CACHE_PATH = resolveProjectPath("auth", "chatgpt-project.json");

interface ProjectCache {
  projectName: string;
  projectUrl: string;
  discoveredAt: string;
}

/**
 * Open the ChatGPT Project using validated CHATGPT_PROJECT_URL first.
 * Sidebar visibility alone never counts as Project Home opened.
 */
export async function openChatGptProject(options: {
  page: Page;
  projectName: string;
  logger: Logger;
  projectUrl?: string | null;
  projectMatch?: string | null;
  config?: AppConfig;
}): Promise<void> {
  const { page, logger } = options;
  const projectName =
    options.projectName.trim() ||
    options.config?.chatgptProjectName?.trim() ||
    "Siyana Tender Qualification Automation";
  const projectMatch = (
    options.projectMatch ||
    options.config?.chatgptProjectMatch ||
    "Siyana Tender Quali"
  ).trim();

  const projectUrl = resolveConfiguredProjectUrl({
    projectUrl: options.projectUrl,
    config: options.config,
    projectName,
    logger,
  });

  const opened = await navigateToProjectHomeDirect({
    page,
    projectUrl,
    projectName,
    projectMatch,
    logger,
  });
  if (opened) {
    return;
  }

  // Sidebar click fallback after two failed direct navigations
  const sidebarOpened = await openProjectViaSidebarFallback({
    page,
    projectName,
    projectMatch,
    logger,
  });
  if (sidebarOpened) {
    return;
  }

  await logProjectHomeDiagnostics(page, projectName, logger);
  throw new AutomationError(
    "CHATGPT_PROJECT_NAVIGATION_FAILED",
    `CHATGPT_PROJECT_NAVIGATION_FAILED Failed to open Project Home for "${projectName}" (url=${page.url()})`,
  );
}

/** Resolve and validate CHATGPT_PROJECT_URL. Throws CHATGPT_PROJECT_URL_INVALID. */
export function resolveConfiguredProjectUrl(options: {
  projectUrl?: string | null;
  config?: AppConfig;
  projectName: string;
  logger: Logger;
}): string {
  const configured = (
    options.projectUrl ||
    options.config?.chatgptProjectUrl ||
    ""
  ).trim();

  // Prefer env/config; fall back to cached discovered URL only if it validates
  const cached = loadProjectCache(options.projectName)?.projectUrl?.trim() || "";
  const candidate = configured || cached;

  options.logger.info(`CHATGPT_CONFIGURED_PROJECT_URL=${candidate || "<blank>"}`);

  if (!isValidChatGptProjectUrl(candidate)) {
    throw new AutomationError(
      "CHATGPT_PROJECT_URL_INVALID",
      `CHATGPT_PROJECT_URL must start with https://chatgpt.com/, contain /g/g-p-, and end with /project (got: ${candidate || "<blank>"})`,
    );
  }

  return candidate.replace(/\/+$/, "").endsWith("/project")
    ? candidate.replace(/\/+$/, "")
    : candidate;
}

export function isValidChatGptProjectUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  if (!trimmed.startsWith("https://chatgpt.com/")) {
    return false;
  }
  if (!trimmed.includes("/g/g-p-")) {
    return false;
  }
  try {
    const pathname = new URL(trimmed).pathname.replace(/\/+$/, "");
    return pathname.endsWith("/project");
  } catch {
    return false;
  }
}

export function isProjectHomeUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return pathname.includes("/g/g-p-") && /\/project(?:\/|$)/i.test(pathname);
  } catch {
    return url.includes("/g/g-p-") && url.includes("/project");
  }
}

/**
 * Hard gate before any tender upload/prompt work.
 * Global ChatGPT home is never acceptable.
 */
export function assertProjectHomeOpen(page: Page): void {
  const currentUrl = page.url();
  if (!isProjectHomeUrl(currentUrl)) {
    throw new AutomationError(
      "CHATGPT_PROJECT_HOME_NOT_OPEN",
      `CHATGPT_PROJECT_HOME_NOT_OPEN currentUrl=${currentUrl}`,
    );
  }
}

async function navigateToProjectHomeDirect(options: {
  page: Page;
  projectUrl: string;
  projectName: string;
  projectMatch: string;
  logger: Logger;
}): Promise<boolean> {
  const { page, projectUrl, projectName, projectMatch, logger } = options;

  // ONE goto only — never retry-goto the same page (hydration ≠ failure).
  logger.info("CHATGPT_PROJECT_DIRECT_NAVIGATION_START");
  const { chatGptPageGoto, isAtOrPastComposerReady } = await import(
    "./tenderPageNav.js"
  );
  if (isAtOrPastComposerReady(page)) {
    throw new AutomationError(
      "CHATGPT_NAVIGATION_FORBIDDEN_AFTER_COMPOSER_READY",
      "navigateToProjectHomeDirect blocked — composer already ready",
    );
  }
  await chatGptPageGoto(page, projectUrl, {
    reason: "navigateToProjectHomeDirect",
    logger,
    waitUntil: "domcontentloaded",
    timeout: 120_000,
    untracked: true,
  });
  logger.info("CHATGPT_PROJECT_DIRECT_NAVIGATION_COMPLETE");

  // Read-only wait for hydration (no second goto).
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const currentUrl = page.url();
    logger.info(`CHATGPT_CURRENT_URL=${currentUrl}`);
    if (isChatGptHomeUrl(currentUrl) || !isProjectHomeUrl(currentUrl)) {
      await page.waitForTimeout(1_000);
      continue;
    }
    const verified = await verifyProjectHomeContent({
      page,
      projectName,
      projectMatch,
      logger,
    });
    if (verified) {
      logger.info("CHATGPT_PROJECT_HOME_OPENED");
      logger.info(`CHATGPT_PROJECT_OPENED=${projectName}`);
      persistProjectUrlFromPage(page, projectName, logger);
      return true;
    }
    await page.waitForTimeout(1_000);
  }

  logger.warn("CHATGPT_PROJECT_DIRECT_NAVIGATION_NOT_VERIFIED_AFTER_WAIT");
  return isProjectHomeUrl(page.url());
}

async function openProjectViaSidebarFallback(options: {
  page: Page;
  projectName: string;
  projectMatch: string;
  logger: Logger;
}): Promise<boolean> {
  const { page, projectName, projectMatch, logger } = options;

  await prepareSidebarForLookup(page, logger);
  await ensureProjectsSectionExpanded(page, projectMatch, projectName, logger);

  const nameRe = new RegExp(
    escapeRegExp(projectName).replace(/\s+/g, "\\s+"),
    "i",
  );
  const matchRe = new RegExp(
    escapeRegExp(projectMatch).replace(/\s+/g, "\\s+"),
    "i",
  );

  const sidebarRoots = page.locator(
    "nav, aside, [data-testid*='sidebar'], [class*='sidebar' i]",
  );
  const candidates = sidebarRoots
    .getByText(nameRe)
    .or(sidebarRoots.getByText(matchRe));

  const count = await candidates.count().catch(() => 0);
  let clicked = false;
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    const clickable = candidate
      .locator(
        'xpath=ancestor-or-self::a[1] | ancestor-or-self::button[1] | ancestor-or-self::*[@role="button"][1] | ancestor-or-self::*[@role="link"][1]',
      )
      .first();
    if ((await clickable.count().catch(() => 0)) > 0) {
      await clickable.click({ timeout: 10_000 });
    } else {
      await candidate.click({ timeout: 10_000 });
    }
    clicked = true;
    logger.info("CHATGPT_PROJECT_SIDEBAR_FALLBACK_CLICKED");
    break;
  }

  if (!clicked) {
    // Last resort: any visible page text match in sidebar-like interactive control
    const fallback = page.getByText(nameRe).first();
    if (await fallback.isVisible().catch(() => false)) {
      await fallback.click({ timeout: 10_000 }).catch(() => undefined);
      clicked = true;
      logger.info("CHATGPT_PROJECT_SIDEBAR_FALLBACK_CLICKED");
    }
  }

  if (!clicked) {
    return false;
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    const currentUrl = page.url();
    logger.info(`CHATGPT_CURRENT_URL=${currentUrl}`);
    if (!isProjectHomeUrl(currentUrl)) {
      continue;
    }
    const verified = await verifyProjectHomeContent({
      page,
      projectName,
      projectMatch,
      logger,
    });
    if (verified) {
      logger.info("CHATGPT_PROJECT_HOME_OPENED");
      logger.info(`CHATGPT_PROJECT_OPENED=${projectName}`);
      persistProjectUrlFromPage(page, projectName, logger);
      return true;
    }
  }

  return false;
}

/**
 * Require Project Home signals. Sidebar-only visibility is not enough.
 * Needs the /project URL plus at least one additional central-page signal
 * (heading / Chats / Sources / project composer) — total ≥ 2 including URL.
 */
export async function verifyProjectHomeContent(options: {
  page: Page;
  projectName: string;
  projectMatch: string;
  logger: Logger;
}): Promise<boolean> {
  const { page, projectName, logger } = options;
  const url = page.url();
  let score = 0;

  if (isProjectHomeUrl(url)) {
    score += 1;
  } else {
    return false;
  }

  const headingVisible = await isCentralProjectHeadingVisible(page, projectName);
  if (headingVisible) {
    logger.info("CHATGPT_PROJECT_HEADING_VISIBLE");
    score += 1;
  }

  const chatsTab = page
    .getByRole("tab", { name: /^Chats$/i })
    .or(page.getByRole("button", { name: /^Chats$/i }))
    .or(page.getByText(/^Chats$/i))
    .first();
  if (await chatsTab.isVisible().catch(() => false)) {
    score += 1;
  }

  const sourcesTab = page
    .getByRole("tab", { name: /^Sources$/i })
    .or(page.getByRole("button", { name: /^Sources$/i }))
    .or(page.getByText(/^Sources$/i))
    .first();
  if (await sourcesTab.isVisible().catch(() => false)) {
    score += 1;
  }

  if (await isProjectScopedComposerVisible(page, projectName)) {
    score += 1;
  }

  // Reject global home composer phrasing as evidence
  const globalHelp = page.getByText(/What can I help with\?/i).first();
  if (
    (await globalHelp.isVisible().catch(() => false)) &&
    !headingVisible &&
    score < 3
  ) {
    return false;
  }

  return score >= 2;
}

async function isCentralProjectHeadingVisible(
  page: Page,
  projectName: string,
): Promise<boolean> {
  const headingPattern = new RegExp(`^${escapeRegExp(projectName)}$`, "i");

  // Prefer main/content headings — avoid counting sidebar-only text as the central heading
  const main = page.locator("main, [role='main']").first();
  if ((await main.count().catch(() => 0)) > 0) {
    const inMain = await main
      .getByRole("heading", { name: headingPattern })
      .first()
      .isVisible()
      .catch(() => false);
    if (inMain) {
      return true;
    }
    const textInMain = await main
      .getByText(headingPattern)
      .first()
      .isVisible()
      .catch(() => false);
    if (textInMain) {
      return true;
    }
  }

  return page
    .getByRole("heading", { name: headingPattern })
    .first()
    .isVisible()
    .catch(() => false);
}

async function isProjectScopedComposerVisible(
  page: Page,
  projectName: string,
): Promise<boolean> {
  // Project composers often include "New chat in <Project Name>"
  const projectComposer = page
    .locator(
      [
        `[contenteditable="true"][aria-label*="${cssAttr(projectName)}" i]`,
        `[contenteditable="true"][data-placeholder*="New chat in" i]`,
        `textarea[placeholder*="New chat in" i]`,
        `[contenteditable="true"][aria-label*="New chat in" i]`,
      ].join(","),
    )
    .filter({ visible: true })
    .first();

  if (await projectComposer.isVisible().catch(() => false)) {
    // Ensure we are not on global home
    const globalHelp = page.getByText(/What can I help with\?/i).first();
    if (await globalHelp.isVisible().catch(() => false)) {
      // Still allow if project heading is present in main
      return isCentralProjectHeadingVisible(page, projectName);
    }
    return true;
  }
  return false;
}

function cssAttr(value: string): string {
  return value.replace(/["\\]/g, "");
}

async function prepareSidebarForLookup(
  page: Page,
  logger: Logger,
): Promise<void> {
  if (!page.url().includes("chatgpt.com")) {
    await page.goto("https://chatgpt.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }

  // Open sidebar if collapsed
  const openSidebar = page
    .getByRole("button", { name: /open\s+sidebar|show\s+sidebar/i })
    .first();
  if (await openSidebar.isVisible().catch(() => false)) {
    await openSidebar.click({ timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isChatGptLoggedOut(page)) {
      await page.waitForTimeout(1000);
      continue;
    }
    const projectsVisible = await page
      .getByText(/^Projects$/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (projectsVisible) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  // Extra hydration time — do not search immediately after navigation
  await page.waitForTimeout(2000);
  logger.info("CHATGPT_SIDEBAR_READY");
}

/**
 * Expand the Projects section once if the configured project is not visible.
 * Collapsed UI shows "Projects >" — clicking again can re-collapse, so only
 * click when the project is still hidden, and verify by waiting for project items.
 */
async function ensureProjectsSectionExpanded(
  page: Page,
  projectMatch: string,
  projectName: string,
  logger: Logger,
): Promise<void> {
  const projectLocator = page
    .getByText(new RegExp(escapeRegExp(projectMatch), "i"))
    .first();

  let projectVisible = await projectLocator
    .isVisible()
    .catch(() => false);

  if (projectVisible) {
    logger.info(`CHATGPT_PROJECT_PARTIAL_MATCH=${projectMatch}`);
    return;
  }

  logger.info("CHATGPT_PROJECTS_SECTION_COLLAPSED_OR_PROJECT_HIDDEN");

  const projectsHeading = page.getByText(/^Projects$/i).first();
  await projectsHeading.waitFor({
    state: "visible",
    timeout: 15_000,
  });

  // Click once: prefer chevron/button in the Projects row, else the heading text
  const expandedByClick = await clickProjectsExpandControl(
    page,
    projectsHeading,
    logger,
  );
  if (!expandedByClick) {
    await projectsHeading.click({ timeout: 8_000 });
  }

  await page.waitForTimeout(1500);

  // Verify expansion by waiting for the partial project name (or any project item)
  const verifyDeadline = Date.now() + 10_000;
  while (Date.now() < verifyDeadline) {
    projectVisible = await projectLocator.isVisible().catch(() => false);
    if (projectVisible) {
      break;
    }
    // Any project-like link under sidebar after expand
    const anyProjectItem = page
      .locator("nav a[href], aside a[href]")
      .filter({ hasText: /siyana|tender|qualif/i })
      .first();
    if (await anyProjectItem.isVisible().catch(() => false)) {
      projectVisible = await projectLocator.isVisible().catch(() => false);
      if (projectVisible) {
        break;
      }
      // Section expanded even if exact match not yet hydrated
      break;
    }
    await page.waitForTimeout(500);
  }

  logger.info("CHATGPT_PROJECTS_SECTION_EXPANDED");
  logger.info(`CHATGPT_PROJECT_PARTIAL_MATCH=${projectMatch}`);

  projectVisible = await projectLocator.isVisible().catch(() => false);
  if (!projectVisible) {
    // Do not throw yet — caller still runs href/button search after hydration
    logger.warn(
      `Project "${projectName}" not immediately visible after expand — continuing search`,
    );
  }
}

async function clickProjectsExpandControl(
  page: Page,
  projectsHeading: Locator,
  logger: Logger,
): Promise<boolean> {
  // Prefer an associated button (chevron) on the Projects row
  const projectsRow = projectsHeading.locator("xpath=..");
  const expandButton = projectsRow.locator("button").first();
  if ((await expandButton.count().catch(() => 0)) > 0) {
    const ariaExpanded = await expandButton
      .getAttribute("aria-expanded")
      .catch(() => null);
    if (ariaExpanded === "true") {
      logger.info("CHATGPT_PROJECTS_ALREADY_ARIA_EXPANDED");
      return true;
    }
    await expandButton.click({ timeout: 8_000 });
    logger.info("CHATGPT_PROJECTS_CHEVRON_CLICKED");
    return true;
  }

  // Ancestor button wrapping "Projects"
  const ancestorButton = projectsHeading
    .locator('xpath=ancestor-or-self::button[1]')
    .first();
  if ((await ancestorButton.count().catch(() => 0)) > 0) {
    const ariaExpanded = await ancestorButton
      .getAttribute("aria-expanded")
      .catch(() => null);
    if (ariaExpanded === "true") {
      logger.info("CHATGPT_PROJECTS_ALREADY_ARIA_EXPANDED");
      return true;
    }
    await ancestorButton.click({ timeout: 8_000 });
    logger.info("CHATGPT_PROJECTS_ROW_BUTTON_CLICKED");
    return true;
  }

  // Role button named Projects
  const roleButton = page.getByRole("button", { name: /^Projects$/i }).first();
  if (await roleButton.isVisible().catch(() => false)) {
    const ariaExpanded = await roleButton
      .getAttribute("aria-expanded")
      .catch(() => null);
    if (ariaExpanded === "true") {
      return true;
    }
    await roleButton.click({ timeout: 8_000 });
    logger.info("CHATGPT_PROJECTS_ROLE_BUTTON_CLICKED");
    return true;
  }

  return false;
}

function isChatGptHomeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return (
      (u.hostname.includes("chatgpt.com") || u.hostname.includes("chat.openai.com")) &&
      (path === "/" || path === "")
    );
  } catch {
    return false;
  }
}


function loadProjectCache(projectName: string): ProjectCache | null {
  try {
    if (!fs.existsSync(PROJECT_CACHE_PATH)) {
      return null;
    }
    const data = JSON.parse(
      fs.readFileSync(PROJECT_CACHE_PATH, "utf8"),
    ) as ProjectCache;
    if (!data.projectUrl) {
      return null;
    }
    // Prefer cache for same project name; still allow if name missing
    if (
      data.projectName &&
      data.projectName.toLowerCase() !== projectName.toLowerCase()
    ) {
      // still usable if URL present — names can differ slightly
    }
    return data;
  } catch {
    return null;
  }
}

function saveProjectCache(cache: ProjectCache): void {
  try {
    ensureDir(path.dirname(PROJECT_CACHE_PATH));
    fs.writeFileSync(PROJECT_CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // non-fatal
  }
}

/**
 * Ensure Project home is open so the composer is scoped to the project.
 * Requires a real /g/g-p-.../project URL — sidebar visibility is not enough.
 */
export async function ensureProjectHome(options: {
  page: Page;
  projectName: string;
  logger: Logger;
  projectMatch?: string | null;
  projectUrl?: string | null;
  config?: AppConfig;
}): Promise<Locator> {
  const { page, projectName, logger } = options;
  const projectMatch =
    options.projectMatch?.trim() ||
    projectName.replace(/\s+Automation$/i, "").trim() ||
    "Siyana Tender Qualification";

  const { isAtOrPastComposerReady } = await import("./tenderPageNav.js");

  // Fresh-tender lifecycle: never re-navigate after COMPOSER_READY.
  if (isAtOrPastComposerReady(page)) {
    if (!isProjectHomeUrl(page.url())) {
      throw new AutomationError(
        "CHATGPT_NAVIGATION_FORBIDDEN_AFTER_COMPOSER_READY",
        `ensureProjectHome blocked after COMPOSER_READY url=${page.url()}`,
      );
    }
    logger.info("CHATGPT_PROJECT_HOME_READY_SKIP_NAV=true");
    assertProjectHomeOpen(page);
    return getProjectComposerLocator(page);
  }

  if (isProjectHomeUrl(page.url())) {
    // Already on project URL — poll content read-only; do NOT goto again.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const ready = await verifyProjectHomeContent({
        page,
        projectName,
        projectMatch,
        logger,
      });
      if (ready) {
        assertProjectHomeOpen(page);
        logger.info("CHATGPT_PROJECT_HOME_READY");
        return getProjectComposerLocator(page);
      }
      await page.waitForTimeout(750);
    }
    // Soft accept: URL is project home even if decorative UI is slow.
    if (isProjectHomeUrl(page.url())) {
      logger.info("CHATGPT_PROJECT_HOME_READY_URL_ONLY=true");
      assertProjectHomeOpen(page);
      return getProjectComposerLocator(page);
    }
  }

  // Prefer configured project URL navigation (auth must already be done by caller)
  try {
    const projectUrl = resolveConfiguredProjectUrl({
      projectUrl: options.projectUrl,
      config: options.config,
      projectName,
      logger,
    });
    const opened = await navigateToProjectHomeDirect({
      page,
      projectUrl,
      projectName,
      projectMatch,
      logger,
    });
    if (opened) {
      assertProjectHomeOpen(page);
      logger.info("CHATGPT_PROJECT_HOME_READY");
      return getProjectComposerLocator(page);
    }

    const sidebarOpened = await openProjectViaSidebarFallback({
      page,
      projectName,
      projectMatch,
      logger,
    });
    if (sidebarOpened) {
      assertProjectHomeOpen(page);
      logger.info("CHATGPT_PROJECT_HOME_READY");
      return getProjectComposerLocator(page);
    }
  } catch (error) {
    if (
      error instanceof AutomationError &&
      (error.code === "CHATGPT_PROJECT_URL_INVALID" ||
        error.code === "CHATGPT_NAVIGATION_FORBIDDEN_AFTER_COMPOSER_READY" ||
        error.code === "CHATGPT_PROJECT_NAVIGATION_LOOP" ||
        error.code === "CHATGPT_RELOAD_FORBIDDEN")
    ) {
      throw error;
    }
    logger.warn(
      `ensureProjectHome navigation issue: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  await logProjectHomeDiagnostics(page, projectName, logger);
  assertProjectHomeOpen(page);
  throw new AutomationError(
    "CHATGPT_PROJECT_HOME_NOT_READY",
    `Project home not ready for "${projectName}"`,
  );
}

/** @deprecated Prefer ensureProjectHome */
export async function startNewProjectChat(
  page: Page,
  logger: Logger,
  projectName = "Siyana Tender Qualification Automation",
): Promise<void> {
  await ensureProjectHome({ page, projectName, logger });
}

const PROJECT_PLACEHOLDER_RE =
  /New chat in Siyana Tender Qualification Automation/i;

function getProjectPlaceholderAnchor(page: Page): Locator {
  return page
    .getByText(PROJECT_PLACEHOLDER_RE)
    .or(page.locator('[data-placeholder*="New chat in"]'))
    .or(page.locator('[contenteditable="true"][aria-label*="New chat in"]'))
    .or(page.locator('textarea[placeholder*="New chat in"]'))
    .or(page.locator('[contenteditable="true"]#prompt-textarea'))
    .or(page.locator('[contenteditable="true"]'))
    .first();
}

function urlLooksLikeProjectHome(url: string): boolean {
  return isProjectHomeUrl(url);
}

async function isProjectPageReady(
  page: Page,
  projectName: string,
): Promise<boolean> {
  if (!isProjectHomeUrl(page.url())) {
    return false;
  }
  return isCentralProjectHeadingVisible(page, projectName);
}

/**
 * Project is ready when URL is a real /g/g-p-.../project page and
 * Project Home content signals are present. Global homepage is rejected.
 */
export async function waitForProjectHomeReady(
  page: Page,
  projectName: string,
  logger: Logger,
  timeoutMs = 30_000,
): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  let headingLogged = false;

  while (Date.now() < deadline) {
    const urlOk = isProjectHomeUrl(page.url());
    const headingVisible = await isCentralProjectHeadingVisible(
      page,
      projectName,
    );

    if (headingVisible && !headingLogged) {
      logger.info("CHATGPT_PROJECT_HEADING_VISIBLE");
      headingLogged = true;
    }

    if (urlOk) {
      const contentOk = await verifyProjectHomeContent({
        page,
        projectName,
        projectMatch: projectName,
        logger,
      });
      if (contentOk) {
        persistProjectUrlFromPage(page, projectName, logger);
        logger.info("CHATGPT_PROJECT_HOME_OPENED");
        logger.info("CHATGPT_PROJECT_HOME_READY");
        return getProjectComposerLocator(page);
      }
    }

    await page.waitForTimeout(300);
  }

  if (await isProjectPageReady(page, projectName)) {
    if (!headingLogged) {
      logger.info("CHATGPT_PROJECT_HEADING_VISIBLE");
    }
    persistProjectUrlFromPage(page, projectName, logger);
    logger.info("CHATGPT_PROJECT_HOME_OPENED");
    logger.info("CHATGPT_PROJECT_HOME_READY");
    return getProjectComposerLocator(page);
  }

  await logProjectHomeDiagnostics(page, projectName, logger);
  throw new AutomationError(
    "CHATGPT_PROJECT_HOME_NOT_READY",
    `Project page not ready for "${projectName}" within ${timeoutMs}ms (url=${page.url()})`,
  );
}

/** Visible Project Home composer (full page; not main-scoped). */
export function getProjectComposerLocator(page: Page): Locator {
  // Prefer the visible ProseMirror editor; avoid the hidden fallback textarea.
  return page
    .locator(
      [
        '[contenteditable="true"][aria-label*="New chat in"]',
        '[contenteditable="true"][data-placeholder*="New chat in"]',
        '[contenteditable="true"]#prompt-textarea',
        'textarea[placeholder*="New chat in"]',
        '[contenteditable="true"]',
      ].join(","),
    )
    .filter({ visible: true })
    .first();
}

/** Composer container near the visible Project Home placeholder / editor. */
export function getProjectComposerContainer(page: Page): Locator {
  const placeholder = getProjectPlaceholderAnchor(page);
  return placeholder.locator(
    'xpath=ancestor::*[.//button or .//*[@contenteditable="true"]][1]',
  );
}

/**
 * Plus button immediately left of the Project Home composer.
 * Does not use the global sidebar "New chat" control.
 */
export async function findProjectComposerPlusButton(
  page: Page,
): Promise<Locator | null> {
  const composerContainer = getProjectComposerContainer(page);
  const primary = composerContainer
    .locator("button")
    .filter({ has: page.locator("svg") })
    .first();

  if (await primary.isVisible().catch(() => false)) {
    return primary;
  }

  const placeholder = getProjectPlaceholderAnchor(page);
  const preceding = placeholder.locator("xpath=preceding::button[1]");
  if (await preceding.isVisible().catch(() => false)) {
    return preceding;
  }

  const fallbacks = [
    composerContainer.locator('[data-testid="composer-plus-btn"]').first(),
    composerContainer.locator('button[aria-label*="Add files" i]').first(),
    composerContainer.locator('button[aria-label*="Attach" i]').first(),
    composerContainer.locator('button[aria-label*="Upload" i]').first(),
    page
      .locator(
        '[contenteditable="true"][aria-label*="New chat in"], textarea[placeholder*="New chat in"], [contenteditable="true"]#prompt-textarea',
      )
      .first()
      .locator("xpath=ancestor::*[.//button][1]//button")
      .filter({ has: page.locator("svg") })
      .first(),
  ];

  for (const candidate of fallbacks) {
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }
  return null;
}

/** @deprecated Prefer getProjectComposerContainer — kept for callers. */
export async function getMainComposerRoot(page: Page): Promise<Locator> {
  return getProjectComposerContainer(page);
}

function persistProjectUrlFromPage(
  page: Page,
  projectName: string,
  logger: Logger,
): void {
  const current = page.url();
  if (!current || isChatGptHomeUrl(current)) {
    return;
  }
  logger.info(`CHATGPT_PROJECT_URL=${current}`);
  saveProjectCache({
    projectName,
    projectUrl: current,
    discoveredAt: new Date().toISOString(),
  });
}

export async function logProjectHomeDiagnostics(
  page: Page,
  projectName: string,
  logger: Logger,
): Promise<void> {
  const headingOk = await page
    .getByText(new RegExp(`^${escapeRegExp(projectName)}$`, "i"))
    .first()
    .isVisible()
    .catch(() => false);

  const url = page.url();
  const projectUrlOk = urlLooksLikeProjectHome(url);

  const contentEditableCount = await page
    .locator('[contenteditable="true"]')
    .count()
    .catch(() => 0);
  const textareaCount = await page.locator("textarea").count().catch(() => 0);
  const fileInputCount = await page
    .locator('input[type="file"]')
    .count()
    .catch(() => 0);
  const buttonCount = await page.locator("button").count().catch(() => 0);

  logger.error(`CHATGPT_PROJECT_HEADING_FOUND=${headingOk}`);
  logger.error(`CHATGPT_PROJECT_URL_OK=${projectUrlOk}`);
  logger.error(`CHATGPT_CONTENTEDITABLE_COUNT=${contentEditableCount}`);
  logger.error(`CHATGPT_TEXTAREA_COUNT=${textareaCount}`);
  logger.error(`CHATGPT_FILE_INPUT_COUNT=${fileInputCount}`);
  logger.error(`CHATGPT_BUTTON_COUNT=${buttonCount}`);
  logger.error(`CHATGPT_CURRENT_URL=${url}`);
}

/** Soft check — prefer waitForProjectHomeReady. */
export async function composerHasProjectPlaceholder(
  page: Page,
  projectName: string,
): Promise<boolean> {
  try {
    await waitForProjectHomeReady(page, projectName, {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    } as unknown as Logger, 3_000);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fresh tender page:
 * ONE newPage → ONE project goto → read-only poll until composer ready → upload.
 *
 * NEVER reload / re-goto the same page while ChatGPT is hydrating.
 * If initial load truly fails after timeout: close page, retry once with a NEW page.
 */
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { AutomationError } from "../browserUtils.js";
import {
  isProjectHomeUrl,
  resolveConfiguredProjectUrl,
} from "./openProject.js";
import { discoverComposerAttachments } from "./composerShellAttachments.js";
import {
  closeOwnedCandidatePage,
  openOwnedCandidatePage,
} from "./ownedCandidatePage.js";
import {
  isGlobalChatGptRateLimited,
  tripGlobalChatGptRateLimit,
  waitWhileGlobalChatGptRateLimited,
} from "./globalChatGptRateLimit.js";
import { handleRateLimitModal } from "./chatInteraction.js";
import {
  attachChatGptNavigationObservers,
  chatGptPageGoto,
  clearTenderPageLifecycle,
  initTenderPageLifecycle,
  setTenderPageLifecycleState,
} from "./tenderPageNav.js";

/** Pages verified fresh for this candidate — skip re-nav in qualifySingleTender. */
const freshVerifiedPages = new WeakSet<Page>();

export function markFreshComposerVerified(page: Page): void {
  freshVerifiedPages.add(page);
}

export function isFreshComposerVerified(page: Page): boolean {
  return freshVerifiedPages.has(page);
}

export function clearFreshComposerVerified(page: Page): void {
  freshVerifiedPages.delete(page);
}

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

function projectReadyTimeoutMs(): number {
  const n = Number.parseInt(
    process.env.CHATGPT_PROJECT_READY_TIMEOUT_MS || "120000",
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

async function readComposerTextEmpty(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const editor =
        document.querySelector(
          '[contenteditable="true"][aria-label*="New chat in" i], [contenteditable="true"]#prompt-textarea, #prompt-textarea, textarea[placeholder*="New chat in" i]',
        ) || document.querySelector('[contenteditable="true"]');
      if (!editor) return false;
      const text = (
        editor.textContent ||
        (editor as HTMLTextAreaElement).value ||
        ""
      )
        .replace(/\u200b/g, "")
        .trim();
      if (!text) return true;
      if (/^New chat in/i.test(text)) return true;
      return false;
    })
    .catch(() => false);
}

async function composerEditorVisible(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const editor = document.querySelector(
        '[contenteditable="true"][aria-label*="New chat in" i], [contenteditable="true"]#prompt-textarea, #prompt-textarea, [contenteditable="true"]',
      );
      if (!editor) return false;
      const style = window.getComputedStyle(editor as Element);
      return style.display !== "none" && style.visibility !== "hidden";
    })
    .catch(() => false);
}

/**
 * Lightweight read-only readiness (no navigation).
 * Blank/spinner during hydration is NORMAL — keep polling.
 */
async function inspectProjectAndComposer(
  page: Page,
  _config: AppConfig,
  logger: Logger,
  options?: { quiet?: boolean },
): Promise<{
  projectReady: boolean;
  textEmpty: boolean;
  attachmentCount: number;
  composerVisible: boolean;
  verified: boolean;
}> {
  void _config;
  const urlOk = isProjectHomeUrl(page.url());
  const composerVisible = await composerEditorVisible(page);
  const projectReady = urlOk && composerVisible;

  let textEmpty = false;
  let attachmentCount = -1;
  if (projectReady) {
    textEmpty = await readComposerTextEmpty(page);
    const discovered = await discoverComposerAttachments(page);
    attachmentCount = discovered.logicalAttachmentCount;
  }

  const verified =
    projectReady && textEmpty && attachmentCount === 0 && composerVisible;

  if (!options?.quiet) {
    log(logger, `CHATGPT_PROJECT_READY=${projectReady}`);
    if (projectReady) {
      log(logger, `CHATGPT_COMPOSER_TEXT_EMPTY=${textEmpty}`);
      log(
        logger,
        `CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=${attachmentCount}`,
      );
    }
  }

  return {
    projectReady,
    textEmpty,
    attachmentCount,
    composerVisible,
    verified,
  };
}

/**
 * Read-only poll until project+clean composer ready, or timeout.
 * NEVER goto/reload inside this loop.
 */
async function waitForFreshComposerReadOnly(options: {
  page: Page;
  config: AppConfig;
  logger: Logger;
  timeoutMs: number;
}): Promise<boolean> {
  const { page, config, logger, timeoutMs } = options;
  const deadline = Date.now() + timeoutMs;
  let lastLogAt = 0;

  log(logger, `CHATGPT_PROJECT_READY_TIMEOUT_MS=${timeoutMs}`);
  log(logger, "CHATGPT_PROJECT_LOADING_POLL_START=true");

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new AutomationError(
        "CHATGPT_PAGE_CLOSED",
        "Tender page closed during project-ready poll",
      );
    }

    if (await handleRateLimitModal(page, logger)) {
      tripGlobalChatGptRateLimit({
        logger,
        reason: "detected_during_project_ready_poll",
      });
      throw new AutomationError(
        "CHATGPT_RATE_LIMITED",
        "Too many requests while waiting for project ready",
      );
    }

    const inspect = await inspectProjectAndComposer(page, config, logger, {
      quiet: true,
    });

    const now = Date.now();
    if (now - lastLogAt >= 5_000) {
      lastLogAt = now;
      log(
        logger,
        `CHATGPT_PROJECT_LOADING_POLL remainingMs=${Math.max(0, deadline - now)} url=${page.url()} projectReady=${inspect.projectReady} composerVisible=${inspect.composerVisible} textEmpty=${inspect.textEmpty} attachments=${inspect.attachmentCount}`,
      );
    }

    if (inspect.verified) {
      log(logger, "CHATGPT_PROJECT_READY=true");
      log(logger, "CHATGPT_COMPOSER_TEXT_EMPTY=true");
      log(logger, "CHATGPT_CURRENT_COMPOSER_ATTACHMENT_COUNT=0");
      log(logger, "CHATGPT_FRESH_COMPOSER_VERIFIED=true");
      log(logger, "CHATGPT_WORKER_FRESH_COMPOSER_READY=true");
      return true;
    }

    // Dirty composer (attachments left over) — do NOT reload.
    // Clear-in-place is allowed (DOM clicks only) once project is ready.
    if (
      inspect.projectReady &&
      inspect.attachmentCount > 0 &&
      inspect.composerVisible
    ) {
      log(
        logger,
        `CHATGPT_STALE_COMPOSER_ATTACHMENTS=${inspect.attachmentCount} — clear-in-place (no reload)`,
      );
      try {
        const { clearCurrentComposer } = await import(
          "./clearCurrentComposer.js"
        );
        await clearCurrentComposer(page, { logger });
      } catch (error) {
        log(
          logger,
          `CHATGPT_STALE_CLEAR_FAILED=${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // Continue polling after clear — still no navigation.
    }

    await page.waitForTimeout(750);
  }

  log(logger, "CHATGPT_PROJECT_READY_TIMEOUT=true");
  return false;
}

/**
 * Close leftover bootstrap/blank pages so concurrency=1 shows ONE tender tab.
 * Never closes the keepPages set.
 */
export async function closeUnusedBootstrapPages(options: {
  context: BrowserContext;
  keepPages: Page[];
  logger?: Logger;
  /** When true, close every page not in keepPages (concurrency=1). */
  closeAllExceptKeep?: boolean;
}): Promise<number> {
  const keep = new Set(options.keepPages.filter((p) => p && !p.isClosed()));
  let closed = 0;
  for (const p of options.context.pages()) {
    if (p.isClosed()) continue;
    if (keep.has(p)) continue;
    const url = p.url();
    const shouldClose =
      options.closeAllExceptKeep === true ||
      url === "about:blank" ||
      url === "" ||
      url === "chrome://newtab/" ||
      /^https:\/\/chatgpt\.com\/?$/i.test(url) ||
      /\/auth/i.test(url);
    if (!shouldClose) continue;

    await p.close({ runBeforeUnload: false }).catch(() => undefined);
    closed += 1;
    log(options.logger, "CHATGPT_UNUSED_BOOTSTRAP_PAGE_CLOSED=true");
    log(options.logger, `CHATGPT_UNUSED_BOOTSTRAP_PAGE_URL=${url || "blank"}`);
  }
  return closed;
}

async function openAndWaitOnce(options: {
  context: BrowserContext;
  config: AppConfig;
  logger: Logger;
  workerId: number;
  sourceTenderId: string;
  projectUrl: string;
}): Promise<Page> {
  const { context, config, logger, workerId, sourceTenderId, projectUrl } =
    options;

  const page = await openOwnedCandidatePage({
    context,
    workerId,
    sourceTenderId,
    logger,
  });

  initTenderPageLifecycle(page, workerId, sourceTenderId);
  attachChatGptNavigationObservers(page, logger);
  setTenderPageLifecycleState(page, "PROJECT_LOADING", logger);

  log(logger, `CHATGPT_WORKER_ID=${workerId}`);
  log(logger, `CHATGPT_TENDER_ID=${sourceTenderId}`);
  log(logger, "CHATGPT_TENDER_TAB_CREATED=true");

  // Close unused bootstrap so concurrency=1 shows a single tender tab.
  const concurrency = Number.parseInt(
    process.env.CHATGPT_CONCURRENCY || "1",
    10,
  );
  await closeUnusedBootstrapPages({
    context,
    keepPages: [page],
    logger,
    closeAllExceptKeep: !Number.isFinite(concurrency) || concurrency <= 1,
  });

  // THE ONLY normal project navigation for this page.
  await chatGptPageGoto(page, projectUrl, {
    reason: "openFreshTenderPage_initial",
    logger,
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });

  const ready = await waitForFreshComposerReadOnly({
    page,
    config,
    logger,
    timeoutMs: projectReadyTimeoutMs(),
  });

  if (!ready) {
    clearFreshComposerVerified(page);
    clearTenderPageLifecycle(page);
    await closeOwnedCandidatePage({
      page,
      workerId,
      sourceTenderId,
      logger,
      force: true,
    }).catch(() => undefined);
    throw new AutomationError(
      "CHATGPT_PROJECT_READY_TIMEOUT",
      `Project/composer not ready within ${projectReadyTimeoutMs()}ms (no reload attempted)`,
    );
  }

  setTenderPageLifecycleState(page, "COMPOSER_READY", logger);
  markFreshComposerVerified(page);
  log(logger, "CHATGPT_UPLOAD_START_READY=true");
  return page;
}

/**
 * Canonical entry: new tab → project URL once → wait (no refresh) → clean composer.
 */
export async function openFreshTenderPage(options: {
  context: BrowserContext;
  config: AppConfig;
  logger: Logger;
  workerId: number;
  sourceTenderId: string;
}): Promise<Page> {
  const { context, config, logger, workerId, sourceTenderId } = options;

  await waitWhileGlobalChatGptRateLimited({ logger, workerId });

  const projectUrl = resolveConfiguredProjectUrl({
    projectUrl: config.chatgptProjectUrl,
    config,
    projectName: config.chatgptProjectName,
    logger,
  });

  try {
    return await openAndWaitOnce({
      context,
      config,
      logger,
      workerId,
      sourceTenderId,
      projectUrl,
    });
  } catch (error) {
    if (
      error instanceof AutomationError &&
      error.code === "CHATGPT_RATE_LIMITED"
    ) {
      throw error;
    }
    if (isGlobalChatGptRateLimited()) {
      throw new AutomationError(
        "CHATGPT_RATE_LIMITED",
        "Global rate limit active after fresh tab failure",
      );
    }

    // Controlled retry: NEW page only (never second goto on the failed page).
    log(logger, "CHATGPT_TENDER_TAB_RETRY_NEW_PAGE=true");
    return openAndWaitOnce({
      context,
      config,
      logger,
      workerId,
      sourceTenderId,
      projectUrl,
    });
  }
}

/** @deprecated Use openFreshTenderPage */
export async function openFreshTenderTab(
  options: Parameters<typeof openFreshTenderPage>[0],
): Promise<Page> {
  return openFreshTenderPage(options);
}

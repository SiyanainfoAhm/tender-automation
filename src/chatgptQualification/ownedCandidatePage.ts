/**
 * Explicit page ownership for dual ChatGPT workers.
 *
 * ONE shared BrowserContext for the batch.
 * Each candidate owns exactly one Page — only that worker/tender may close it.
 * Never close BrowserContext / browser from candidate code.
 */
import type { BrowserContext, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";

export type PageOwnership = {
  workerId: number;
  sourceTenderId: string;
  /** True once SUBMITTED — close blocked until release. */
  protectedUntilTerminal: boolean;
  createdAt: number;
};

const ownershipByPage = new WeakMap<Page, PageOwnership>();

export function registerOwnedPage(
  page: Page,
  workerId: number,
  sourceTenderId: string,
): void {
  ownershipByPage.set(page, {
    workerId,
    sourceTenderId,
    protectedUntilTerminal: false,
    createdAt: Date.now(),
  });
}

export function getPageOwnership(page: Page): PageOwnership | null {
  return ownershipByPage.get(page) ?? null;
}

/** Mark page protected after successful Send / SUBMITTED. */
export function markPageProtectedUntilTerminal(page: Page): void {
  const meta = ownershipByPage.get(page);
  if (!meta) return;
  meta.protectedUntilTerminal = true;
}

/** Allow close after terminal candidate outcome (DONE / FAILED / verified). */
export function releasePageProtection(page: Page): void {
  const meta = ownershipByPage.get(page);
  if (!meta) return;
  meta.protectedUntilTerminal = false;
}

export function assertPageOwnedBy(
  page: Page,
  workerId: number,
  sourceTenderId: string,
): void {
  const meta = ownershipByPage.get(page);
  if (!meta) {
    throw new AutomationError(
      "CHATGPT_PAGE_OWNERSHIP_MISSING",
      `page.close refused — no ownership record worker=${workerId} tender=${sourceTenderId}`,
    );
  }
  if (meta.workerId !== workerId) {
    throw new AutomationError(
      "CHATGPT_PAGE_OWNERSHIP_MISMATCH",
      `page.close refused — ownerWorker=${meta.workerId} caller=${workerId}`,
    );
  }
  if (meta.sourceTenderId !== sourceTenderId) {
    throw new AutomationError(
      "CHATGPT_PAGE_OWNERSHIP_MISMATCH",
      `page.close refused — ownerTender=${meta.sourceTenderId} caller=${sourceTenderId}`,
    );
  }
  if (meta.protectedUntilTerminal) {
    throw new AutomationError(
      "CHATGPT_PAGE_PROTECTED",
      `page.close refused — page still protected (SUBMITTED/WAITING_RESPONSE) tender=${sourceTenderId}`,
    );
  }
}

/**
 * Authoritative shared-context health check.
 * Do NOT treat a non-null context object as alive.
 */
export function isBrowserContextAlive(context: BrowserContext): boolean {
  try {
    // Throws when context is closed.
    void context.pages();
  } catch {
    return false;
  }

  try {
    const browser = context.browser();
    // Persistent contexts may return null for browser(); that is still usable
    // when pages() succeeds. Only fail when a Browser exists and is disconnected.
    if (browser && !browser.isConnected()) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * Authoritative lightweight probe before newPage.
 * Do not treat a non-null context object as alive.
 */
export async function probeSharedContextHealth(
  context: BrowserContext,
  logger?: Logger,
): Promise<boolean> {
  console.log("CHATGPT_SHARED_CONTEXT_HEALTH_CHECK_START");
  logger?.info("CHATGPT_SHARED_CONTEXT_HEALTH_CHECK_START");

  if (!isBrowserContextAlive(context)) {
    console.log("CHATGPT_SHARED_CONTEXT_ALIVE=false");
    logger?.warn("CHATGPT_SHARED_CONTEXT_ALIVE=false");
    return false;
  }

  try {
    let openPages = context.pages().filter((p) => !p.isClosed());
    if (openPages.length === 0) {
      const anchor = await context.newPage();
      await anchor.goto("about:blank", { waitUntil: "domcontentloaded" }).catch(
        () => undefined,
      );
      console.log("CHATGPT_SHARED_CONTEXT_ANCHOR_RECREATED=true");
      logger?.info("CHATGPT_SHARED_CONTEXT_ANCHOR_RECREATED=true");
      openPages = [anchor];
    }

    // Exercise the live page — proves the context is not a stale handle.
    try {
      await openPages[0]!.evaluate(() => true);
    } catch {
      const probe = await context.newPage();
      await probe.close({ runBeforeUnload: false }).catch(() => undefined);
    }

    if (!isBrowserContextAlive(context)) {
      console.log("CHATGPT_SHARED_CONTEXT_ALIVE=false");
      logger?.warn("CHATGPT_SHARED_CONTEXT_ALIVE=false");
      return false;
    }

    console.log("CHATGPT_SHARED_CONTEXT_ALIVE=true");
    logger?.info("CHATGPT_SHARED_CONTEXT_ALIVE=true");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`CHATGPT_SHARED_CONTEXT_ALIVE=false reason=${message}`);
    logger?.warn(`CHATGPT_SHARED_CONTEXT_ALIVE=false reason=${message}`);
    return false;
  }
}

export function assertSharedContextAlive(context: BrowserContext): void {
  if (!isBrowserContextAlive(context)) {
    throw new AutomationError(
      "CHATGPT_BROWSER_CONTEXT_DEAD",
      "Shared BrowserContext is closed — batch-level recovery required",
    );
  }
}

/**
 * Close ONLY this candidate's page. Never touches context/browser/other pages.
 */
export async function closeOwnedCandidatePage(options: {
  page: Page;
  workerId: number;
  sourceTenderId: string;
  logger?: Logger;
  /** Force close even if protected (terminal failure after response abandoned). */
  force?: boolean;
}): Promise<void> {
  const { page, workerId, sourceTenderId, logger, force } = options;

  if (page.isClosed()) {
    ownershipByPage.delete(page);
    logger?.info(
      `CHATGPT_CANDIDATE_PAGE_ALREADY_CLOSED worker=${workerId} tender=${sourceTenderId}`,
    );
    return;
  }

  if (!force) {
    assertPageOwnedBy(page, workerId, sourceTenderId);
  } else {
    const meta = ownershipByPage.get(page);
    if (meta && meta.workerId !== workerId) {
      throw new AutomationError(
        "CHATGPT_PAGE_OWNERSHIP_MISMATCH",
        `force close refused — ownerWorker=${meta.workerId} caller=${workerId}`,
      );
    }
    if (meta && meta.sourceTenderId !== sourceTenderId) {
      throw new AutomationError(
        "CHATGPT_PAGE_OWNERSHIP_MISMATCH",
        `force close refused — ownerTender=${meta.sourceTenderId} caller=${sourceTenderId}`,
      );
    }
  }

  console.log(
    `CHATGPT_CANDIDATE_PAGE_CLOSE worker=${workerId} tender=${sourceTenderId}`,
  );
  logger?.info(
    `CHATGPT_CANDIDATE_PAGE_CLOSE worker=${workerId} tender=${sourceTenderId}`,
  );

  ownershipByPage.delete(page);
  await page.close({ runBeforeUnload: false }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // Never escalate page-close errors into context teardown.
    logger?.warn(
      `CHATGPT_CANDIDATE_PAGE_CLOSE_ERROR worker=${workerId} tender=${sourceTenderId} ${message}`,
    );
  });
}

/**
 * Open a fresh tab for one tender transaction on the shared context.
 */
export async function openOwnedCandidatePage(options: {
  context: BrowserContext;
  workerId: number;
  sourceTenderId: string;
  logger?: Logger;
}): Promise<Page> {
  const { context, workerId, sourceTenderId, logger } = options;
  const healthy = await probeSharedContextHealth(context, logger);
  if (!healthy) {
    throw new AutomationError(
      "CHATGPT_BROWSER_CONTEXT_DEAD",
      "Shared BrowserContext failed health check before newPage",
    );
  }

  let page: Page;
  try {
    page = await context.newPage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AutomationError(
      "CHATGPT_BROWSER_CONTEXT_DEAD",
      `browserContext.newPage failed: ${message}`,
    );
  }
  registerOwnedPage(page, workerId, sourceTenderId);
  console.log(
    `CHATGPT_CANDIDATE_PAGE_OPEN worker=${workerId} tender=${sourceTenderId}`,
  );
  logger?.info(
    `CHATGPT_CANDIDATE_PAGE_OPEN worker=${workerId} tender=${sourceTenderId}`,
  );
  return page;
}

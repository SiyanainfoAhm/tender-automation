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

export function isBrowserContextAlive(context: BrowserContext): boolean {
  try {
    // Accessing pages() throws when context is closed.
    void context.pages();
    return true;
  } catch {
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
  assertSharedContextAlive(context);

  const page = await context.newPage();
  registerOwnedPage(page, workerId, sourceTenderId);
  console.log(
    `CHATGPT_CANDIDATE_PAGE_OPEN worker=${workerId} tender=${sourceTenderId}`,
  );
  logger?.info(
    `CHATGPT_CANDIDATE_PAGE_OPEN worker=${workerId} tender=${sourceTenderId}`,
  );
  return page;
}

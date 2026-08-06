import type { Locator, Page } from "playwright";
import type { Logger } from "../logger.js";

const PAGINATION_TIMEOUT_MS = 60_000;
const NEXT_TEXT = /^\s*next\s*$/i;
const PREVIOUS_TEXT = /^\s*previous|prev\s*$/i;
const PAGE_NUMBER_TEXT = /^\s*\d+\s*$/;

export interface PaginationBeforeState {
  activePage: number | null;
  firstCardKey: string | null;
  url: string;
}

export interface PaginationMoveResult {
  moved: boolean;
  fromPage: number | null;
  toPage: number | null;
  reason?: "disabled" | "missing" | "unchanged" | "ok";
}

/** Pure: whether the crawl still needs another results page. */
export function shouldContinuePagination(options: {
  processedCount: number;
  limit: number;
}): boolean {
  if (options.limit === 0) {
    return true;
  }
  return options.processedCount < options.limit;
}

/** Pure: how many remaining tenders can still be taken from this page. */
export function remainingSlots(options: {
  processedCount: number;
  limit: number;
}): number {
  if (options.limit === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, options.limit - options.processedCount);
}

/** Pure: whether a control's attributes look disabled. */
export function isDisabledControlAttrs(options: {
  disabledAttr: string | null;
  ariaDisabled: string | null;
  className: string;
  enabled: boolean;
}): boolean {
  if (!options.enabled) {
    return true;
  }
  if (options.disabledAttr !== null) {
    return true;
  }
  if (options.ariaDisabled === "true") {
    return true;
  }
  return /\bdisabled\b/i.test(options.className);
}

/** Pure: whether the snapshot proves the results page changed. */
export function didPaginationChange(options: {
  before: PaginationBeforeState;
  afterPage: number | null;
  afterFirstCardKey: string | null;
  afterUrl: string;
}): boolean {
  if (
    options.before.activePage !== null &&
    options.afterPage !== null &&
    options.afterPage !== options.before.activePage
  ) {
    return true;
  }
  if (
    options.before.firstCardKey &&
    options.afterFirstCardKey &&
    options.afterFirstCardKey !== options.before.firstCardKey
  ) {
    return true;
  }
  if (options.afterUrl && options.afterUrl !== options.before.url) {
    return true;
  }
  return false;
}

/** Pure: next numeric page target when Next is missing. */
export function nextNumericPageTarget(
  currentPage: number | null,
): number | null {
  if (currentPage === null || currentPage < 1) {
    return null;
  }
  return currentPage + 1;
}

/** Find the pagination container that holds Previous/Next/page numbers. */
export async function findPaginationContainer(
  page: Page,
): Promise<Locator | null> {
  const candidates = page.locator(
    [
      'nav[aria-label*="pagination" i]',
      '[class*="pagination" i]',
      '[role="navigation"]',
      "ul",
      "div",
    ].join(", "),
  );
  const count = await candidates.count().catch(() => 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const candidate = candidates.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    const text = ((await candidate.innerText().catch(() => "")) || "").trim();
    if (!NEXT_TEXT.test(text) && !/\bnext\b/i.test(text)) {
      continue;
    }
    if (!/\b\d+\b/.test(text)) {
      continue;
    }
    if (PREVIOUS_TEXT.test(text) || /\bprevious|\bprev\b/i.test(text)) {
      return candidate;
    }
    if (/\b\d+\b/.test(text) && /\bnext\b/i.test(text)) {
      return candidate;
    }
  }
  return null;
}

async function readControlDisabled(control: Locator): Promise<boolean> {
  const disabledAttr = await control.getAttribute("disabled").catch(() => null);
  const ariaDisabled = await control
    .getAttribute("aria-disabled")
    .catch(() => null);
  const className =
    (await control.getAttribute("class").catch(() => null)) || "";
  const enabled = await control.isEnabled().catch(() => true);
  return isDisabledControlAttrs({
    disabledAttr,
    ariaDisabled,
    className,
    enabled,
  });
}

/** Inspect visible numeric pagination controls and identify the active page. */
export async function getCurrentPaginationPage(
  page: Page,
): Promise<number | null> {
  const container = (await findPaginationContainer(page)) ?? page.locator("body");
  const numbers = container
    .locator('button, a, [role="button"], span, li')
    .filter({ hasText: PAGE_NUMBER_TEXT });
  const count = await numbers.count().catch(() => 0);
  let fallback: number | null = null;

  for (let i = 0; i < count; i += 1) {
    const candidate = numbers.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    const text = ((await candidate.innerText().catch(() => "")) || "").trim();
    const value = Number.parseInt(text, 10);
    if (!Number.isFinite(value)) {
      continue;
    }
    fallback ??= value;

    const ariaCurrent = await candidate
      .getAttribute("aria-current")
      .catch(() => null);
    const className =
      (await candidate.getAttribute("class").catch(() => null)) || "";
    const ariaSelected = await candidate
      .getAttribute("aria-selected")
      .catch(() => null);
    if (
      ariaCurrent === "page" ||
      ariaSelected === "true" ||
      /\b(active|current|selected)\b/i.test(className)
    ) {
      return value;
    }
    if (await readControlDisabled(candidate)) {
      // Some UIs disable the active page button
      return value;
    }
  }

  return fallback;
}

async function findNextControl(page: Page): Promise<Locator | null> {
  const container = await findPaginationContainer(page);
  const scopes: Locator[] = container ? [container, page.locator("body")] : [page.locator("body")];

  for (const scope of scopes) {
    const groups: Locator[] = [
      scope.getByRole("button", { name: NEXT_TEXT }),
      scope.getByRole("link", { name: NEXT_TEXT }),
      scope
        .locator('button, a, [role="button"]')
        .filter({ hasText: NEXT_TEXT }),
      scope.getByText(NEXT_TEXT),
    ];
    for (const group of groups) {
      const count = await group.count().catch(() => 0);
      for (let i = count - 1; i >= 0; i -= 1) {
        const candidate = group.nth(i);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

async function findNumericPageControl(
  page: Page,
  targetPage: number,
): Promise<Locator | null> {
  const container = (await findPaginationContainer(page)) ?? page.locator("body");
  const pattern = new RegExp(`^\\s*${targetPage}\\s*$`);
  const candidates = container
    .locator('button, a, [role="button"]')
    .filter({ hasText: pattern });
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    if (await readControlDisabled(candidate)) {
      continue;
    }
    return candidate;
  }
  return null;
}

export async function capturePaginationBeforeState(options: {
  page: Page;
  firstCardKey: string | null;
}): Promise<PaginationBeforeState> {
  return {
    activePage: await getCurrentPaginationPage(options.page),
    firstCardKey: options.firstCardKey,
    url: options.page.url(),
  };
}

async function waitForPaginationChange(options: {
  page: Page;
  before: PaginationBeforeState;
  getFirstCardKey: () => Promise<string | null>;
}): Promise<{ changed: boolean; toPage: number | null }> {
  const { page, before, getFirstCardKey } = options;
  const deadline = Date.now() + PAGINATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const afterPage = await getCurrentPaginationPage(page);
    const afterFirstCardKey = await getFirstCardKey();
    const afterUrl = page.url();
    if (
      didPaginationChange({
        before,
        afterPage,
        afterFirstCardKey,
        afterUrl,
      })
    ) {
      return { changed: true, toPage: afterPage };
    }
    await page.waitForTimeout(500);
  }

  return {
    changed: false,
    toPage: await getCurrentPaginationPage(page),
  };
}

/**
 * Move to the next BidAssist results page via Next (preferred) or the next
 * numeric page control. Returns false when pagination has ended or failed.
 */
export async function moveToNextBidAssistPage(options: {
  page: Page;
  currentPageNumber: number;
  firstCardKey: string | null;
  logger: Logger;
  getFirstCardKey: () => Promise<string | null>;
}): Promise<PaginationMoveResult> {
  const { page, currentPageNumber, firstCardKey, logger, getFirstCardKey } =
    options;

  const before = await capturePaginationBeforeState({ page, firstCardKey });
  const fromPage = before.activePage ?? currentPageNumber;

  let control = await findNextControl(page);
  let usedNumericFallback = false;

  if (control && (await readControlDisabled(control))) {
    logger.info("BIDASSIST_PAGINATION_END_REACHED");
    return {
      moved: false,
      fromPage,
      toPage: fromPage,
      reason: "disabled",
    };
  }

  if (!control) {
    const target = nextNumericPageTarget(fromPage);
    if (target !== null) {
      control = await findNumericPageControl(page, target);
      usedNumericFallback = Boolean(control);
    }
  }

  if (!control) {
    logger.info("BIDASSIST_PAGINATION_END_REACHED");
    return {
      moved: false,
      fromPage,
      toPage: fromPage,
      reason: "missing",
    };
  }

  const container = await findPaginationContainer(page);
  if (container) {
    await container.scrollIntoViewIfNeeded().catch(() => undefined);
  }
  await control.scrollIntoViewIfNeeded().catch(() => undefined);

  logger.info("BIDASSIST_PAGINATION_NEXT_CLICKED");
  logger.info(`BIDASSIST_PAGINATION_FROM_PAGE=${fromPage}`);
  if (usedNumericFallback) {
    logger.info("BIDASSIST_PAGINATION_NUMERIC_FALLBACK");
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const liveControl =
      (await findNextControl(page)) ||
      (await findNumericPageControl(
        page,
        nextNumericPageTarget(fromPage) ?? fromPage + 1,
      ));
    if (!liveControl) {
      break;
    }
    if (await readControlDisabled(liveControl)) {
      logger.info("BIDASSIST_PAGINATION_END_REACHED");
      return {
        moved: false,
        fromPage,
        toPage: fromPage,
        reason: "disabled",
      };
    }

    await liveControl.scrollIntoViewIfNeeded().catch(() => undefined);
    await liveControl
      .click({ timeout: 15_000, force: attempt === 2 })
      .catch(() => undefined);

    const result = await waitForPaginationChange({
      page,
      before,
      getFirstCardKey,
    });
    if (result.changed) {
      const toPage = result.toPage ?? fromPage + 1;
      logger.info(`BIDASSIST_PAGINATION_TO_PAGE=${toPage}`);
      logger.info("BIDASSIST_RESULTS_PAGE_CHANGED");
      return {
        moved: true,
        fromPage,
        toPage,
        reason: "ok",
      };
    }
  }

  logger.error("BIDASSIST_PAGINATION_NEXT_FAILED");
  return {
    moved: false,
    fromPage,
    toPage: fromPage,
    reason: "unchanged",
  };
}

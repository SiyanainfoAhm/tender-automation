import type { BrowserContext, Page } from "playwright";
import type { Logger } from "../logger.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { assertSameBrowserContext } from "./ensureTender247LoggedIn.js";
import type { TenderListItem } from "./types.js";

/** Serialize eye/view clicks on the shared list page. */
let listClickLock: Promise<void> = Promise.resolve();

export interface OpenDetailResult {
  page: Page;
  openedVia: "popup" | "same_context_navigation";
}

/**
 * Open a tender detail page using the shared authenticated BrowserContext only.
 * Prefer view/eye popup from the list page when available; otherwise newPage()+goto
 * on the same context (never browser.newContext()).
 */
export async function openTenderDetailPage(args: {
  context: BrowserContext;
  listPage: Page | undefined;
  item: TenderListItem;
  pageTimeoutMs: number;
  logger: Logger;
}): Promise<OpenDetailResult> {
  const { context, listPage, item, pageTimeoutMs, logger } = args;

  if (listPage && !listPage.isClosed()) {
    await dismissTender247BlockingOverlays(listPage, logger).catch(() => undefined);
    try {
      const popup = await openViaListEyeButton({
        context,
        listPage,
        item,
        pageTimeoutMs,
        logger,
      });
      if (popup) {
        assertSameBrowserContext(popup, context, logger, `T247-${item.t247Id} popup`);
        await dismissTender247BlockingOverlays(popup, logger);
        return { page: popup, openedVia: "popup" };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Eye/view popup open failed for T247-${item.t247Id}; falling back to same-context navigation: ${message}`,
      );
    }
  }

  const page = await context.newPage();
  page.setDefaultTimeout(pageTimeoutMs);
  assertSameBrowserContext(page, context, logger, `T247-${item.t247Id} newPage`);

  await page.goto(item.detailUrl, {
    waitUntil: "domcontentloaded",
    timeout: pageTimeoutMs,
  });
  await page
    .waitForLoadState("networkidle", { timeout: pageTimeoutMs })
    .catch(() => undefined);
  await dismissTender247BlockingOverlays(page, logger);

  logger.info(
    `Detail page opened via same-context navigation: T247-${item.t247Id}`,
  );
  return { page, openedVia: "same_context_navigation" };
}

async function openViaListEyeButton(args: {
  context: BrowserContext;
  listPage: Page;
  item: TenderListItem;
  pageTimeoutMs: number;
  logger: Logger;
}): Promise<Page | undefined> {
  const { context, listPage, item, pageTimeoutMs, logger } = args;

  const run = listClickLock.then(async () => {
    const card = listPage
      .locator("article, li, section, div")
      .filter({ hasText: new RegExp(`T247\\s*ID\\s*[-:]?\\s*${item.t247Id}`, "i") })
      .first();

    if (!(await card.isVisible().catch(() => false))) {
      // Scroll list to find the card
      for (let i = 0; i < 12; i += 1) {
        await listPage.evaluate(() => window.scrollBy(0, 700));
        await listPage.waitForTimeout(400);
        if (await card.isVisible().catch(() => false)) {
          break;
        }
      }
    }

    if (!(await card.isVisible().catch(() => false))) {
      logger.warn(`List card not found for T247-${item.t247Id}`);
      return undefined;
    }

    const eye = card
      .getByRole("link", { name: /view|details|open|eye/i })
      .or(card.getByRole("button", { name: /view|details|open|eye/i }))
      .or(card.locator('a[title*="view" i], a[aria-label*="view" i], button[title*="view" i], a[href*="tender" i]'))
      .or(card.locator('img[alt*="view" i], img[alt*="eye" i], [class*="eye" i], [class*="view" i]'))
      .first();

    const clickTarget =
      (await eye.isVisible().catch(() => false))
        ? eye
        : card.getByRole("link").first();

    if (!(await clickTarget.isVisible().catch(() => false))) {
      logger.warn(`No view/eye control found on card T247-${item.t247Id}`);
      return undefined;
    }

    await dismissTender247BlockingOverlays(listPage, logger).catch(() => undefined);

    const popupPromise = Promise.race([
      context.waitForEvent("page", { timeout: pageTimeoutMs }),
      listPage.waitForEvent("popup", { timeout: pageTimeoutMs }),
    ]).catch(() => null);

    await clickTarget.click({ timeout: 15_000 });
    const popup = await popupPromise;
    if (!popup) {
      logger.warn(
        `No popup page after eye/view click for T247-${item.t247Id}`,
      );
      return undefined;
    }

    await popup
      .waitForLoadState("domcontentloaded", { timeout: pageTimeoutMs })
      .catch(() => undefined);
    popup.setDefaultTimeout(pageTimeoutMs);
    await dismissTender247BlockingOverlays(popup, logger).catch(() => undefined);
    logger.info(
      `Detail page opened via list eye/view popup: T247-${item.t247Id}`,
    );
    return popup;
  });

  // Chain the lock regardless of success/failure
  listClickLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

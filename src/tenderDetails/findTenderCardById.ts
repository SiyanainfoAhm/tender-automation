import type { BrowserContext, Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "./dismissSupportChat.js";
import { assertSameBrowserContext } from "./ensureTender247LoggedIn.js";
import type { TenderListItem } from "./types.js";

/**
 * Find a tender card by T247 ID among currently rendered cards first.
 * Scrolls incrementally only if the ID is not yet visible.
 * Does not collect the full Fresh list / wait for badge count (e.g. 106).
 */
export async function findTenderCardById(
  page: Page,
  requestedT247Id: string,
  logger?: Logger,
): Promise<Locator> {
  const id = requestedT247Id.replace(/\D/g, "");
  if (!id) {
    throw new AutomationError(
      "TENDER247_REQUESTED_TENDER_NOT_FOUND",
      "Requested T247 ID is empty after normalization",
    );
  }

  const idPattern = new RegExp(`T247\\s*ID\\s*[-:]?\\s*${id}\\b`, "i");

  const locateSmallestVisibleCard = async (): Promise<Locator | null> => {
    const candidates = page
      .locator("article, li, section, div")
      .filter({ hasText: idPattern });

    const count = await candidates.count().catch(() => 0);
    let best: { locator: Locator; height: number; width: number } | null = null;

    for (let i = 0; i < Math.min(count, 40); i += 1) {
      const el = candidates.nth(i);
      if (!(await el.isVisible().catch(() => false))) {
        continue;
      }
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.height < 60 || box.height > 900) {
        continue;
      }
      // Prefer the smallest container that still looks like a tender card
      if (
        !best ||
        box.height < best.height ||
        (box.height === best.height && box.width < best.width)
      ) {
        best = { locator: el, height: box.height, width: box.width };
      }
    }

    return best?.locator ?? null;
  };

  // Search currently rendered cards first — do not scroll / wait for all 106
  let card = await locateSmallestVisibleCard();
  if (card) {
    logger?.info("TENDER247_REQUESTED_TENDER_VISIBLE");
    logger?.info(`TENDER247_REQUESTED_TENDER_FOUND=${id}`);
    return card;
  }

  logger?.info(
    `Requested T247-${id} not in initially rendered cards; scrolling incrementally`,
  );

  let stableRounds = 0;
  let lastHeight = await page.evaluate(() => document.body.scrollHeight);
  for (let round = 1; round <= 40; round += 1) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.max(700, Math.floor(window.innerHeight * 0.9)));
    });
    await page.waitForTimeout(500);

    card = await locateSmallestVisibleCard();
    if (card) {
      logger?.info("TENDER247_REQUESTED_TENDER_VISIBLE");
      logger?.info(`TENDER247_REQUESTED_TENDER_FOUND=${id}`);
      return card;
    }

    const height = await page.evaluate(() => document.body.scrollHeight);
    const atBottom = await page.evaluate(
      () =>
        window.scrollY + window.innerHeight >= document.body.scrollHeight - 40,
    );
    if (height <= lastHeight && atBottom) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      lastHeight = height;
    }
    if (stableRounds >= 3) {
      break;
    }
  }

  throw new AutomationError(
    "TENDER247_REQUESTED_TENDER_NOT_FOUND",
    `Requested tender T247 ID ${id} was not found in the Fresh/Today listing (url=${page.url()})`,
  );
}

export interface OpenRequestedTenderResult {
  page: Page;
  item: TenderListItem;
  openedVia: "popup" | "same_tab" | "same_context_navigation";
}

/**
 * Single-tender path: find card → click eye/view inside that card → dismiss promos.
 * Does not call collectTodayTenderLinks().
 */
export async function openRequestedTenderById(args: {
  listPage: Page;
  context: BrowserContext;
  requestedT247Id: string;
  pageTimeoutMs: number;
  logger: Logger;
}): Promise<OpenRequestedTenderResult> {
  const { listPage, context, requestedT247Id, pageTimeoutMs, logger } = args;
  const id = requestedT247Id.replace(/\D/g, "");

  logger.info("STEP_FIND_REQUESTED_TENDER_START");
  await dismissTender247BlockingOverlays(listPage, logger).catch(() => undefined);
  await dismissTender247SupportChat(listPage, logger).catch(() => undefined);

  const card = await findTenderCardById(listPage, id, logger);
  await card.scrollIntoViewIfNeeded().catch(() => undefined);
  logger.info("STEP_FIND_REQUESTED_TENDER_COMPLETE");
  logger.info("TENDER247_MATCHED_CARD_FOUND");

  logger.info("STEP_VIEW_BUTTON_START");
  await logMatchedCardButtonDiagnostics(card, logger);

  const eye = await findEyeControlInCard(card, logger);
  if (!eye) {
    throw new AutomationError(
      "TENDER247_VIEW_CONTROL_NOT_FOUND",
      `Eye/view control not found inside matched card for T247-${id}`,
    );
  }
  logger.info("TENDER247_VIEW_BUTTON_FOUND");

  const href = await eye.getAttribute("href").catch(() => null);
  const listTitle = await readCardTitle(card);
  const listClosingDate = await readCardClosingDate(card);

  const previousUrl = listPage.url();
  const popupPromise = listPage
    .waitForEvent("popup", { timeout: 5_000 })
    .catch(() => null);
  // Also watch context for new pages (some browsers emit page not popup)
  const pagePromise = context
    .waitForEvent("page", { timeout: 5_000 })
    .catch(() => null);

  await eye.click({ timeout: 15_000 });
  logger.info("TENDER247_VIEW_CLICKED");
  logger.info("TENDER247_DETAIL_PAGE_OPENING");

  const popupPage = (await popupPromise) ?? (await pagePromise);
  let detailPage: Page;
  let openedVia: OpenRequestedTenderResult["openedVia"];

  if (popupPage) {
    detailPage = popupPage;
    openedVia = "popup";
    await detailPage
      .waitForLoadState("domcontentloaded", { timeout: pageTimeoutMs })
      .catch(() => undefined);
    detailPage.setDefaultTimeout(pageTimeoutMs);
    assertSameBrowserContext(detailPage, context, logger, `T247-${id} popup`);
  } else {
    detailPage = listPage;
    openedVia = "same_tab";
    // Wait for URL or detail content change — do not wait indefinitely for a popup
    await waitForDetailOpened(detailPage, previousUrl, pageTimeoutMs, logger);

    if (detailPage.url() === previousUrl && !(await hasDetailMarker(detailPage))) {
      // Fallback: navigate via href on a new page in the same context
      if (href && /^https?:/i.test(href)) {
        const page = await context.newPage();
        page.setDefaultTimeout(pageTimeoutMs);
        assertSameBrowserContext(page, context, logger, `T247-${id} href`);
        await page.goto(href, {
          waitUntil: "domcontentloaded",
          timeout: pageTimeoutMs,
        });
        detailPage = page;
        openedVia = "same_context_navigation";
      } else {
        throw new AutomationError(
          "TENDER247_VIEW_CLICKED_NO_DETAIL",
          `Eye/view clicked for T247-${id} but no detail page/tab opened`,
        );
      }
    }
  }

  await waitForAnyDetailMarker(detailPage, Math.min(pageTimeoutMs, 30_000), logger);
  await dismissTender247BlockingOverlays(detailPage, logger);
  await dismissTender247SupportChat(detailPage, logger).catch(() => undefined);
  logger.info("TENDER247_DETAIL_PAGE_OPENED");

  return {
    page: detailPage,
    openedVia,
    item: {
      t247Id: id,
      detailUrl: detailPage.url() || href || previousUrl,
      listTitle,
      listClosingDate,
    },
  };
}

async function waitForDetailOpened(
  page: Page,
  previousUrl: string,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, 20_000);
  while (Date.now() < deadline) {
    if (page.url() !== previousUrl) {
      logger.info(`Detail URL changed: ${page.url()}`);
      return;
    }
    if (await hasDetailMarker(page)) {
      logger.info("Detail markers appeared on same tab");
      return;
    }
    await page.waitForTimeout(250);
  }
}

async function hasDetailMarker(page: Page): Promise<boolean> {
  const markers = [
    page.getByText(/^Brief$/i).first(),
    page.getByText(/^Description$/i).first(),
    page.getByText(/Submission\s*Date/i).first(),
    page.getByText(/Tender\s*Documents/i).first(),
    page.getByText(/AI\s*Generated\s*Tender\s*Summary/i).first(),
  ];
  for (const marker of markers) {
    if (await marker.isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function waitForAnyDetailMarker(
  page: Page,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasDetailMarker(page)) {
      return;
    }
    await page.waitForTimeout(250);
  }
  logger.warn(
    "No detail markers (Brief/Description/Submission Date/Tender Documents/AI Summary) visible yet; continuing",
  );
}

async function logMatchedCardButtonDiagnostics(
  card: Locator,
  logger: Logger,
): Promise<void> {
  try {
    const rows = await card.evaluate((el: Element) => {
      const buttons = Array.from(el.querySelectorAll("button, [role='button'], a"));
      return buttons.slice(0, 20).map((node, index) => {
        const b = node as HTMLElement;
        return {
          index,
          tag: b.tagName.toLowerCase(),
          ariaLabel: b.getAttribute("aria-label"),
          title: b.getAttribute("title"),
          text: (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
          svgCount: b.querySelectorAll("svg").length,
          innerHtml: (b.innerHTML || "").replace(/\s+/g, " ").trim().slice(0, 300),
        };
      });
    });

    for (const row of rows) {
      logger.info(
        `card button[${row.index}] tag=${row.tag} aria="${row.ariaLabel}" title="${row.title}" text="${row.text}" svgCount=${row.svgCount} html="${row.innerHtml}"`,
      );
    }
    logger.info(`Matched card button diagnostics count=${rows.length}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Matched card button diagnostics failed: ${message}`);
  }
}

/**
 * Prefer eye/view controls inside the matched card only.
 * Never target Bid/No Bid, AI Summary, title, corrigendum, or org name.
 */
async function findEyeControlInCard(
  card: Locator,
  logger: Logger,
): Promise<Locator | null> {
  const forbidden =
    /bid\s*\/\s*no\s*bid|ai\s*summary|corrigendum|share|heart|favourite|favorite|like/i;

  // 1. aria-label / title containing view/details
  const named = card.locator(
    'button[aria-label*="view" i], button[title*="view" i], button[aria-label*="detail" i], button[title*="detail" i], a[aria-label*="view" i], a[title*="view" i], a[aria-label*="detail" i], a[title*="detail" i]',
  );
  const namedCount = await named.count().catch(() => 0);
  for (let i = 0; i < namedCount; i += 1) {
    const el = named.nth(i);
    if (!(await el.isVisible().catch(() => false))) {
      continue;
    }
    const label = (
      ((await el.getAttribute("aria-label").catch(() => null)) ||
        (await el.getAttribute("title").catch(() => null)) ||
        (await el.innerText().catch(() => "")) ||
        "") as string
    ).trim();
    if (forbidden.test(label)) {
      continue;
    }
    logger.info(`Eye control via aria/title: "${label}"`);
    return el;
  }

  // 2. recognizable eye SVG/icon / class
  const eyeIcon = card.locator(
    'button[class*="eye" i], a[class*="eye" i], [class*="eye" i], button:has(svg), [role="button"]:has(svg), a:has(svg)',
  );
  const iconCandidates: Locator[] = [];
  const iconCount = await eyeIcon.count().catch(() => 0);
  for (let i = 0; i < iconCount; i += 1) {
    const el = eyeIcon.nth(i);
    if (!(await el.isVisible().catch(() => false))) {
      continue;
    }
    const box = await el.boundingBox().catch(() => null);
    if (!box || box.width > 64 || box.height > 64) {
      continue;
    }
    const label = (
      ((await el.getAttribute("aria-label").catch(() => null)) ||
        (await el.getAttribute("title").catch(() => null)) ||
        (await el.getAttribute("class").catch(() => null)) ||
        "") as string
    ).trim();
    if (forbidden.test(label)) {
      continue;
    }
    if (/eye|view|detail/i.test(label)) {
      logger.info(`Eye control via recognizable eye/view class/label: "${label}"`);
      return el;
    }
    iconCandidates.push(el);
  }

  // 3. stable action attribute
  const actionAttr = card.locator(
    '[data-action*="view" i], [data-testid*="view" i], [data-tooltip*="view" i]',
  );
  if (
    (await actionAttr.count().catch(() => 0)) > 0 &&
    (await actionAttr.first().isVisible().catch(() => false))
  ) {
    logger.info("Eye control via data-action/testid/tooltip view attribute");
    return actionAttr.first();
  }

  // 4. Documented fallback: exactly 3 small action buttons → middle is eye (heart, eye, share)
  if (iconCandidates.length === 3) {
    logger.info(
      "Eye control fallback: middle of exactly 3 action-icon buttons (heart/eye/share)",
    );
    return iconCandidates[1] ?? null;
  }
  if (iconCandidates.length >= 2) {
    logger.info(
      `Eye control fallback: candidate index 1 of ${iconCandidates.length} small icon buttons`,
    );
    return iconCandidates[1] ?? null;
  }

  return null;
}

async function readCardTitle(card: Locator): Promise<string | null> {
  const heading = card.locator("h1, h2, h3, h4, a").first();
  if (!(await heading.isVisible().catch(() => false))) {
    return null;
  }
  const text = ((await heading.innerText().catch(() => "")) || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /T247\s*ID/i.test(text)) {
    return null;
  }
  return text.slice(0, 300);
}

async function readCardClosingDate(card: Locator): Promise<string | null> {
  const text = ((await card.innerText().catch(() => "")) || "").replace(
    /\s+/g,
    " ",
  );
  const match = text.match(
    /(?:closing|submission|due)[:\s-]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i,
  );
  return match?.[1] ?? null;
}

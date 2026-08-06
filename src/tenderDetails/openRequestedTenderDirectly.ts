import type { BrowserContext, Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "./dismissSupportChat.js";
import { assertSameBrowserContext } from "./ensureTender247LoggedIn.js";
import type { TenderListItem } from "./types.js";

export interface OpenRequestedDirectResult {
  page: Page;
  item: TenderListItem;
  openedVia: "popup" | "same_tab";
}

/**
 * Direct single-tender path — no Today Tenders card selection, no diagnostics,
 * no full-list collection. Assumes /auth/tender is already authenticated.
 */
export async function openRequestedTenderDirectly(
  page: Page,
  context: BrowserContext,
  requestedT247Id: string,
  pageTimeoutMs: number,
  logger: Logger,
): Promise<OpenRequestedDirectResult> {
  const id = requestedT247Id.replace(/\D/g, "");
  if (!id) {
    throw new AutomationError(
      "TENDER247_REQUESTED_TENDER_NOT_FOUND",
      "Requested T247 ID is empty after normalization",
    );
  }

  logger.info("SINGLE_TENDER_DIRECT_MODE");

  await dismissTender247BlockingOverlays(page, logger);
  await dismissTender247SupportChat(page, logger);

  const freshTab = page.getByText(/Fresh\s*\(\s*\d+\s*\)/i).first();
  await freshTab.waitFor({ state: "visible", timeout: 10_000 });
  logger.info("TENDER247_FRESH_LIST_READY");

  const card = await findRequestedCardDirect(page, id, logger);
  const listTitle = await readCardTitle(card);
  const listClosingDate = await readCardClosingDate(card);

  const viewButton = await findEyeInCardDirect(card, logger);
  if (!viewButton) {
    throw new AutomationError(
      "TENDER247_VIEW_CONTROL_NOT_FOUND",
      `Eye/view control not found inside matched card for T247-${id}`,
    );
  }
  logger.info("TENDER247_VIEW_BUTTON_FOUND");

  await dismissTender247SupportChat(page, logger);

  const previousUrl = page.url();
  const popupPromise = page
    .waitForEvent("popup", { timeout: 3_000 })
    .catch(() => null);

  await viewButton.click({ timeout: 10_000 });
  logger.info("TENDER247_VIEW_CLICKED");

  const popup = await popupPromise;
  let detailPage: Page;
  let openedVia: "popup" | "same_tab";

  if (popup) {
    detailPage = popup;
    openedVia = "popup";
    await detailPage
      .waitForLoadState("domcontentloaded", { timeout: pageTimeoutMs })
      .catch(() => undefined);
    detailPage.setDefaultTimeout(pageTimeoutMs);
    assertSameBrowserContext(detailPage, context, logger, `T247-${id} popup`);
  } else {
    detailPage = page;
    openedVia = "same_tab";
    await waitForDetailOrUrlChange(detailPage, previousUrl, pageTimeoutMs, logger);
  }

  await waitForAnyDetailMarker(detailPage, Math.min(pageTimeoutMs, 20_000), logger);
  await dismissTender247BlockingOverlays(detailPage, logger);
  await dismissTender247SupportChat(detailPage, logger);
  logger.info("TENDER247_DETAIL_PAGE_OPENED");

  return {
    page: detailPage,
    openedVia,
    item: {
      t247Id: id,
      detailUrl: detailPage.url() || previousUrl,
      listTitle,
      listClosingDate,
    },
  };
}

async function findRequestedCardDirect(
  page: Page,
  id: string,
  logger: Logger,
): Promise<Locator> {
  const idRegex = new RegExp(`T247\\s*ID\\s*[-:]?\\s*${id}\\b`, "i");

  const tryFind = async (): Promise<Locator | null> => {
    const idText = page.getByText(idRegex).first();
    if (!(await idText.isVisible().catch(() => false))) {
      return null;
    }

    // Mark smallest safe card via evaluate from the ID text
    const marked = await page.evaluate((patternSource: string) => {
      const re = new RegExp(patternSource, "i");
      document
        .querySelectorAll('[data-playwright-tender-card="true"]')
        .forEach((el) => el.removeAttribute("data-playwright-tender-card"));

      const all = Array.from(document.querySelectorAll("body *")) as HTMLElement[];
      let seed: HTMLElement | null = null;
      for (const el of all) {
        const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ");
        if (!re.test(text)) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 10) {
          continue;
        }
        if (rect.height > 200 && rect.width > 200) {
          continue; // prefer smaller text nodes as seeds
        }
        seed = el;
        break;
      }
      if (!seed) {
        // Fallback: any match
        for (const el of all) {
          const text = (el.innerText || "").replace(/\s+/g, " ");
          if (re.test(text)) {
            seed = el;
            break;
          }
        }
      }
      if (!seed) {
        return null;
      }

      let best: HTMLElement | null = null;
      let bestArea = Number.POSITIVE_INFINITY;
      let node: HTMLElement | null = seed;
      for (let depth = 0; depth < 14 && node; depth += 1) {
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        if (!re.test(text)) {
          node = node.parentElement;
          continue;
        }
        const rect = node.getBoundingClientRect();
        const area = Math.max(1, rect.width * rect.height);
        const looksLikeCard =
          rect.width >= 200 &&
          rect.width <= 1400 &&
          rect.height >= 80 &&
          rect.height <= 700;
        if (looksLikeCard && area < bestArea) {
          best = node;
          bestArea = area;
        }
        node = node.parentElement;
      }

      if (!best) {
        best = seed;
      }
      best.setAttribute("data-playwright-tender-card", "true");
      return (best.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200);
    }, idRegex.source);

    if (!marked) {
      return null;
    }

    const card = page.locator('[data-playwright-tender-card="true"]').first();
    if (!(await card.isVisible().catch(() => false))) {
      return null;
    }
    const cardText = ((await card.innerText().catch(() => "")) || "").replace(
      /\s+/g,
      " ",
    );
    if (!idRegex.test(cardText)) {
      return null;
    }
    return card;
  };

  // No scroll initially
  let card = await tryFind();
  if (card) {
    logger.info(`TENDER247_REQUESTED_TENDER_FOUND=${id}`);
    return card;
  }

  // Incremental scroll fallback only
  logger.info(
    `T247-${id} not in initial render; scrolling incrementally to find it`,
  );
  let stable = 0;
  let lastHeight = await page.evaluate(() => document.body.scrollHeight);
  for (let round = 1; round <= 30; round += 1) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.max(700, Math.floor(window.innerHeight * 0.85)));
    });
    await page.waitForTimeout(400);
    card = await tryFind();
    if (card) {
      logger.info(`TENDER247_REQUESTED_TENDER_FOUND=${id}`);
      return card;
    }
    const height = await page.evaluate(() => document.body.scrollHeight);
    const atBottom = await page.evaluate(
      () =>
        window.scrollY + window.innerHeight >= document.body.scrollHeight - 40,
    );
    if (height <= lastHeight && atBottom) {
      stable += 1;
    } else {
      stable = 0;
      lastHeight = height;
    }
    if (stable >= 3) {
      break;
    }
  }

  throw new AutomationError(
    "TENDER247_REQUESTED_TENDER_NOT_FOUND",
    `Requested tender T247 ID ${id} was not found (url=${page.url()})`,
  );
}

async function findEyeInCardDirect(
  card: Locator,
  logger: Logger,
): Promise<Locator | null> {
  const forbidden =
    /bid\s*\/\s*no\s*bid|ai\s*summary|corrigendum|share|heart|favourite|favorite|like/i;

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
        "") as string
    ).trim();
    if (forbidden.test(label)) {
      continue;
    }
    logger.info(`Eye via aria/title: "${label}"`);
    return el;
  }

  const eyeClass = card.locator(
    'button[class*="eye" i], a[class*="eye" i], [class*="eye" i]',
  );
  if (
    (await eyeClass.count().catch(() => 0)) > 0 &&
    (await eyeClass.first().isVisible().catch(() => false))
  ) {
    logger.info("Eye via class containing eye");
    return eyeClass.first();
  }

  // Action group fallback: exactly 3 small icon buttons → middle is eye
  const iconButtons = card.locator("button:has(svg), [role='button']:has(svg), a:has(svg)");
  const candidates: Locator[] = [];
  const count = await iconButtons.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const el = iconButtons.nth(i);
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
        "") as string
    ).trim();
    if (forbidden.test(label)) {
      continue;
    }
    candidates.push(el);
  }

  if (candidates.length === 3) {
    logger.info(
      "Eye fallback: middle of exactly 3 action buttons (heart/eye/share) in matched card",
    );
    return candidates[1] ?? null;
  }
  if (candidates.length >= 2) {
    logger.info(
      `Eye fallback: candidate[1] of ${candidates.length} small icon buttons in matched card`,
    );
    return candidates[1] ?? null;
  }

  return null;
}

async function waitForDetailOrUrlChange(
  page: Page,
  previousUrl: string,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, 15_000);
  while (Date.now() < deadline) {
    if (page.url() !== previousUrl) {
      logger.info(`Detail URL changed: ${page.url()}`);
      return;
    }
    if (await hasDetailMarker(page)) {
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
  for (const m of markers) {
    if (await m.isVisible().catch(() => false)) {
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
  logger.warn("No detail markers visible yet; continuing");
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

import type { Locator, Page } from "playwright";
import type { Logger } from "../logger.js";
import { readFilteredMailDateTab } from "../tenderDetails/selectTender247MailDate.js";
import {
  ensureTender247FreshListForDate,
  waitForFreshTenderList as waitForFreshTenderListImpl,
} from "./ensureTender247FreshListForDate.js";

const T247_ID_RE = /T247\s*ID\s*[-:]?\s*(\d+)/i;
const DETAIL_HREF_RE = /\/auth\/tender\/(\d+)\/([0-9a-f-]{8,})/i;

export interface LiveTenderCard {
  t247Id: string;
  /** Marked via data attribute for re-query; do not cache Locator across awaits long-term */
  rowMarker: string;
  href: string | null;
  securityCodeFromHref: string | null;
  titleHint: string | null;
}

export { ensureTender247FreshListForDate };

/**
 * Wait for the filtered tender list for an optional mail date.
 * Historical dates never treat today's Fresh badge alone as success.
 */
export async function waitForFreshTenderList(
  page: Page,
  logger: Logger,
  dateIso?: string,
): Promise<void> {
  return waitForFreshTenderListImpl(page, logger, dateIso);
}

/**
 * Re-query currently rendered bordered tender rows and return unique T247 cards
 * in visual (top-to-bottom) order. Never reuse Locators across detail-tab roundtrips —
 * call this fresh after each tender.
 */
export async function findVisibleLiveTenderCards(
  listPage: Page,
  logger: Logger,
): Promise<LiveTenderCard[]> {
  logger.info("VISIBLE_TENDERS_SCAN_START");

  // Clear previous markers
  await listPage
    .locator('[data-playwright-live-tender-row]')
    .evaluateAll((nodes) => {
      for (const n of nodes) {
        n.removeAttribute("data-playwright-live-tender-row");
      }
    })
    .catch(() => undefined);

  const idTexts = listPage.getByText(/T247\s*ID\s*[-:]?\s*\d+/i);
  const count = await idTexts.count();
  const cards: LiveTenderCard[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < count; i += 1) {
    const idLoc = idTexts.nth(i);
    if (!(await idLoc.isVisible().catch(() => false))) {
      continue;
    }

    const raw = ((await idLoc.innerText().catch(() => "")) || "").replace(
      /\s+/g,
      " ",
    );
    const idMatch = raw.match(T247_ID_RE);
    const t247Id = idMatch?.[1];
    if (!t247Id || seen.has(t247Id)) {
      continue;
    }

    const row = idLoc.locator(
      'xpath=ancestor::div[contains(@class,"border") and contains(@class,"w-full")][1]',
    );
    if (!(await row.isVisible().catch(() => false))) {
      continue;
    }

    const marker = `live-${t247Id}-${i}`;
    await row.evaluate(
      (el, m) => {
        el.setAttribute("data-playwright-live-tender-row", m);
      },
      marker,
    );

    const hrefInfo = await extractHrefFromRow(row, t247Id);
    const titleHint = await readTitleHint(row);

    seen.add(t247Id);
    cards.push({
      t247Id,
      rowMarker: marker,
      href: hrefInfo.href,
      securityCodeFromHref: hrefInfo.securityCode,
      titleHint,
    });
  }

  // Sort by vertical position
  const withY: Array<LiveTenderCard & { y: number }> = [];
  for (const card of cards) {
    const row = listPage.locator(
      `[data-playwright-live-tender-row="${card.rowMarker}"]`,
    );
    const box = await row.boundingBox().catch(() => null);
    withY.push({ ...card, y: box?.y ?? 0 });
  }
  withY.sort((a, b) => a.y - b.y);

  logger.info(`VISIBLE_LIVE_TENDER_CARDS=${withY.length}`);
  return withY.map(({ y: _y, ...rest }) => rest);
}

async function extractHrefFromRow(
  row: Locator,
  t247Id: string,
): Promise<{ href: string | null; securityCode: string | null }> {
  const anchors = row.locator("a[href]");
  const n = await anchors.count();
  for (let i = 0; i < n; i += 1) {
    const a = anchors.nth(i);
    const href = (await a.getAttribute("href").catch(() => null)) || "";
    const match = href.match(DETAIL_HREF_RE);
    if (match && match[1] === t247Id) {
      return {
        href: href.startsWith("http")
          ? href
          : `https://www.tender247.com${href.startsWith("/") ? "" : "/"}${href}`,
        securityCode: match[2] ?? null,
      };
    }
  }

  // data attributes that may encode detail URL
  const dataAttrs = [
    "data-href",
    "data-url",
    "data-link",
    "data-tender-url",
    "data-security-code",
    "data-security_code",
  ];
  for (const attr of dataAttrs) {
    const el = row.locator(`[${attr}]`).first();
    if (!(await el.count().catch(() => 0))) {
      continue;
    }
    const val = (await el.getAttribute(attr).catch(() => null)) || "";
    if (attr.includes("security")) {
      if (/^[0-9a-f-]{8,}$/i.test(val)) {
        return {
          href: `https://www.tender247.com/auth/tender/${t247Id}/${val}`,
          securityCode: val,
        };
      }
    }
    const match = val.match(DETAIL_HREF_RE);
    if (match && match[1] === t247Id) {
      return {
        href: val.startsWith("http")
          ? val
          : `https://www.tender247.com${val.startsWith("/") ? "" : "/"}${val}`,
        securityCode: match[2] ?? null,
      };
    }
  }

  return { href: null, securityCode: null };
}

async function readTitleHint(row: Locator): Promise<string | null> {
  const text = ((await row.innerText().catch(() => "")) || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return null;
  }
  // Prefer a substantial line that is not the T247 ID itself
  const parts = text.split(/(?<=\.)\s+|\n/).map((s) => s.trim());
  for (const p of parts) {
    if (p.length > 40 && !/^T247\s*ID/i.test(p)) {
      return p.slice(0, 300);
    }
  }
  return text.slice(0, 300);
}

export async function getLiveRowByMarker(
  listPage: Page,
  marker: string,
): Promise<Locator> {
  return listPage.locator(`[data-playwright-live-tender-row="${marker}"]`).first();
}

export async function readFreshExpectedCount(
  listPage: Page,
  logger: Logger,
  dateIso?: string,
): Promise<number> {
  if (dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    const filtered = await readFilteredMailDateTab(listPage, dateIso);
    if (filtered) {
      return filtered.filteredTenderCount;
    }
  }

  const fresh = listPage.getByText(/Fresh\s*\(\s*\d+\s*\)/i).first();
  if (!(await fresh.isVisible().catch(() => false))) {
    logger.warn("Fresh (N) badge not visible");
    return 0;
  }
  const text = ((await fresh.innerText().catch(() => "")) || "").replace(
    /\s+/g,
    " ",
  );
  const match = text.match(/Fresh\s*\(\s*(\d+)\s*\)/i);
  return match ? Number(match[1]) : 0;
}

export function parseSecurityCodeFromUrl(url: string): string | null {
  const match = url.match(DETAIL_HREF_RE);
  return match?.[2] ?? null;
}

export function parseT247IdFromUrl(url: string): string | null {
  const match = url.match(DETAIL_HREF_RE);
  return match?.[1] ?? null;
}

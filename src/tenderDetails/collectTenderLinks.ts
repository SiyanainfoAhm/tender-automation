import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { AppConfig } from "../config.js";
import { loadConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "./dismissSupportChat.js";
import { ensureTodayTendersSelected } from "./ensureTodayTendersSelected.js";
import type { TenderListItem } from "./types.js";

const T247_ID_RE = /T247\s*ID\s*[-:]?\s*(\d+)/i;

/**
 * Collect every Fresh/Today tender card's T247 ID + detail URL.
 * Scrolls until no new IDs appear for three consecutive checks.
 */
export async function collectTodayTenderLinks(
  page: Page,
  logger: Logger,
  dateFolder: string,
  config: AppConfig = loadConfig(),
): Promise<TenderListItem[]> {
  logger.info("List collection start");
  await dismissTender247BlockingOverlays(page, logger, config);
  await dismissPageOverlays(page, logger);

  // Hard gate: never scrape Closed / Active / Interested / Reminders
  logger.info("FULL_CRAWL_CALLING_ENSURE_TODAY");
  await ensureTodayTendersSelected(page, logger, config, "full");
  await selectFreshTabIfNeeded(page, logger);

  const byId = new Map<string, TenderListItem>();
  let stableRounds = 0;
  let scrollRound = 0;

  while (stableRounds < 3) {
    scrollRound += 1;
    const before = byId.size;
    const batch = await extractVisibleCards(page);
    for (const item of batch) {
      if (!byId.has(item.t247Id)) {
        byId.set(item.t247Id, item);
      }
    }
    const after = byId.size;
    logger.info(
      `Scrolling progress: round=${scrollRound}, cards=${after} (+${after - before})`,
    );

    if (after === before) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    await page.evaluate(() => {
      window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.85)));
    });
    await page.waitForTimeout(700);
    await dismissTender247BlockingOverlays(page, logger, config).catch(() => undefined);
  }

  const items = Array.from(byId.values());
  logger.info(`Tender count discovered: ${items.length}`);

  const discoveredPath = path.join(dateFolder, "discovered-tenders.json");
  fs.mkdirSync(dateFolder, { recursive: true });
  fs.writeFileSync(
    discoveredPath,
    JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        count: items.length,
        tenders: items,
      },
      null,
      2,
    ),
    "utf8",
  );
  logger.info(`Discovered list saved: ${path.relative(process.cwd(), discoveredPath)}`);

  return items;
}

async function selectFreshTabIfNeeded(page: Page, logger: Logger): Promise<void> {
  const fresh = page
    .getByRole("tab", { name: /Fresh/i })
    .or(page.getByRole("button", { name: /Fresh\s*\(/i }))
    .or(page.getByText(/Fresh\s*\(\d+\)/i))
    .first();

  if (!(await fresh.isVisible().catch(() => false))) {
    logger.warn("Fresh tab control not found — assuming Fresh is default");
    return;
  }

  const selected =
    (await fresh.getAttribute("aria-selected").catch(() => null)) === "true" ||
    (await fresh.getAttribute("aria-current").catch(() => null)) === "page" ||
    /active|selected|current/i.test(
      (await fresh.getAttribute("class").catch(() => "")) ?? "",
    );

  if (selected) {
    logger.info("Fresh tab already active");
    return;
  }

  await fresh.click();
  logger.info("Selected Fresh tab");
  await page
    .getByText(/T247\s*ID/i)
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => undefined);
}

async function extractVisibleCards(page: Page): Promise<TenderListItem[]> {
  return page.evaluate((idPatternSource) => {
    const idRe = new RegExp(idPatternSource, "i");
    const results: Array<{
      t247Id: string;
      detailUrl: string;
      listTitle: string | null;
      listClosingDate: string | null;
    }> = [];

    const idNodes = Array.from(document.querySelectorAll("body *")).filter((el) => {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      return idRe.test(text) && text.length < 80;
    });

    const seen = new Set<string>();

    for (const node of idNodes) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      const match = text.match(idRe);
      const t247Id = match?.[1];
      if (!t247Id || seen.has(t247Id)) {
        continue;
      }

      const card =
        node.closest(
          "article, li, [class*='card' i], [class*='tender' i], [class*='result' i], section, div",
        ) ?? node.parentElement;
      if (!card) {
        continue;
      }

      const cardText = (card.textContent ?? "").replace(/\s+/g, " ").trim();
      const idInCard = cardText.match(idRe)?.[1];
      if (idInCard !== t247Id) {
        continue;
      }

      let detailUrl = "";
      const anchors = Array.from(card.querySelectorAll("a[href]")) as HTMLAnchorElement[];
      for (const a of anchors) {
        const href = a.href || "";
        if (!href || href.startsWith("javascript:")) {
          continue;
        }
        if (
          /tender|detail|view|bid/i.test(href) ||
          /tender|view|details|read more/i.test(a.textContent ?? "")
        ) {
          detailUrl = href;
          break;
        }
      }
      if (!detailUrl && anchors[0]?.href) {
        detailUrl = anchors[0].href;
      }
      if (!detailUrl) {
        continue;
      }

      let listTitle: string | null = null;
      const heading = card.querySelector("h1, h2, h3, h4, [class*='title' i], [class*='brief' i]");
      if (heading?.textContent) {
        listTitle = heading.textContent.replace(/\s+/g, " ").trim() || null;
      }
      if (!listTitle) {
        const firstLine = cardText
          .replace(idRe, "")
          .split(/\s{2,}|\n/)
          .map((s) => s.trim())
          .find((s) => s.length > 20);
        listTitle = firstLine ?? null;
      }

      let listClosingDate: string | null = null;
      const dateMatch = cardText.match(
        /(?:closing|last|deadline|submission)[:\s]*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i,
      );
      if (dateMatch?.[1]) {
        listClosingDate = dateMatch[1];
      }

      seen.add(t247Id);
      results.push({ t247Id, detailUrl, listTitle, listClosingDate });
    }

    return results;
  }, T247_ID_RE.source);
}

/**
 * Close/minimize common overlays that obstruct controls (no CAPTCHA interaction).
 * NEEDS LIVE VERIFICATION for Zendesk / renewal banner selectors.
 */
export async function dismissPageOverlays(
  page: Page,
  logger: Logger,
): Promise<void> {
  await dismissTender247BlockingOverlays(page, logger).catch(() => undefined);
  await dismissTender247SupportChat(page, logger).catch(() => undefined);

  const candidates = [
    page.getByRole("button", { name: /close|dismiss|minimize|not now|later/i }),
    page.locator(
      '[aria-label*="close" i], [title*="close" i], button[class*="close" i]',
    ),
    page.locator(
      '#launcher, .zEWidget-launcher, iframe[name*="zendesk" i], [class*="zendesk" i]',
    ),
  ];

  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 5); i += 1) {
      const el = locator.nth(i);
      if (!(await el.isVisible().catch(() => false))) {
        continue;
      }
      const meta = (
        (await el.getAttribute("aria-label").catch(() => null)) ||
        (await el.innerText().catch(() => "")) ||
        ""
      ).toLowerCase();
      if (/captcha|recaptcha/.test(meta)) {
        continue;
      }
      // Prefer closing chat/minimizing rather than opening
      if (/close|dismiss|minimize|not now|later|×|✕/.test(meta) || meta === "") {
        await el.click({ timeout: 2_000 }).catch(() => undefined);
        logger.info("Dismissed or minimized an overlay control");
      }
    }
  }

  // Escape as gentle fallback for modal banners
  await page.keyboard.press("Escape").catch(() => undefined);
}

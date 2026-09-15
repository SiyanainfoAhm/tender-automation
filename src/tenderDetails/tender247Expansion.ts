/**
 * Tender247 card expansion: explicit View/Eye, else title span.
 * Never click generic SVGs, right-cursor controls, or reminder/share/bid icons.
 */
import type { BrowserContext, Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";
import {
  dismissTender247AdvanceSearchModal,
  dismissTender247ReminderModal,
  isReminderModalVisible,
} from "./dismissTender247Interruptions.js";

export type Tender247ExpansionMethod = "VIEW" | "TITLE";

export type ExpansionLog = Pick<Logger, "info" | "warn" | "error">;

const ACTION_BLACKLIST_RE =
  /reminder|whatsapp|whats\s*app|e-?mail|\bbid\b|\bno\s*bid\b|ai\s*summary|favourite|favorite|\bshare\b/i;

const SHORT_ACTION_LABEL_RE =
  /^(set\s*)?(reminder|whatsapp|email|e-mail|bid|no\s*bid|share|favourite|favorite|ai\s*summary)$/i;

const VIEW_LABEL_RE = /\b(view|eye)\b/i;

export function normalizeExpansionTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function expansionTitlesMatch(
  actual: string,
  expected: string,
): boolean {
  const a = normalizeExpansionTitle(actual);
  const e = normalizeExpansionTitle(expected);
  if (!a || !e) {
    return false;
  }
  if (a === e) {
    return true;
  }
  const prefixLen = Math.min(80, a.length, e.length);
  if (prefixLen >= 50) {
    return a.slice(0, prefixLen) === e.slice(0, prefixLen);
  }
  return a.startsWith(e) || e.startsWith(a);
}

export function isBlacklistedActionText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  if (SHORT_ACTION_LABEL_RE.test(normalized)) {
    return true;
  }
  return normalized.length <= 48 && ACTION_BLACKLIST_RE.test(normalized);
}

function t247Log(logger: ExpansionLog, id: string, message: string): void {
  const line = `[T247 ${id}] ${message}`;
  console.log(line);
  logger.info(line);
}

async function controlFingerprint(locator: Locator): Promise<string> {
  const parts = [
    (await locator.innerText().catch(() => "")) || "",
    (await locator.getAttribute("aria-label").catch(() => null)) || "",
    (await locator.getAttribute("title").catch(() => null)) || "",
    (await locator.getAttribute("class").catch(() => null)) || "",
  ];
  return parts.join(" ");
}

async function isBlacklistedExpansionControl(locator: Locator): Promise<boolean> {
  let current: Locator | null = locator;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const aria = (await current.getAttribute("aria-label").catch(() => null)) || "";
    const title = (await current.getAttribute("title").catch(() => null)) || "";
    const className = (await current.getAttribute("class").catch(() => null)) || "";
    if (ACTION_BLACKLIST_RE.test(`${aria} ${title} ${className}`)) {
      return true;
    }
    const text = ((await current.innerText().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 0 && text.length <= 48 && isBlacklistedActionText(text)) {
      return true;
    }
    const parent = current.locator("xpath=..");
    if ((await parent.count().catch(() => 0)) === 0) {
      break;
    }
    current = parent;
  }
  return false;
}

async function countLowerRightSvgs(row: Locator): Promise<number> {
  const rowBox = await row.boundingBox().catch(() => null);
  if (!rowBox) {
    return 0;
  }
  const svgs = row.locator("svg");
  const svgCount = await svgs.count();
  const rightThreshold = rowBox.x + rowBox.width * 0.65;
  const lowerThreshold = rowBox.y + rowBox.height * 0.45;
  let lowerRight = 0;
  for (let i = 0; i < svgCount; i += 1) {
    const svg = svgs.nth(i);
    const box = await svg.boundingBox().catch(() => null);
    if (!box || !(await svg.isVisible().catch(() => false))) {
      continue;
    }
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    if (centerX > rightThreshold && centerY > lowerThreshold) {
      lowerRight += 1;
    }
  }
  return lowerRight;
}

async function findDetailHrefControl(
  row: Locator,
  t247Id: string,
): Promise<Locator | null> {
  const hrefRe = new RegExp(
    `/auth/(?:global)?tender/${t247Id}(?:/|\\?|$)`,
    "i",
  );
  // Include hidden anchors — Tender247 sometimes keeps the portal link off-screen.
  const links = row.locator(
    'a[href*="/auth/tender/"], a[href*="/auth/globaltender/"]',
  );
  const count = await links.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const link = links.nth(i);
    const href = (await link.getAttribute("href").catch(() => null)) || "";
    if (
      !hrefRe.test(href) &&
      !href.toLowerCase().includes(`/auth/tender/${t247Id}`) &&
      !href.toLowerCase().includes(`/auth/globaltender/${t247Id}`)
    ) {
      continue;
    }
    if (await isBlacklistedExpansionControl(link)) continue;
    return link;
  }

  const loose = row
    .locator(
      `a[href*="/auth/tender/${t247Id}"], a[href*="/auth/globaltender/${t247Id}"]`,
    )
    .first();
  if (
    (await loose.count().catch(() => 0)) > 0 &&
    !(await isBlacklistedExpansionControl(loose))
  ) {
    return loose;
  }
  return null;
}

/**
 * Recover a detail portal URL from row HTML / data attrs when no visible <a> exists.
 * Title clicks open Set Reminder on some cards; this is the escape hatch.
 */
async function findDetailUrlInRow(
  row: Locator,
  t247Id: string,
): Promise<string | null> {
  const hrefRe = new RegExp(
    `(?:https?:\\/\\/[^"'\\s]+)?(\\/auth\\/(?:global)?tender)\\/${t247Id}\\/([0-9a-f-]{8,})`,
    "i",
  );

  const html = (await row.innerHTML().catch(() => "")) || "";
  const htmlMatch = html.match(hrefRe);
  if (htmlMatch?.[1] && htmlMatch?.[2]) {
    return `https://www.tender247.com${htmlMatch[1]}/${t247Id}/${htmlMatch[2]}`;
  }

  const fromAttrs = await row
    .evaluate(
      (el, id) => {
        const re = new RegExp(
          `(?:https?:\\/\\/[^"'\\s]+)?(\\/auth\\/(?:global)?tender)\\/${id}\\/([0-9a-f-]{8,})`,
          "i",
        );
        const attrs = [
          "href",
          "data-href",
          "data-url",
          "data-link",
          "data-tender-url",
          "data-security-code",
          "data-security_code",
        ];
        const walk = (node: Element): string | null => {
          for (const attr of attrs) {
            const val = node.getAttribute(attr);
            if (!val) continue;
            if (
              /security/i.test(attr) &&
              /^[0-9a-f-]{8,}$/i.test(val.trim())
            ) {
              const onGlobal =
                typeof location !== "undefined" &&
                /globaltender/i.test(location.pathname || "");
              const prefix = onGlobal ? "/auth/globaltender" : "/auth/tender";
              return `https://www.tender247.com${prefix}/${id}/${val.trim()}`;
            }
            const m = val.match(re);
            if (m?.[1] && m?.[2]) {
              return `https://www.tender247.com${m[1]}/${id}/${m[2]}`;
            }
          }
          for (const child of Array.from(node.children)) {
            const found = walk(child);
            if (found) return found;
          }
          return null;
        };
        return walk(el);
      },
      t247Id,
    )
    .catch(() => null);

  return fromAttrs || null;
}

async function openDetailUrlInNewPage(
  context: BrowserContext,
  detailUrl: string,
  logger: ExpansionLog,
  t247Id: string,
): Promise<boolean> {
  try {
    t247Log(logger, t247Id, `DETAIL_URL_NAVIGATE=${detailUrl}`);
    const detailPage = await context.newPage();
    await detailPage.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    return true;
  } catch (error) {
    logger.warn(
      `DETAIL_URL_NAVIGATE_FAILED=${
        error instanceof Error ? error.message.slice(0, 160) : String(error)
      }`,
    );
    return false;
  }
}

async function findExplicitViewControl(
  row: Locator,
): Promise<Locator | null> {
  const labeled = row.locator(
    [
      '[aria-label*="view" i]',
      '[aria-label*="eye" i]',
      '[title*="view" i]',
      '[title*="eye" i]',
    ].join(", "),
  );
  const count = await labeled.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const el = labeled.nth(i);
    if (!(await el.isVisible().catch(() => false))) {
      continue;
    }
    if (await isBlacklistedExpansionControl(el)) {
      continue;
    }
    const blob = await controlFingerprint(el);
    if (!VIEW_LABEL_RE.test(blob)) {
      continue;
    }
    return el;
  }

  const named = row.getByRole("button", { name: VIEW_LABEL_RE });
  if (
    (await named.count().catch(() => 0)) > 0 &&
    (await named.first().isVisible().catch(() => false)) &&
    !(await isBlacklistedExpansionControl(named.first()))
  ) {
    return named.first();
  }

  return null;
}

async function findTitleCursorSpan(
  row: Locator,
  titleHint: string | null,
): Promise<{ locator: Locator; text: string } | null> {
  const spans = row.locator("p span.cursor-pointer");
  const count = await spans.count().catch(() => 0);
  const candidates: Array<{ locator: Locator; text: string }> = [];

  for (let i = 0; i < count; i += 1) {
    const span = spans.nth(i);
    if (!(await span.isVisible().catch(() => false))) {
      continue;
    }
    const text = ((await span.innerText().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || /T247\s*ID/i.test(text)) {
      continue;
    }
    if (text.length <= 40 && isBlacklistedActionText(text)) {
      continue;
    }
    candidates.push({ locator: span, text });
  }

  if (candidates.length === 0) {
    return null;
  }

  if (titleHint) {
    const matched = candidates.find((c) =>
      expansionTitlesMatch(c.text, titleHint),
    );
    if (matched) {
      return matched;
    }
  }

  candidates.sort((a, b) => b.text.length - a.text.length);
  return candidates[0] ?? null;
}

export async function readTender247CardTitle(
  row: Locator,
): Promise<string | null> {
  const fromSpan = await findTitleCursorSpan(row, null);
  if (fromSpan?.text) {
    return fromSpan.text.slice(0, 300);
  }
  const heading = row.locator("h1, h2, h3, h4, a").first();
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

async function clickControl(control: Locator): Promise<void> {
  try {
    await control.click({ timeout: 5_000 });
  } catch {
    await control.click({ timeout: 5_000, force: true });
  }
}

/**
 * Click the left portion of the title — right-side action icons (Reminder)
 * sit next to the title and steal center/right clicks.
 */
async function clickTitleAwayFromActions(control: Locator): Promise<void> {
  const box = await control.boundingBox().catch(() => null);
  if (box && box.width >= 48 && box.height >= 8) {
    const x = box.x + Math.min(36, Math.max(8, box.width * 0.18));
    const y = box.y + box.height / 2;
    await control.page().mouse.click(x, y);
    return;
  }
  await clickControl(control);
}

async function expansionLooksVerified(
  page: Page,
  row: Locator,
  beforeHeight?: number | null,
): Promise<boolean> {
  if ((await row.getAttribute("data-expanded").catch(() => null)) === "true") {
    return true;
  }
  // Require real growth vs pre-click height. Absolute height>220 is a false
  // positive — search-result cards are often already ~222px tall when collapsed.
  const rowBox = await row.boundingBox().catch(() => null);
  if (
    rowBox &&
    beforeHeight != null &&
    Number.isFinite(beforeHeight) &&
    beforeHeight > 0 &&
    rowBox.height >= beforeHeight + 80
  ) {
    return true;
  }
  const markers = [
    page.getByText(/^Brief$/i).first(),
    page.getByText(/^Description$/i).first(),
    page.getByText(/Submission\s*Date/i).first(),
    page.getByText(/AI\s*Summary/i).first(),
    page.getByRole("button", { name: /download\s*all|all\s*documents/i }).first(),
  ];
  for (const marker of markers) {
    if (await marker.isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

/**
 * Select and click the expansion control for one tender row.
 * View/Eye only when positively identified; otherwise title span.
 */
export async function expandTender247Row(options: {
  page: Page;
  row: Locator;
  t247Id: string;
  titleHint?: string | null;
  logger: ExpansionLog;
  context?: BrowserContext;
}): Promise<{ method: Tender247ExpansionMethod; titleText: string | null }> {
  const { page, row, t247Id, logger } = options;
  const pagesBefore = options.context?.pages().length ?? 0;
  const beforeHeight =
    (await row.boundingBox().catch(() => null))?.height ?? null;
  t247Log(logger, t247Id, "EXPAND_START");
  if (beforeHeight != null) {
    t247Log(logger, t247Id, `EXPAND_BEFORE_HEIGHT=${Math.round(beforeHeight)}`);
  }
  await dismissTender247AdvanceSearchModal(page, logger);

  const lowerRight = await countLowerRightSvgs(row);
  logger.info(`TENDER247_LOWER_RIGHT_SVG_CANDIDATES=${lowerRight}`);
  console.log(`TENDER247_LOWER_RIGHT_SVG_CANDIDATES=${lowerRight}`);

  // Prefer a real detail href — title clicks open Set Reminder on some cards.
  const detailLink = await findDetailHrefControl(row, t247Id);
  t247Log(
    logger,
    t247Id,
    `DETAIL_HREF_FOUND=${detailLink ? "true" : "false"}`,
  );
  if (detailLink) {
    await clickControl(detailLink);
    t247Log(logger, t247Id, "DETAIL_HREF_CLICKED=true");
    if (await isReminderModalVisible(page)) {
      logger.warn("REMINDER_MODAL_OPENED_UNEXPECTEDLY");
      await dismissTender247ReminderModal(page, logger);
      await dismissTender247AdvanceSearchModal(page, logger);
    } else {
      const verified = await waitForExpansion(
        page,
        row,
        options.context,
        pagesBefore,
        beforeHeight,
      );
      t247Log(logger, t247Id, `EXPANSION_VERIFIED=${verified}`);
      if (verified) {
        t247Log(logger, t247Id, "EXPAND_METHOD=HREF");
        return {
          method: "VIEW",
          titleText: options.titleHint ?? (await readTender247CardTitle(row)),
        };
      }
    }
  }

  // Embedded portal URL in row markup (often no visible <a>) — skip title/Reminder.
  const embeddedUrl = await findDetailUrlInRow(row, t247Id);
  t247Log(
    logger,
    t247Id,
    `DETAIL_URL_EMBEDDED=${embeddedUrl ? "true" : "false"}`,
  );
  if (embeddedUrl && options.context) {
    const opened = await openDetailUrlInNewPage(
      options.context,
      embeddedUrl,
      logger,
      t247Id,
    );
    if (opened) {
      t247Log(logger, t247Id, "EXPAND_METHOD=DETAIL_URL");
      return {
        method: "VIEW",
        titleText: options.titleHint ?? (await readTender247CardTitle(row)),
      };
    }
  }

  const explicitView = await findExplicitViewControl(row);
  t247Log(
    logger,
    t247Id,
    `EXPLICIT_VIEW_CONTROL_FOUND=${explicitView ? "true" : "false"}`,
  );

  if (explicitView) {
    logger.info("TENDER247_VIEW_CONTROL_SELECTED_EXPLICIT");
    await clickControl(explicitView);
    logger.info("TENDER247_VIEW_CLICKED");
    if (await isReminderModalVisible(page)) {
      logger.warn("REMINDER_MODAL_OPENED_UNEXPECTEDLY");
      console.log("REMINDER_MODAL_OPENED_UNEXPECTEDLY");
      t247Log(logger, t247Id, "REMINDER_MODAL_OPENED_UNEXPECTEDLY");
      await dismissTender247ReminderModal(page, logger);
      return clickTitleFallback({
        page,
        row,
        t247Id,
        titleHint: options.titleHint ?? (await readTender247CardTitle(row)),
        logger,
        context: options.context,
        pagesBefore,
        beforeHeight,
      });
    }
    const verified = await waitForExpansion(
      page,
      row,
      options.context,
      pagesBefore,
      beforeHeight,
    );
    t247Log(logger, t247Id, `EXPANSION_VERIFIED=${verified}`);
    if (verified) {
      t247Log(logger, t247Id, "EXPAND_METHOD=VIEW");
      return {
        method: "VIEW",
        titleText: options.titleHint ?? (await readTender247CardTitle(row)),
      };
    }
    t247Log(logger, t247Id, "EXPAND_VIEW_NOT_VERIFIED=true");
  }

  logger.info("TENDER247_TITLE_FALLBACK_START=true");
  console.log("TENDER247_TITLE_FALLBACK_START=true");

  return clickTitleFallback({
    page,
    row,
    t247Id,
    titleHint: options.titleHint ?? (await readTender247CardTitle(row)),
    logger,
    context: options.context,
    pagesBefore,
    beforeHeight,
  });
}

async function waitForExpansion(
  page: Page,
  row: Locator,
  context?: BrowserContext,
  pagesBefore = 0,
  beforeHeight?: number | null,
): Promise<boolean> {
  const deadline = Date.now() + 2_500;
  while (Date.now() < deadline) {
    if (await expansionLooksVerified(page, row, beforeHeight)) {
      return true;
    }
    if (context && context.pages().length > pagesBefore) {
      return true;
    }
    const url = page.url();
    if (/security_code=|\/tender\/\d+/i.test(url) && !/\/auth\/tender\/?(\?|$)/i.test(url)) {
      return true;
    }
    await page.waitForTimeout(100);
  }
  if (context && context.pages().length > pagesBefore) {
    return true;
  }
  return expansionLooksVerified(page, row, beforeHeight);
}

async function resolveFreshTenderRow(
  page: Page,
  t247Id: string,
): Promise<Locator | null> {
  const idRe = new RegExp(`T247\\s*ID\\s*[-:]?\\s*${t247Id}\\b`, "i");
  const idText = page.getByText(idRe).first();
  if (!(await idText.isVisible().catch(() => false))) {
    return null;
  }
  const row = idText.locator(
    'xpath=ancestor::div[contains(@class,"border") and contains(@class,"w-full")][1]',
  );
  if (!(await row.isVisible().catch(() => false))) {
    return null;
  }
  return row;
}

async function clickTitleFallback(options: {
  page: Page;
  row: Locator;
  t247Id: string;
  titleHint: string | null;
  logger: ExpansionLog;
  context?: BrowserContext;
  pagesBefore?: number;
  beforeHeight?: number | null;
}): Promise<{ method: "TITLE"; titleText: string | null }> {
  const { page, t247Id, logger, titleHint } = options;
  let row = options.row;
  const beforeHeight =
    options.beforeHeight ??
    (await row.boundingBox().catch(() => null))?.height ??
    null;
  t247Log(logger, t247Id, "TITLE_FALLBACK_START=true");

  const found = await findTitleCursorSpan(row, titleHint);
  if (!found) {
    throw new AutomationError(
      "TENDER247_TITLE_FALLBACK_NOT_FOUND",
      `No p > span.cursor-pointer title for T247-${t247Id}`,
    );
  }

  t247Log(logger, t247Id, `TITLE_TEXT="${found.text}"`);
  t247Log(logger, t247Id, "TITLE_CURSOR_SPAN_FOUND=true");

  await clickTitleAwayFromActions(found.locator);
  t247Log(logger, t247Id, "TITLE_CLICKED=true");

  if (await isReminderModalVisible(page)) {
    logger.warn("REMINDER_MODAL_OPENED_UNEXPECTEDLY");
    console.log("REMINDER_MODAL_OPENED_UNEXPECTEDLY");
    t247Log(logger, t247Id, "REMINDER_MODAL_OPENED_UNEXPECTEDLY");
    await dismissTender247ReminderModal(page, logger);
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(400);
    await dismissTender247AdvanceSearchModal(page, logger);
    if (await isReminderModalVisible(page)) {
      await dismissTender247ReminderModal(page, logger);
    }

    // Reminder/overlays detach the original row — re-resolve from T247 ID.
    const fresh = await resolveFreshTenderRow(page, t247Id);
    if (fresh) {
      row = fresh;
      t247Log(logger, t247Id, "TITLE_FALLBACK_ROW_REFRESHED=true");
    }

    t247Log(logger, t247Id, "TITLE_FALLBACK_RETRY=true");
    let retry = await findTitleCursorSpan(row, titleHint ?? found.text);

    // Prefer clicking a detail href — title click opens Set Reminder on some cards.
    const href = await findDetailHrefControl(row, t247Id);
    if (href) {
      t247Log(logger, t247Id, "TITLE_FALLBACK_CLICK_DETAIL_HREF=true");
      try {
        await href.click({ timeout: 8_000, force: true });
      } catch {
        await href.evaluate((el: HTMLElement) => el.click());
      }
      t247Log(logger, t247Id, "TITLE_CLICKED=true");
      if (!(await isReminderModalVisible(page))) {
        const verifiedViaHref = await waitForExpansion(
          page,
          row,
          options.context,
          options.pagesBefore ?? 0,
          beforeHeight,
        );
        t247Log(logger, t247Id, `EXPANSION_VERIFIED=${verifiedViaHref}`);
        if (verifiedViaHref) {
          t247Log(logger, t247Id, "EXPAND_METHOD=HREF");
          return { method: "TITLE", titleText: found.text };
        }
      }
      await dismissTender247ReminderModal(page, logger);
    }

    // No clickable title/href left — navigate via security-code URL embedded in the row.
    const detailUrl = await findDetailUrlInRow(row, t247Id);
    if (detailUrl && options.context) {
      const opened = await openDetailUrlInNewPage(
        options.context,
        detailUrl,
        logger,
        t247Id,
      );
      if (opened) {
        t247Log(logger, t247Id, "EXPAND_METHOD=DETAIL_URL");
        return { method: "TITLE", titleText: found.text };
      }
    }

    // Prefer clicking the T247 ID label — title click can open Set Reminder.
    const idLabel = page
      .getByText(new RegExp(`T247\\s*ID\\s*[-:]?\\s*${t247Id}\\b`, "i"))
      .first();
    if (await idLabel.isVisible().catch(() => false)) {
      t247Log(logger, t247Id, "TITLE_FALLBACK_CLICK_ID_LABEL=true");
      try {
        // Modifier click sometimes opens detail instead of Reminder.
        await idLabel.click({ timeout: 8_000, force: true, modifiers: ["Control"] });
      } catch {
        try {
          await idLabel.click({ timeout: 8_000, force: true });
        } catch {
          await idLabel.evaluate((el: HTMLElement) => el.click());
        }
      }
      t247Log(logger, t247Id, "TITLE_CLICKED=true");
      if (!(await isReminderModalVisible(page))) {
        const verifiedViaId = await waitForExpansion(
          page,
          row,
          options.context,
          options.pagesBefore ?? 0,
          beforeHeight,
        );
        t247Log(logger, t247Id, `EXPANSION_VERIFIED=${verifiedViaId}`);
        if (verifiedViaId) {
          t247Log(logger, t247Id, "EXPAND_METHOD=TITLE");
          return { method: "TITLE", titleText: found.text };
        }
      }
      await dismissTender247ReminderModal(page, logger);
    }

    if (!retry) {
      retry = await findTitleCursorSpan(row, titleHint ?? found.text);
    }
    if (!retry) {
      // Last resort: Ctrl+click original title coords if we still have a span, else fail.
      if (detailUrl && options.context) {
        const opened = await openDetailUrlInNewPage(
          options.context,
          detailUrl,
          logger,
          t247Id,
        );
        if (opened) {
          t247Log(logger, t247Id, "EXPAND_METHOD=DETAIL_URL");
          return { method: "TITLE", titleText: found.text };
        }
      }
      throw new AutomationError(
        "TENDER247_TITLE_FALLBACK_NOT_FOUND",
        `No p > span.cursor-pointer title for T247-${t247Id} after reminder dismiss`,
      );
    }
    try {
      await clickTitleAwayFromActions(retry.locator);
    } catch {
      await retry.locator.evaluate((el: HTMLElement) => el.click());
    }
    t247Log(logger, t247Id, "TITLE_CLICKED=true");
    if (await isReminderModalVisible(page)) {
      await dismissTender247ReminderModal(page, logger);
    }
  }

  const verified = await waitForExpansion(
    page,
    row,
    options.context,
    options.pagesBefore ?? 0,
    beforeHeight,
  );
  t247Log(logger, t247Id, `EXPANSION_VERIFIED=${verified}`);
  if (!verified) {
    const detailUrl = await findDetailUrlInRow(row, t247Id);
    if (detailUrl && options.context) {
      const opened = await openDetailUrlInNewPage(
        options.context,
        detailUrl,
        logger,
        t247Id,
      );
      if (opened) {
        t247Log(logger, t247Id, "EXPAND_METHOD=DETAIL_URL");
        return { method: "TITLE", titleText: found.text };
      }
    }
    throw new AutomationError(
      "TENDER247_EXPANSION_NOT_VERIFIED",
      `Title click did not open detail for T247-${t247Id}`,
    );
  }
  t247Log(logger, t247Id, "EXPAND_METHOD=TITLE");
  return { method: "TITLE", titleText: found.text };
}

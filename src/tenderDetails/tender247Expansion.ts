/**
 * Tender247 card expansion: explicit View/Eye, else title span.
 * Never click generic SVGs, right-cursor controls, or reminder/share/bid icons.
 */
import type { BrowserContext, Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";
import {
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

async function expansionLooksVerified(
  page: Page,
  row: Locator,
): Promise<boolean> {
  if ((await row.getAttribute("data-expanded").catch(() => null)) === "true") {
    return true;
  }
  const rowBox = await row.boundingBox().catch(() => null);
  if (rowBox && rowBox.height > 220) {
    return true;
  }
  const markers = [
    page.getByText(/^Brief$/i).first(),
    page.getByText(/^Description$/i).first(),
    page.getByText(/Submission\s*Date/i).first(),
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
  t247Log(logger, t247Id, "EXPAND_START");

  const lowerRight = await countLowerRightSvgs(row);
  logger.info(`TENDER247_LOWER_RIGHT_SVG_CANDIDATES=${lowerRight}`);
  console.log(`TENDER247_LOWER_RIGHT_SVG_CANDIDATES=${lowerRight}`);

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
      });
    }
    const verified = await waitForExpansion(
      page,
      row,
      options.context,
      pagesBefore,
    );
    t247Log(logger, t247Id, `EXPANSION_VERIFIED=${verified}`);
    t247Log(logger, t247Id, "EXPAND_METHOD=VIEW");
    return {
      method: "VIEW",
      titleText: options.titleHint ?? (await readTender247CardTitle(row)),
    };
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
  });
}

async function waitForExpansion(
  page: Page,
  row: Locator,
  context?: BrowserContext,
  pagesBefore = 0,
): Promise<boolean> {
  const deadline = Date.now() + 400;
  while (Date.now() < deadline) {
    if (await expansionLooksVerified(page, row)) {
      return true;
    }
    if (context && context.pages().length > pagesBefore) {
      return true;
    }
    await page.waitForTimeout(50);
  }
  if (context && context.pages().length > pagesBefore) {
    return true;
  }
  return expansionLooksVerified(page, row);
}

async function clickTitleFallback(options: {
  page: Page;
  row: Locator;
  t247Id: string;
  titleHint: string | null;
  logger: ExpansionLog;
  context?: BrowserContext;
  pagesBefore?: number;
}): Promise<{ method: "TITLE"; titleText: string | null }> {
  const { page, row, t247Id, logger, titleHint } = options;
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

  await clickControl(found.locator);
  t247Log(logger, t247Id, "TITLE_CLICKED=true");

  if (await isReminderModalVisible(page)) {
    logger.warn("REMINDER_MODAL_OPENED_UNEXPECTEDLY");
    console.log("REMINDER_MODAL_OPENED_UNEXPECTEDLY");
    t247Log(logger, t247Id, "REMINDER_MODAL_OPENED_UNEXPECTEDLY");
    await dismissTender247ReminderModal(page, logger);
    t247Log(logger, t247Id, "TITLE_FALLBACK_RETRY=true");
    await clickControl(found.locator);
    t247Log(logger, t247Id, "TITLE_CLICKED=true");
  }

  const verified = await waitForExpansion(
    page,
    row,
    options.context,
    options.pagesBefore ?? 0,
  );
  t247Log(logger, t247Id, `EXPANSION_VERIFIED=${verified}`);
  t247Log(logger, t247Id, "EXPAND_METHOD=TITLE");
  return { method: "TITLE", titleText: found.text };
}

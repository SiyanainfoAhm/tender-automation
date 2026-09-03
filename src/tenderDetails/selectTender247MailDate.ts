/**
 * Shared Tender247 "Select Mail Date" helper.
 *
 * Human interaction only:
 *   Select Mail Date card → open calendar → navigate month → click day
 *
 * NEVER set the input via fill()/evaluate()/JS value assignment.
 * NEVER use the Today Tenders card.
 *
 * Authoritative verification:
 * 1. Select Mail Date input value (DD/MM/YYYY)
 * 2. Filtered list/tab label when Tender247 exposes it (DD-MM-YYYY (N))
 * 3. Caller-supplied requested ISO used as session mail_date
 */
import path from "node:path";
import type { Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import {
  formatIsoToDdMmYyyy,
  formatIsoToDdMmYyyySlash,
  getTodayIsoDate,
  parseIsoDateParts,
  parseMailDateDisplayToIso,
  type IsoDateParts,
} from "../dateUtils.js";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";

export type Tender247MailDateSelectionResult = {
  requestedIso: string;
  selectedMailDateIso: string;
  mailDateInputValue: string;
  filteredDateLabel: string | null;
  filteredTenderCount: number | null;
  listRefreshComplete: boolean;
};

export type MailDateScreenshotHook = (
  step:
    | "01-before-date-click"
    | "02-calendar-open"
    | "03-day-selected"
    | "04-before-xls",
) => Promise<void>;

const MONTH_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MAIL_DATE_CARD_ATTR = "data-agenttender-mail-date-card";

import {
  FRESH_TAB_BADGE_RE,
  hasVisibleTender247Cards,
  isFreshTabBadgeVisible,
  parseCompactListCount,
  parseCompactListCountDetails,
} from "./tender247ListUi.js";

/** Parse "11-08-2026 (159)" / "Fresh (1.00 K)" style tab text. */
export function parseFilteredDateTabText(
  text: string,
): { dateLabel: string | null; count: number; isFresh: boolean } | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const dated = normalized.match(
    /(\d{2}-\d{2}-\d{4})\s*\(\s*([^)]+)\s*\)/i,
  );
  if (dated && !/Today\s+Tenders/i.test(normalized)) {
    return {
      dateLabel: dated[1]!,
      count: parseCompactListCount(dated[2]!.trim()) ?? 0,
      isFresh: false,
    };
  }
  const fresh = normalized.match(/^Fresh\s*\(\s*([^)]+)\s*\)\s*$/i);
  if (fresh) {
    return {
      dateLabel: null,
      count: parseCompactListCount(fresh[1]!.trim()) ?? 0,
      isFresh: true,
    };
  }
  return null;
}

export function buildFilteredDateLabelRegex(dateIso: string): RegExp {
  const label = formatIsoToDdMmYyyy(dateIso).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${label}\\s*\\(\\s*([^)]+)\\s*\\)`, "i");
}

export function mailDateInputMatchesRequested(
  inputValue: string,
  requestedIso: string,
): boolean {
  const parsed = parseMailDateDisplayToIso(inputValue);
  return parsed === requestedIso;
}

/** Pure gate used by unit tests + pre-XLS assertion. */
export function evaluateMailDateExcelGate(options: {
  requestedIso: string;
  selectedMailDateIso: string | null;
  mailDateInputValue: string | null;
  todayTendersCardText?: string | null;
}): { ok: boolean; reason?: string } {
  const {
    requestedIso,
    selectedMailDateIso,
    mailDateInputValue,
  } = options;

  if (!selectedMailDateIso || selectedMailDateIso !== requestedIso) {
    return {
      ok: false,
      reason: `TENDER247_DATE_MISMATCH requested=${requestedIso} selected=${selectedMailDateIso || "null"}`,
    };
  }
  if (
    !mailDateInputValue ||
    !mailDateInputMatchesRequested(mailDateInputValue, requestedIso)
  ) {
    return {
      ok: false,
      reason: `TENDER247_DATE_MISMATCH requested=${requestedIso} input=${mailDateInputValue || "null"}`,
    };
  }
  // Today Tenders card may still show today's date — must not override.
  return { ok: true };
}

export function assertMailDateReadyForExcel(
  result: Tender247MailDateSelectionResult,
  requestedIso: string,
): void {
  const gate = evaluateMailDateExcelGate({
    requestedIso,
    selectedMailDateIso: result.selectedMailDateIso,
    mailDateInputValue: result.mailDateInputValue,
  });
  if (!gate.ok) {
    throw new AutomationError(
      "TENDER247_DATE_MISMATCH",
      `${gate.reason} TENDER247_DATE_FILTER_VERIFIED=false TENDER247_EXCEL_DOWNLOAD_BLOCKED=true`,
    );
  }
}

function logLine(logger: Logger, message: string): void {
  logger.info(message);
  console.log(message);
}

function logError(logger: Logger, message: string): void {
  logger.error(message);
  console.log(message);
}

async function maybeScreenshot(
  hook: MailDateScreenshotHook | undefined,
  step: Parameters<MailDateScreenshotHook>[0],
): Promise<void> {
  if (!hook) return;
  await hook(step).catch(() => undefined);
}

/**
 * Create a screenshot hook that writes fixed filenames into a directory.
 * Used by the select-date smoke test / debug runs only.
 */
export function createMailDateScreenshotHook(
  page: Page,
  dir: string,
): MailDateScreenshotHook {
  ensureDir(dir);
  return async (step) => {
    const filePath = path.join(dir, `${step}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    console.log(`TENDER247_MAIL_DATE_SCREENSHOT=${filePath}`);
  };
}

/**
 * Locate the dashboard card that contains exact "Select Mail Date" text.
 * Excludes Today Tenders.
 */
async function markSelectMailDateCard(page: Page): Promise<Locator> {
  await page
    .evaluate((attr) => {
      document
        .querySelectorAll(`[${attr}="true"]`)
        .forEach((el) => el.removeAttribute(attr));
    }, MAIL_DATE_CARD_ATTR)
    .catch(() => undefined);

  const marked = await page.evaluate((attr) => {
    const all = Array.from(document.querySelectorAll("body *")) as HTMLElement[];
    let best: HTMLElement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (!/Select\s+Mail\s+Date/i.test(text)) continue;
      if (/Today\s+Tenders/i.test(text)) continue;
      // Prefer compact cards that also show a date value
      const hasDate = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(text);
      const score = text.length + (hasDate ? 0 : 10_000);
      if (score < bestScore) {
        best = el;
        bestScore = score;
      }
    }
    if (!best) return false;
    best.setAttribute(attr, "true");
    return true;
  }, MAIL_DATE_CARD_ATTR);

  if (!marked) {
    throw new AutomationError(
      "TENDER247_MAIL_DATE_CONTROL_NOT_FOUND",
      'Could not find the "Select Mail Date" dashboard card (excluding Today Tenders)',
    );
  }

  return page.locator(`[${MAIL_DATE_CARD_ATTR}="true"]`).first();
}

async function readMailDateInputFromCard(card: Locator): Promise<string> {
  const inputs = card.locator("input");
  const inputCount = await inputs.count().catch(() => 0);
  for (let i = 0; i < inputCount; i += 1) {
    const input = inputs.nth(i);
    if (!(await input.isVisible().catch(() => false))) continue;
    // Real DOM value/property only — never invent from memory.
    const value =
      (await input.inputValue().catch(() => "")) ||
      (await input.getAttribute("value").catch(() => "")) ||
      "";
    if (parseMailDateDisplayToIso(value)) {
      return value.trim();
    }
  }

  // Some Tender247 builds render the date as plain text inside the card.
  const cardText = ((await card.innerText().catch(() => "")) || "").replace(
    /\s+/g,
    " ",
  );
  const match = cardText.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
  return match?.[1]?.trim() || "";
}

/** Public read of the Select Mail Date input (never Today Tenders). */
export async function readCurrentSelectMailDate(page: Page): Promise<{
  inputValue: string;
  iso: string | null;
}> {
  const card = await markSelectMailDateCard(page);
  const inputValue = await readMailDateInputFromCard(card);
  return {
    inputValue,
    iso: parseMailDateDisplayToIso(inputValue),
  };
}

async function findVisibleCalendar(page: Page): Promise<Locator | null> {
  const selectors = [
    ".rdp",
    ".rdp-month",
    '[class*="rdp" i]',
    ".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)",
    ".ant-picker-panel-container",
    ".react-datepicker-popper",
    ".react-datepicker",
    ".flatpickr-calendar.open",
    ".flatpickr-calendar.arrowTop",
    ".MuiPickersPopper-root",
    ".MuiDateCalendar-root",
    '[class*="react-datepicker" i]',
    '[class*="datepicker" i]',
    '[class*="date-picker" i]',
    '[class*="DatePicker" i]',
    '[class*="calendar-popup" i]',
    '[class*="CalendarPopup" i]',
    '[class*="p-datepicker" i]',
    '[class*="DayPicker" i]',
    '[class*="calendar" i]',
    '[role="dialog"]',
    '[role="grid"]',
    '[role="application"]',
  ];

  for (const selector of selectors) {
    const group = page.locator(selector);
    const count = await group.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const candidate = group.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const box = await candidate.boundingBox().catch(() => null);
      if (!box || box.width < 120 || box.height < 120) continue;
      const text = ((await candidate.innerText().catch(() => "")) || "").slice(
        0,
        800,
      );
      const hasMonth =
        /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(
          text,
        );
      const dayish = await candidate
        .locator(
          '.react-datepicker__day, .ant-picker-cell, .rdp-button, button.rdp-button, [role="gridcell"], td, button, .flatpickr-day',
        )
        .count()
        .catch(() => 0);
      if (hasMonth && dayish > 7) {
        return candidate;
      }
    }
  }
  return null;
}

/** Dismiss any already-open calendar so the next open click is deterministic. */
async function dismissOpenCalendar(page: Page): Promise<void> {
  const open = await findVisibleCalendar(page);
  if (!open) return;
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(200);
  if (await findVisibleCalendar(page)) {
    await page.mouse.click(8, 8).catch(() => undefined);
    await page.waitForTimeout(200);
  }
}

/**
 * Open the real Tender247 datepicker by clicking the Select Mail Date control.
 * Prefer the visible date input, then calendar icon — NEVER fill()/JS value.
 */
async function openMailDatePicker(
  page: Page,
  card: Locator,
): Promise<Locator> {
  await dismissOpenCalendar(page);

  // Build an ordered list of human-like click targets inside the card only.
  const targets: Locator[] = [];

  // 1) Visible input that already shows a DD/MM/YYYY value.
  const inputs = card.locator("input");
  const inputCount = await inputs.count().catch(() => 0);
  for (let i = 0; i < inputCount; i += 1) {
    const input = inputs.nth(i);
    if (!(await input.isVisible().catch(() => false))) continue;
    const value =
      (await input.inputValue().catch(() => "")) ||
      (await input.getAttribute("value").catch(() => "")) ||
      "";
    if (parseMailDateDisplayToIso(value)) {
      targets.push(input);
    }
  }

  // 2) Calendar / date icons next to the field.
  targets.push(
    card
      .locator(
        [
          '[aria-label*="calendar" i]',
          '[aria-label*="date" i]',
          '[title*="calendar" i]',
          '[title*="date" i]',
          '[class*="calendar" i]',
          '[class*="datepicker" i]',
          ".ant-picker-suffix",
          ".react-datepicker__calendar-icon",
          "svg",
          "img",
          "i.fa-calendar",
          "i.fa-calendar-alt",
          "button",
          '[role="button"]',
        ].join(", "),
      )
      .first(),
  );

  // 3) Any remaining visible input in the card.
  if (inputCount > 0) {
    targets.push(inputs.first());
  }

  // 4) The displayed date text itself.
  targets.push(
    card.getByText(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/).first(),
  );

  // 5) Last resort: the card surface (click center).
  targets.push(card);

  for (const candidate of targets) {
    if (!(await candidate.isVisible().catch(() => false))) continue;
    await candidate.click({ timeout: 10_000 }).catch(() => undefined);
    // Give the real Tender247 popup time to mount (portal/animation).
    for (let wait = 0; wait < 8; wait += 1) {
      await page.waitForTimeout(250);
      const calendar = await findVisibleCalendar(page);
      if (calendar) {
        return calendar;
      }
    }
    // Click did not open a calendar — dismiss any partial UI and try next target.
    await dismissOpenCalendar(page);
  }

  throw new AutomationError(
    "TENDER247_MAIL_DATE_PICKER_NOT_OPENED",
    "Clicked Select Mail Date control but calendar popup did not appear",
  );
}

function parseCalendarHeading(
  text: string,
): { month: number; year: number } | null {
  const normalized = text.replace(/\s+/g, " ");
  const full = normalized.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
  );
  if (full) {
    const month =
      MONTH_SHORT.findIndex((m) =>
        full[1]!.toLowerCase().startsWith(m.toLowerCase()),
      ) + 1;
    return month > 0 ? { month, year: Number(full[2]) } : null;
  }
  const short = normalized.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})\b/i,
  );
  if (short) {
    const month =
      MONTH_SHORT.findIndex(
        (m) => m.toLowerCase() === short[1]!.slice(0, 3).toLowerCase(),
      ) + 1;
    return month > 0 ? { month, year: Number(short[2]) } : null;
  }
  return null;
}

async function readCalendarHeading(
  calendar: Locator,
): Promise<{ month: number; year: number; text: string } | null> {
  const text = (await calendar.innerText().catch(() => "")) || "";
  const parsed = parseCalendarHeading(text);
  if (!parsed) return null;
  return {
    ...parsed,
    text: `${MONTH_FULL[parsed.month - 1]} ${parsed.year}`,
  };
}

async function stepCalendarMonth(
  _page: Page,
  calendar: Locator,
  forward: boolean,
): Promise<boolean> {
  const direction = forward ? /next/i : /prev|previous|back/i;
  const classHint = forward ? "next" : "prev";
  const candidates = [
    calendar.getByRole("button", { name: direction }),
    calendar.locator(`[aria-label*="${classHint}" i]`),
    calendar.locator(`[title*="${classHint}" i]`),
    calendar.locator(`[name="${forward ? "next" : "previous"}-month"]`),
    calendar.locator(`[class*="${classHint}" i]`),
    calendar.locator(
      forward
        ? ".react-datepicker__navigation--next, .ant-picker-header-next-btn, .flatpickr-next-month, button[name='next-month']"
        : ".react-datepicker__navigation--previous, .ant-picker-header-prev-btn, .flatpickr-prev-month, button[name='previous-month']",
    ),
  ];
  for (const group of candidates) {
    const count = await group.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const item = group.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      await item.click({ timeout: 8_000 });
      return true;
    }
  }
  return false;
}

export function monthStepsBetween(
  current: { month: number; year: number },
  target: { month: number; year: number },
): number {
  return (target.year - current.year) * 12 + (target.month - current.month);
}

async function navigateCalendarToMonth(options: {
  page: Page;
  calendar: Locator;
  target: IsoDateParts;
  logger: Logger;
}): Promise<string> {
  const { page, calendar, target, logger } = options;
  let headingText = "";
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const heading = await readCalendarHeading(calendar);
    if (!heading) {
      throw new AutomationError(
        "TENDER247_MAIL_DATE_CALENDAR_HEADING_NOT_FOUND",
        "Could not read the visible Select Mail Date calendar month heading",
      );
    }
    headingText = heading.text;
    logLine(
      logger,
      `TENDER247_CALENDAR_MONTH=${heading.text}`,
    );
    const delta = monthStepsBetween(heading, target);
    if (delta === 0) return headingText;
    const moved = await stepCalendarMonth(page, calendar, delta > 0);
    if (!moved) {
      throw new AutomationError(
        "TENDER247_MAIL_DATE_CALENDAR_NAV_UNAVAILABLE",
        `No month navigation control to reach ${target.monthName} ${target.year}`,
      );
    }
    await page.waitForTimeout(350);
  }
  throw new AutomationError(
    "TENDER247_MAIL_DATE_CALENDAR_MONTH_NOT_REACHED",
    `Calendar did not reach ${target.monthName} ${target.year}`,
  );
}

async function isUnselectableDay(candidate: Locator): Promise<boolean> {
  const disabled = await candidate.isDisabled().catch(() => false);
  if (disabled) return true;

  return candidate
    .evaluate((el) => {
      const node = el as HTMLElement;
      if (
        node.getAttribute("aria-disabled") === "true" ||
        node.hasAttribute("disabled")
      ) {
        return true;
      }
      // Token-based only — never substring-match Tailwind arbitrary variants
      // like [&:has([aria-selected].day-outside)] which appear on EVERY cell.
      const tokens = new Set(
        Array.from(node.classList).map((c) => c.toLowerCase()),
      );
      const blocked = [
        "old",
        "new",
        "disabled",
        "day-disabled",
        "day-outside",
        "rdp-day_outside",
        "rdp-day_disabled",
        "outside-month",
        "other-month",
        "day--outside-month",
        "react-datepicker__day--outside-month",
        "react-datepicker__day--disabled",
        "ant-picker-cell-disabled",
        "flatpickr-disabled",
        "prevmonthday",
        "nextmonthday",
      ];
      for (const token of blocked) {
        if (tokens.has(token)) return true;
      }
      // Outside-month cells often omit "day-outside" but include opacity helpers
      // while also lacking day-selected; prefer button name="previous/next" skip.
      if (
        node.getAttribute("name") === "previous-month" ||
        node.getAttribute("name") === "next-month"
      ) {
        return true;
      }
      return false;
    })
    .catch(() => false);
}

/** Debug dump when day click fails — helps map Tender247's real calendar DOM. */
async function dumpCalendarDayDiagnostics(
  calendar: Locator,
  target: IsoDateParts,
): Promise<string> {
  const lines: string[] = [
    `day_target=${target.day} ${target.monthName} ${target.year}`,
  ];
  const probeSelectors = [
    ".react-datepicker__day",
    ".ant-picker-cell",
    ".ant-picker-cell-inner",
    ".flatpickr-day",
    ".rdp-day",
    '[role="gridcell"]',
    "td",
    "button",
    "[aria-label]",
    "[title]",
    "[data-date]",
  ];
  for (const sel of probeSelectors) {
    const count = await calendar.locator(sel).count().catch(() => -1);
    lines.push(`selector ${sel} count=${count}`);
  }

  const samples = calendar.locator(
    '.react-datepicker__day, .ant-picker-cell, .ant-picker-cell-inner, .flatpickr-day, .rdp-day, [role="gridcell"], td, button, [aria-label], [title]',
  );
  const sampleCount = Math.min(await samples.count().catch(() => 0), 40);
  for (let i = 0; i < sampleCount; i += 1) {
    const el = samples.nth(i);
    const text = ((await el.innerText().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    const cls = ((await el.getAttribute("class").catch(() => "")) || "").slice(
      0,
      120,
    );
    const aria = (await el.getAttribute("aria-label").catch(() => "")) || "";
    const title = (await el.getAttribute("title").catch(() => "")) || "";
    const dataDate = (await el.getAttribute("data-date").catch(() => "")) || "";
    lines.push(
      `sample[${i}] text="${text}" class="${cls}" aria="${aria}" title="${title}" data-date="${dataDate}"`,
    );
  }

  const html = ((await calendar.evaluate((node) => node.outerHTML).catch(() => "")) || "")
    .replace(/\s+/g, " ")
    .slice(0, 2500);
  lines.push(`calendar_html_slice=${html}`);
  return lines.join("\n");
}

/**
 * Click the exact day cell inside the open calendar only.
 * Prefer fully-qualified aria-label/title/date matches over bare day numbers.
 */
async function clickCalendarDay(
  calendar: Locator,
  target: IsoDateParts,
): Promise<void> {
  const { day, monthName, year, month, iso } = target;
  const paddedDay = String(day).padStart(2, "0");
  const shortMonth = monthName.slice(0, 3);
  const dayExact = new RegExp(`^0?${day}$`);

  // Tender247 uses shadcn + react-day-picker: day cells are buttons.rdp-button
  // inside [role=gridcell]. Prefer those before generic text matching.
  const rdpButtons = calendar.locator(
    'button.rdp-button, button[class*="rdp-button"]',
  );
  const rdpCount = await rdpButtons.count().catch(() => 0);
  for (let i = 0; i < rdpCount; i += 1) {
    const candidate = rdpButtons.nth(i);
    const text = ((await candidate.innerText().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!dayExact.test(text)) continue;
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (await isUnselectableDay(candidate)) continue;
    // Skip outside-month days: parent gridcell often has .day-outside token.
    const outside = await candidate
      .evaluate((el) => {
        const cell = el.closest('[role="gridcell"], td, .rdp-day');
        if (!cell) return false;
        return Array.from(cell.classList).some((c) =>
          /^(day-outside|rdp-day_outside|day-disabled|rdp-day_disabled)$/i.test(
            c,
          ),
        );
      })
      .catch(() => false);
    if (outside) continue;
    await candidate.click({ timeout: 10_000 });
    return;
  }

  // Exact visible day text inside the open calendar (human click).
  const exactDay = calendar.getByText(dayExact);
  const exactCount = await exactDay.count().catch(() => 0);
  for (let i = 0; i < exactCount; i += 1) {
    const candidate = exactDay.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    if (await isUnselectableDay(candidate)) continue;
    const outside = await candidate
      .evaluate((el) => {
        const cell = el.closest('[role="gridcell"], td, button, .rdp-day') || el;
        return Array.from(cell.classList).some((c) =>
          /^(day-outside|rdp-day_outside|day-disabled|rdp-day_disabled)$/i.test(
            c,
          ),
        );
      })
      .catch(() => false);
    if (outside) continue;
    await candidate.click({ timeout: 10_000 });
    return;
  }

  // Fully-qualified aria-label / title / data-date matches.
  const fullDatePatterns = [
    new RegExp(`\\b0?${day}\\s+${monthName}\\s+${year}\\b`, "i"),
    new RegExp(`\\b${monthName}\\s+0?${day},?\\s+${year}\\b`, "i"),
    new RegExp(`\\b${paddedDay}\\s+${shortMonth}\\w*\\.?\\s+${year}\\b`, "i"),
    new RegExp(`\\b0?${day}[-/]0?${month}[-/]${year}\\b`, "i"),
    new RegExp(`\\b${iso}\\b`, "i"),
    new RegExp(`\\b${monthName}\\s+0?${day}(st|nd|rd|th)?,?\\s+${year}\\b`, "i"),
  ];

  const labelled = calendar.locator(
    [
      "button.rdp-button",
      ".react-datepicker__day",
      ".ant-picker-cell",
      ".ant-picker-cell-inner",
      ".flatpickr-day",
      ".rdp-day",
      '[role="gridcell"]',
      "td",
      "button",
      "a",
      "[aria-label]",
      "[title]",
      "[data-date]",
      "[data-value]",
    ].join(", "),
  );
  const labelledCount = await labelled.count().catch(() => 0);
  for (const pattern of fullDatePatterns) {
    for (let i = 0; i < labelledCount; i += 1) {
      const candidate = labelled.nth(i);
      const parts = [
        await candidate.getAttribute("aria-label").catch(() => null),
        await candidate.getAttribute("title").catch(() => null),
        await candidate.getAttribute("data-date").catch(() => null),
        await candidate.getAttribute("data-value").catch(() => null),
        await candidate.textContent().catch(() => null),
      ].filter((value): value is string => Boolean(value));
      if (!pattern.test(parts.join(" "))) continue;
      if (!(await candidate.isVisible().catch(() => false))) continue;
      if (await isUnselectableDay(candidate)) continue;
      await candidate.click({ timeout: 10_000 });
      return;
    }
  }

  // Role-based gridcell / button by accessible name.
  for (const role of ["gridcell", "button", "link"] as const) {
    const byRole = calendar.getByRole(role, { name: dayExact });
    const roleCount = await byRole.count().catch(() => 0);
    for (let i = 0; i < roleCount; i += 1) {
      const candidate = byRole.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      if (await isUnselectableDay(candidate)) continue;
      await candidate.click({ timeout: 10_000 });
      return;
    }
  }

  const diagnostics = await dumpCalendarDayDiagnostics(calendar, target);
  throw new AutomationError(
    "TENDER247_MAIL_DATE_DAY_NOT_FOUND",
    `Could not click calendar day ${day} ${monthName} ${year} inside open datepicker\n${diagnostics}`,
  );
}

/**
 * Read filtered date tab if Tender247 exposes one. Ignores Today Tenders card.
 */
export async function readFilteredMailDateTab(
  page: Page,
  dateIso: string,
): Promise<{
  filteredDateLabel: string;
  filteredTenderCount: number;
  countDetails: ReturnType<typeof parseCompactListCountDetails>;
} | null> {
  const expectedLabel = formatIsoToDdMmYyyy(dateIso);
  const labelRe = buildFilteredDateLabelRegex(dateIso);
  const datedTabs = page.getByText(labelRe);
  const datedCount = await datedTabs.count().catch(() => 0);

  for (let i = 0; i < datedCount; i += 1) {
    const tab = datedTabs.nth(i);
    if (!(await tab.isVisible().catch(() => false))) continue;
    const raw = ((await tab.innerText().catch(() => "")) || "").replace(
      /\s+/g,
      " ",
    );
    if (/Today\s+Tenders/i.test(raw)) continue;
    const ancestorText = await tab
      .locator(
        "xpath=ancestor::*[self::div or self::section or self::article][1]",
      )
      .innerText()
      .catch(() => "");
    if (/Today\s+Tenders/i.test(ancestorText) && !labelRe.test(raw.trim())) {
      continue;
    }
    const m = raw.match(labelRe);
    if (m) {
      const countDetails = parseCompactListCountDetails(m[1]!.trim());
      return {
        filteredDateLabel: expectedLabel,
        filteredTenderCount: countDetails?.value ?? 0,
        countDetails,
      };
    }
  }
  return null;
}

async function waitForMailDateInput(
  card: Locator,
  requestedIso: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await readMailDateInputFromCard(card);
    if (mailDateInputMatchesRequested(last, requestedIso)) {
      return last;
    }
    await card.page().waitForTimeout(400);
  }
  throw new AutomationError(
    "TENDER247_DATE_FILTER_MISMATCH",
    `Select Mail Date input did not become ${formatIsoToDdMmYyyySlash(requestedIso)} (last=${last || "empty"})`,
  );
}

/**
 * Select/verify Tender247 Select Mail Date for the requested CLI date via
 * real calendar clicks (icon → month → day). Must run after auth and BEFORE
 * Excel / scanning / downloads.
 */
export async function selectAndVerifyTender247MailDate(options: {
  page: Page;
  dateIso: string;
  logger: Logger;
  pageTimeoutMs?: number;
  screenshotHook?: MailDateScreenshotHook;
  /** When true (default for mismatches), always open calendar and click the day. */
  forceCalendarClick?: boolean;
}): Promise<Tender247MailDateSelectionResult> {
  const { page, logger } = options;
  const parts = parseIsoDateParts(options.dateIso);
  const timeoutMs = options.pageTimeoutMs ?? 45_000;
  const expectedInput = formatIsoToDdMmYyyySlash(parts.iso);
  const expectedLabel = formatIsoToDdMmYyyy(parts.iso);

  logLine(logger, `TENDER247_REQUESTED_DATE=${parts.iso}`);

  const card = await markSelectMailDateCard(page);
  const beforeValue = await readMailDateInputFromCard(card);
  const beforeIso = parseMailDateDisplayToIso(beforeValue);
  logLine(
    logger,
    `TENDER247_CURRENT_MAIL_DATE_BEFORE_SELECTION=${beforeIso || beforeValue || "unknown"}`,
  );

  await maybeScreenshot(options.screenshotHook, "01-before-date-click");

  const alreadyMatches = mailDateInputMatchesRequested(beforeValue, parts.iso);
  // Always open the real calendar when the visible input differs, or when the
  // caller forces a click (smoke / debug). Never invent success from memory.
  const forceClick = options.forceCalendarClick === true || !alreadyMatches;

  if (forceClick) {
    // Human path: open calendar UI and click the day — never fill()/JS value.
    let calendar: Locator;
    try {
      calendar = await openMailDatePicker(page, card);
    } catch (error) {
      await maybeScreenshot(options.screenshotHook, "02-calendar-open");
      throw error;
    }
    logLine(logger, "TENDER247_MAIL_DATE_PICKER_OPENED=true");
    await maybeScreenshot(options.screenshotHook, "02-calendar-open");

    const monthHeading = await navigateCalendarToMonth({
      page,
      calendar,
      target: parts,
      logger,
    });
    logLine(logger, `TENDER247_CALENDAR_MONTH=${monthHeading}`);

    await clickCalendarDay(calendar, parts);
    logLine(logger, `TENDER247_CALENDAR_DAY_CLICKED=${parts.day}`);
    logLine(logger, `TENDER247_MAIL_DATE_CLICKED=${parts.iso}`);

    await page
      .waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 20_000) })
      .catch(() => undefined);
    await page.waitForTimeout(800);
    await maybeScreenshot(options.screenshotHook, "03-day-selected");
  } else {
    logLine(logger, "TENDER247_MAIL_DATE_ALREADY_SELECTED=true");
  }

  let mailDateInputValue: string;
  try {
    // Re-mark card in case React re-rendered after selection.
    const freshCard = await markSelectMailDateCard(page);
    mailDateInputValue = await waitForMailDateInput(
      freshCard,
      parts.iso,
      timeoutMs,
    );
  } catch (error) {
    logError(logger, "TENDER247_DATE_FILTER_VERIFIED=false");
    logError(logger, "TENDER247_EXCEL_DOWNLOAD_BLOCKED=true");
    throw error instanceof AutomationError
      ? error
      : new AutomationError(
          "TENDER247_DATE_FILTER_MISMATCH",
          String(error),
        );
  }

  logLine(logger, `TENDER247_MAIL_DATE_INPUT_VALUE=${mailDateInputValue}`);
  logLine(logger, `TENDER247_SELECTED_MAIL_DATE=${parts.iso}`);

  // Wait for list refresh. Historical dates should expose DD-MM-YYYY (N).
  // Today may keep Fresh (N); input match remains the hard gate.
  const deadline = Date.now() + timeoutMs;
  let filtered: {
    filteredDateLabel: string;
    filteredTenderCount: number;
  } | null = null;
  let listReady = false;
  while (Date.now() < deadline) {
    // Re-verify input never reset during refresh.
    const still = await readCurrentSelectMailDate(page);
    if (still.iso !== parts.iso) {
      logError(logger, "TENDER247_DATE_FILTER_VERIFIED=false");
      throw new AutomationError(
        "TENDER247_DATE_RESET_DETECTED",
        `Select Mail Date reset during list refresh requested=${parts.iso} visible=${still.iso || still.inputValue || "null"}`,
      );
    }

    filtered = await readFilteredMailDateTab(page, parts.iso);
    const freshVisible =
      (await isFreshTabBadgeVisible(page)) ||
      (parts.iso === getTodayIsoDate() &&
        (await page
          .getByText(FRESH_TAB_BADGE_RE)
          .first()
          .isVisible()
          .catch(() => false)));
    const hasTender = await hasVisibleTender247Cards(page);

    if (
      filtered ||
      (freshVisible && hasTender) ||
      (filtered === null && hasTender && parts.iso === getTodayIsoDate())
    ) {
      listReady = hasTender || (filtered?.filteredTenderCount ?? 0) >= 0;
      if (filtered || freshVisible) break;
    }
    if (filtered && hasTender) break;
    await page.waitForTimeout(400);
  }

  if (!mailDateInputMatchesRequested(mailDateInputValue, parts.iso)) {
    logError(logger, "TENDER247_DATE_FILTER_VERIFIED=false");
    logError(logger, "TENDER247_EXCEL_DOWNLOAD_BLOCKED=true");
    throw new AutomationError(
      "TENDER247_DATE_MISMATCH",
      `TENDER247_DATE_MISMATCH requested=${parts.iso} selected=${parseMailDateDisplayToIso(mailDateInputValue) || mailDateInputValue}`,
    );
  }

  // Historical dates: dated tab is expected when Tender247 exposes it.
  if (parts.iso !== getTodayIsoDate() && !filtered) {
    const hasTender = await hasVisibleTender247Cards(page);
    if (!hasTender) {
      logError(logger, "TENDER247_DATE_FILTER_VERIFIED=false");
      logError(logger, "TENDER247_EXCEL_DOWNLOAD_BLOCKED=true");
      throw new AutomationError(
        "TENDER247_DATE_FILTER_MISMATCH",
        `Historical date ${parts.iso} selected in mail-date input but tender list did not refresh (expected tab ${expectedLabel})`,
      );
    }
  }

  logLine(
    logger,
    `TENDER247_LIST_REFRESH_COMPLETE=${listReady || Boolean(filtered)}`,
  );
  if (filtered) {
    logLine(logger, `TENDER247_FILTERED_DATE_LABEL=${filtered.filteredDateLabel}`);
    logLine(
      logger,
      `TENDER247_FILTERED_TENDER_COUNT=${filtered.filteredTenderCount}`,
    );
  } else {
    logLine(logger, `TENDER247_FILTERED_DATE_LABEL=${expectedLabel}`);
  }
  logLine(logger, "TENDER247_DATE_FILTER_VERIFIED=true");

  const result: Tender247MailDateSelectionResult = {
    requestedIso: parts.iso,
    selectedMailDateIso: parts.iso,
    mailDateInputValue: mailDateInputValue || expectedInput,
    filteredDateLabel: filtered?.filteredDateLabel ?? expectedLabel,
    filteredTenderCount: filtered?.filteredTenderCount ?? null,
    listRefreshComplete: true,
  };

  assertMailDateReadyForExcel(result, parts.iso);
  return result;
}

/** Alias matching the requested helper name. */
export async function selectTender247MailDate(
  page: Page,
  requestedDate: string,
  logger: Logger,
  pageTimeoutMs?: number,
): Promise<Tender247MailDateSelectionResult> {
  return selectAndVerifyTender247MailDate({
    page,
    dateIso: requestedDate,
    logger,
    pageTimeoutMs,
  });
}

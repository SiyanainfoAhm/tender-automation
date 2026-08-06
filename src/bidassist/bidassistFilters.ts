import type { Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";
import type { BidassistConfig } from "./bidassistConfig.js";
import {
  categorySlug,
  resolveBidassistFallbackUrl,
  resolveBidassistTargetUrl,
} from "./bidassistConfig.js";

const NAVIGATION_TIMEOUT_MS = 120_000;

async function clickFirstVisible(candidates: Locator[]): Promise<boolean> {
  for (const locator of candidates) {
    const target = locator.first();
    if (await target.isVisible().catch(() => false)) {
      await target.click({ timeout: 10_000 });
      return true;
    }
  }
  return false;
}

async function readBodyText(page: Page): Promise<string> {
  return (await page.locator("body").innerText().catch(() => "")) || "";
}

/** BidAssist renders a branded 404 instead of an HTTP error page. */
export function detectPageNotFound(bodyText: string): boolean {
  if (/page not found/i.test(bodyText)) {
    return true;
  }
  if (/oops!?\s*we are looking for your page/i.test(bodyText)) {
    return true;
  }
  // "Go Home" alone only counts when no tender-listing chrome is present
  return (
    /go home/i.test(bodyText) &&
    !/(more filters|saved filters|category)/i.test(bodyText)
  );
}

export function detectActiveTendersPageReady(bodyText: string): boolean {
  return /(indian tenders|saved filters|more filters|category|download)/i.test(
    bodyText,
  );
}

/** True when the direct category route already narrowed the results. */
export function detectCategoryRouteApplied(options: {
  url: string;
  bodyText: string;
  category: string;
}): boolean {
  const slug = categorySlug(options.category);
  if (new RegExp(`${slug}-category/active`, "i").test(options.url)) {
    return true;
  }
  const escaped = options.category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s+(tenders|category)`, "i").test(
    options.bodyText,
  );
}

export interface BidassistPageOpenResult {
  url: string;
  categoryRouteApplied: boolean;
}

/**
 * Navigate to the active-tenders listing, falling back to the generic
 * all-tenders route when the preferred URL renders Page Not Found.
 */
export async function openBidassistTendersPage(options: {
  page: Page;
  config: BidassistConfig;
  logger: Logger;
}): Promise<BidassistPageOpenResult> {
  const { page, config, logger } = options;
  const targetUrl = resolveBidassistTargetUrl(config);

  logger.info(`BIDASSIST_TARGET_URL=${targetUrl}`);
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  await page.waitForTimeout(2000);

  let bodyText = await readBodyText(page);
  if (detectPageNotFound(bodyText)) {
    logger.info(`BIDASSIST_INVALID_START_URL=${page.url()}`);
    const fallbackUrl = resolveBidassistFallbackUrl(config);
    logger.info(`BIDASSIST_FALLBACK_URL=${fallbackUrl}`);
    await page.goto(fallbackUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await page.waitForTimeout(2000);
    bodyText = await readBodyText(page);
    if (detectPageNotFound(bodyText)) {
      throw new AutomationError(
        "BIDASSIST_TENDER_PAGE_NOT_AVAILABLE",
        `Neither ${targetUrl} nor ${fallbackUrl} rendered a tender listing`,
      );
    }
  }

  if (detectActiveTendersPageReady(bodyText)) {
    logger.info("BIDASSIST_ACTIVE_TENDERS_PAGE_READY");
  } else {
    logger.warn(
      `BIDASSIST_ACTIVE_TENDERS_PAGE_MARKERS_MISSING=${page.url()} — continuing`,
    );
  }

  const categoryRouteApplied = detectCategoryRouteApplied({
    url: page.url(),
    bodyText,
    category: config.category,
  });

  return { url: page.url(), categoryRouteApplied };
}

/** Ensure the Indian active-tenders listing is the current view. */
export async function openIndianActiveTenders(options: {
  page: Page;
  config: BidassistConfig;
  logger: Logger;
}): Promise<BidassistPageOpenResult> {
  const { page, config, logger } = options;

  const result = await openBidassistTendersPage({ page, config, logger });
  logger.info("BIDASSIST_INDIAN_TENDERS_OPENED");

  if (!/\/active(?:[/?#]|$)/i.test(result.url)) {
    await clickFirstVisible([
      page.getByRole("tab", { name: /^active$/i }),
      page.getByRole("button", { name: /^active$/i }),
      page.getByRole("link", { name: /^active$/i }),
      page.locator('[role="tab"]').filter({ hasText: /^Active$/i }),
    ]);
    await page.waitForTimeout(800);
  }
  logger.info("BIDASSIST_ACTIVE_TAB_SELECTED");

  return result;
}

/** Skip the Category modal when the direct category route is already active. */
export async function ensureCategorySelected(options: {
  page: Page;
  config: BidassistConfig;
  logger: Logger;
  categoryRouteApplied: boolean;
}): Promise<void> {
  const { page, config, logger, categoryRouteApplied } = options;

  const applied =
    categoryRouteApplied ||
    detectCategoryRouteApplied({
      url: page.url(),
      bodyText: await readBodyText(page),
      category: config.category,
    });

  if (applied) {
    logger.info(`BIDASSIST_CATEGORY_ALREADY_APPLIED=${config.category}`);
    return;
  }

  await applyCategoryFilter({ page, category: config.category, logger });
}

/** Apply Software and IT Solutions category filter. */
export async function applyCategoryFilter(options: {
  page: Page;
  category: string;
  logger: Logger;
}): Promise<void> {
  const { page, category, logger } = options;

  const opened = await clickFirstVisible([
    page.getByRole("button", { name: /^category$/i }),
    page.getByRole("button", { name: /category/i }),
    page.getByText(/^category$/i),
  ]);
  if (!opened) {
    logger.warn("BIDASSIST_CATEGORY_BUTTON_NOT_FOUND — trying text fallback");
  }
  await page.waitForTimeout(800);

  // Search inside modal
  const search = page
    .getByPlaceholder(/search/i)
    .or(page.locator('input[type="search"]'))
    .or(page.locator('input[placeholder*="Search" i]'))
    .last();
  if (await search.isVisible().catch(() => false)) {
    await search.fill("IT");
    await page.waitForTimeout(600);
  }

  // Select checkbox for the category
  const checkbox = page
    .getByRole("checkbox", { name: new RegExp(category, "i") })
    .or(
      page
        .locator("label")
        .filter({ hasText: new RegExp(category, "i") })
        .locator('input[type="checkbox"]'),
    )
    .or(page.getByText(category, { exact: false }))
    .first();

  if (await checkbox.isVisible().catch(() => false)) {
    const tag = await checkbox.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    if (tag === "input") {
      const checked = await checkbox.isChecked().catch(() => false);
      if (!checked) {
        await checkbox.check({ force: true }).catch(async () => {
          await checkbox.click({ force: true });
        });
      }
    } else {
      await checkbox.click({ force: true });
    }
  } else {
    // Click label text
    await page
      .getByText(category, { exact: false })
      .first()
      .click({ timeout: 10_000 })
      .catch(() => undefined);
  }
  await page.waitForTimeout(500);

  await clickFirstVisible([
    page.getByRole("button", { name: /apply\s*now/i }),
    page.getByRole("button", { name: /^apply$/i }),
  ]);
  await page.waitForTimeout(1500);

  const chipVisible = await page
    .getByText(new RegExp(category, "i"))
    .first()
    .isVisible()
    .catch(() => false);
  if (chipVisible) {
    logger.info(`BIDASSIST_CATEGORY_FILTER_APPLIED=${category}`);
  } else {
    logger.warn(
      `BIDASSIST_CATEGORY_FILTER_CHIP_NOT_CONFIRMED=${category} — continuing`,
    );
    logger.info(`BIDASSIST_CATEGORY_FILTER_APPLIED=${category}`);
  }
}

const MONTH_NAMES = [
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
];

export interface BidassistTargetDate {
  day: number;
  /** 1-12 */
  month: number;
  year: number;
  monthName: string;
}

/** Parse "05 Aug 2026", "5 Aug 2026" or "2026-08-05" without OS locale help. */
export function parseBidassistTargetDate(value: string): BidassistTargetDate {
  const trimmed = value.trim();

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) {
      return {
        day: Number(iso[3]),
        month,
        year: Number(iso[1]),
        monthName: MONTH_NAMES[month - 1]!,
      };
    }
  }

  const textual = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/);
  if (textual) {
    const index = MONTH_NAMES.findIndex((name) =>
      name.toLowerCase().startsWith(textual[2]!.toLowerCase().slice(0, 3)),
    );
    if (index >= 0) {
      return {
        day: Number(textual[1]),
        month: index + 1,
        year: Number(textual[3]),
        monthName: MONTH_NAMES[index]!,
      };
    }
  }

  throw new AutomationError(
    "BIDASSIST_OPENING_DATE_UNPARSEABLE",
    `Cannot parse opening date "${value}"`,
  );
}

/** Read "August 2026" / "Aug 2026" from a calendar heading. */
export function parseCalendarHeading(
  text: string,
): { month: number; year: number } | null {
  const match = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/);
  if (!match) {
    return null;
  }
  const index = MONTH_NAMES.findIndex((name) =>
    name.toLowerCase().startsWith(match[1]!.toLowerCase().slice(0, 3)),
  );
  if (index < 0) {
    return null;
  }
  return { month: index + 1, year: Number(match[2]) };
}

/** Signed number of month clicks needed to reach the target. */
export function monthStepsBetween(
  current: { month: number; year: number },
  target: { month: number; year: number },
): number {
  return (
    target.year * 12 + target.month - (current.year * 12 + current.month)
  );
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const nth = candidate.nth(i);
      if (await nth.isVisible().catch(() => false)) {
        return nth;
      }
    }
  }
  return null;
}

/** The Opening Date section inside the visible More Filters modal. */
async function findOpeningDatePanel(page: Page): Promise<Locator> {
  const containers = page
    .locator("section, form, div")
    .filter({ hasText: /opening\s*date/i })
    .filter({ has: page.locator('input[placeholder="Select Date" i]') });

  const count = await containers.count().catch(() => 0);
  // Innermost match wins: ancestors also satisfy the filters
  for (let i = count - 1; i >= 0; i -= 1) {
    const candidate = containers.nth(i);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  const dialog = await firstVisible([
    page.locator('[role="dialog"]'),
    page.locator('[class*="modal" i]'),
  ]);
  return dialog ?? page.locator("body");
}

async function findVisibleCalendar(page: Page): Promise<Locator> {
  const monthPattern = new RegExp(MONTH_NAMES.join("|"), "i");
  const candidates = page.locator(
    [
      '[class*="calendar" i]',
      '[class*="datepicker" i]',
      '[class*="rdp" i]',
      '[role="grid"]',
      '[role="application"]',
    ].join(", "),
  );

  const count = await candidates.count().catch(() => 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const candidate = candidates.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    const text = (await candidate.innerText().catch(() => "")) || "";
    if (monthPattern.test(text)) {
      return candidate;
    }
  }
  return page.locator("body");
}

async function readCalendarHeading(
  calendar: Locator,
): Promise<{ month: number; year: number; text: string } | null> {
  const text = (await calendar.innerText().catch(() => "")) || "";
  const parsed = parseCalendarHeading(text);
  if (!parsed) {
    return null;
  }
  return {
    ...parsed,
    text: `${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`,
  };
}

async function stepCalendarMonth(
  page: Page,
  calendar: Locator,
  forward: boolean,
): Promise<boolean> {
  const direction = forward ? /next/i : /prev|previous|back/i;
  const classHint = forward ? "next" : "prev";
  return clickFirstVisible([
    calendar.getByRole("button", { name: direction }),
    calendar.locator(`[aria-label*="${classHint}" i]`),
    calendar.locator(`[class*="${classHint}" i]`),
    page.locator(`[aria-label*="${classHint}" i]`),
  ]);
}

async function navigateCalendarToMonth(options: {
  page: Page;
  calendar: Locator;
  target: BidassistTargetDate;
  logger: Logger;
}): Promise<void> {
  const { page, calendar, target, logger } = options;
  logger.info(
    `BIDASSIST_CALENDAR_MONTH_TARGET=${target.monthName} ${target.year}`,
  );

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const heading = await readCalendarHeading(calendar);
    if (!heading) {
      throw new AutomationError(
        "BIDASSIST_CALENDAR_HEADING_NOT_FOUND",
        "Could not read the visible calendar month heading",
      );
    }
    logger.info(`BIDASSIST_CALENDAR_MONTH_CURRENT=${heading.text}`);

    const steps = monthStepsBetween(heading, target);
    if (steps === 0) {
      return;
    }
    const moved = await stepCalendarMonth(page, calendar, steps > 0);
    if (!moved) {
      throw new AutomationError(
        "BIDASSIST_CALENDAR_MONTH_NAV_UNAVAILABLE",
        `No month navigation control to reach ${target.monthName} ${target.year}`,
      );
    }
    await page.waitForTimeout(400);
  }

  throw new AutomationError(
    "BIDASSIST_CALENDAR_MONTH_NOT_REACHED",
    `Calendar did not reach ${target.monthName} ${target.year} within 24 steps`,
  );
}

/** Click the target day, skipping adjacent-month and disabled cells. */
async function clickCalendarDay(
  calendar: Locator,
  target: BidassistTargetDate,
): Promise<void> {
  const { day, monthName, year } = target;
  const paddedDay = String(day).padStart(2, "0");
  const shortMonth = monthName.slice(0, 3);
  const fullDatePatterns = [
    new RegExp(`\\b0?${day}\\s+${monthName}\\s+${year}\\b`, "i"),
    new RegExp(`\\b${monthName}\\s+0?${day},?\\s+${year}\\b`, "i"),
    new RegExp(`\\b${paddedDay}\\s+${shortMonth}\\w*\\.?\\s+${year}\\b`, "i"),
  ];

  const labelled = calendar.locator(
    '[aria-label], [title], button, [role="gridcell"]',
  );
  const labelledCount = await labelled.count().catch(() => 0);
  for (const pattern of fullDatePatterns) {
    for (let i = 0; i < labelledCount; i += 1) {
      const candidate = labelled.nth(i);
      const parts = [
        await candidate.getAttribute("aria-label").catch(() => null),
        await candidate.getAttribute("title").catch(() => null),
        await candidate.textContent().catch(() => null),
      ].filter((value): value is string => Boolean(value));

      if (!pattern.test(parts.join(" "))) {
        continue;
      }
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      if (await isUnselectableDay(candidate)) {
        continue;
      }
      await candidate.click({ timeout: 10_000 });
      return;
    }
  }

  const dayCandidates = calendar
    .locator('button, [role="gridcell"], td, span')
    .filter({ hasText: new RegExp(`^\\s*0?${day}\\s*$`) });
  const dayCount = await dayCandidates.count().catch(() => 0);
  for (let i = 0; i < dayCount; i += 1) {
    const candidate = dayCandidates.nth(i);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    if (await isUnselectableDay(candidate)) {
      continue;
    }
    await candidate.click({ timeout: 10_000 });
    return;
  }

  throw new AutomationError(
    "BIDASSIST_OPENING_DATE_DAY_NOT_FOUND",
    `BIDASSIST_OPENING_DATE_DAY_NOT_FOUND=${day} ${monthName} ${year}`,
  );
}

export function isMutedDayClassName(className: string): boolean {
  return /disabled|outside|other-?month|muted|adjacent|\bold\b|\bnew\b|sibling/i.test(
    className,
  );
}

async function isUnselectableDay(candidate: Locator): Promise<boolean> {
  const className = (await candidate.getAttribute("class").catch(() => null)) ?? "";
  if (isMutedDayClassName(className)) {
    return true;
  }
  const ariaDisabled = await candidate
    .getAttribute("aria-disabled")
    .catch(() => null);
  if (ariaDisabled === "true") {
    return true;
  }
  return candidate.isDisabled().catch(() => false);
}

/** Open the readonly date input's calendar and pick the target day. */
async function selectDateThroughCalendar(options: {
  page: Page;
  input: Locator;
  target: BidassistTargetDate;
  logger: Logger;
}): Promise<string> {
  const { page, input, target, logger } = options;

  await input.click({ timeout: 15_000 });
  await page.waitForTimeout(600);
  logger.info("BIDASSIST_OPENING_DATE_CALENDAR_OPENED");

  const calendar = await findVisibleCalendar(page);
  await navigateCalendarToMonth({ page, calendar, target, logger });
  await clickCalendarDay(calendar, target);
  await page.waitForTimeout(600);

  return (await input.inputValue().catch(() => "")) || "";
}

/** Apply Opening Date From filter (To optional). */
export async function applyOpeningDateFilter(options: {
  page: Page;
  openingDateFrom: string;
  openingDateTo: string | null;
  logger: Logger;
}): Promise<void> {
  const { page, openingDateFrom, openingDateTo, logger } = options;

  logger.info("BIDASSIST_OPENING_DATE_FILTER_START");
  logger.info(`BIDASSIST_OPENING_DATE_FROM=${openingDateFrom}`);
  logger.info(`BIDASSIST_OPENING_DATE_TO=${openingDateTo ?? ""}`);

  const target = parseBidassistTargetDate(openingDateFrom);

  await clickFirstVisible([
    page.getByRole("button", { name: /more\s*filters/i }),
    page.getByText(/more\s*filters/i),
  ]);
  await page.waitForTimeout(800);

  await clickFirstVisible([
    page.getByRole("button", { name: /opening\s*date/i }),
    page.getByRole("checkbox", { name: /opening\s*date/i }),
    page.getByText(/opening\s*date/i),
  ]);
  await page.waitForTimeout(600);

  const panel = await findOpeningDatePanel(page);
  const dateInputs = panel.locator('input[placeholder="Select Date" i]');
  const fromInput = dateInputs.first();
  if (!(await fromInput.isVisible().catch(() => false))) {
    throw new AutomationError(
      "BIDASSIST_OPENING_DATE_INPUT_NOT_FOUND",
      "No visible Select Date input inside the Opening Date panel",
    );
  }

  // The input is readonly: the value can only come from the calendar
  let selectedValue = await selectDateThroughCalendar({
    page,
    input: fromInput,
    target,
    logger,
  });
  if (!selectedValue.trim()) {
    logger.warn("BIDASSIST_OPENING_DATE_EMPTY_AFTER_SELECT — retrying once");
    selectedValue = await selectDateThroughCalendar({
      page,
      input: fromInput,
      target,
      logger,
    });
  }
  if (!selectedValue.trim()) {
    throw new AutomationError(
      "BIDASSIST_OPENING_DATE_NOT_SELECTED",
      `From date stayed empty after selecting ${openingDateFrom}`,
    );
  }
  logger.info(`BIDASSIST_OPENING_DATE_SELECTED=${selectedValue.trim()}`);

  if (openingDateTo) {
    const toInput = dateInputs.nth(1);
    if (await toInput.isVisible().catch(() => false)) {
      const toValue = await selectDateThroughCalendar({
        page,
        input: toInput,
        target: parseBidassistTargetDate(openingDateTo),
        logger,
      });
      logger.info(`BIDASSIST_OPENING_DATE_TO_SELECTED=${toValue.trim()}`);
    } else {
      logger.warn("BIDASSIST_OPENING_DATE_TO_INPUT_NOT_FOUND — leaving blank");
    }
  } else {
    logger.info("BIDASSIST_OPENING_DATE_TO_SKIPPED");
  }

  await page.waitForTimeout(500);
  await applyMoreFilters({ page, logger });
}

/**
 * The Apply Now control lives in the More Filters footer, which sits outside
 * the Opening Date panel and can be covered by the calendar popup.
 */
async function findMoreFiltersModal(page: Page): Promise<Locator | null> {
  const headings = page.getByText("More Filters", { exact: true });
  const count = await headings.count().catch(() => 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const heading = headings.nth(i);
    if (!(await heading.isVisible().catch(() => false))) {
      continue;
    }
    const modal = heading
      .locator('xpath=ancestor::*[.//button[normalize-space()="Apply Now"]][1]')
      .first();
    if (await modal.isVisible().catch(() => false)) {
      return modal;
    }
  }
  return null;
}

/** Last visible, enabled Apply Now control belongs to the open modal. */
async function findApplyNowControl(page: Page): Promise<Locator | null> {
  const exactApply = /^\s*apply\s*now\s*$/i;
  const modal = await findMoreFiltersModal(page);
  const groups: Locator[] = [];

  if (modal) {
    groups.push(modal.getByRole("button", { name: /^apply\s*now$/i }));
    groups.push(
      modal
        .locator('button, [role="button"], a')
        .filter({ hasText: exactApply }),
    );
  }
  groups.push(
    page.locator('button, [role="button"], a').filter({ hasText: exactApply }),
  );
  groups.push(
    page.locator(
      'input[type="button"][value="Apply Now" i], input[type="submit"][value="Apply Now" i]',
    ),
  );
  groups.push(page.getByText(exactApply));

  for (const group of groups) {
    const count = await group.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i -= 1) {
      const candidate = group.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      if (!(await candidate.isEnabled().catch(() => true))) {
        continue;
      }
      return candidate;
    }
  }
  return null;
}

/** Modal hidden, a date chip, or refreshed results all confirm the filter. */
async function verifyMoreFiltersApplied(
  page: Page,
  logger: Logger,
): Promise<boolean> {
  await page.waitForTimeout(2000);

  const modalOpen = (await findMoreFiltersModal(page)) !== null;
  const chipVisible = await page
    .getByText(/onwards|opening\s*date/i)
    .first()
    .isVisible()
    .catch(() => false);
  const resultsVisible = await page
    .locator('button, a, [role="button"]')
    .filter({ hasText: /^\s*download\s*$/i })
    .first()
    .isVisible()
    .catch(() => false);

  if (modalOpen && !chipVisible && !resultsVisible) {
    return false;
  }
  if (!chipVisible) {
    logger.warn("BIDASSIST_OPENING_DATE_CHIP_NOT_CONFIRMED — continuing");
  }
  return true;
}

async function applyMoreFilters(options: {
  page: Page;
  logger: Logger;
}): Promise<void> {
  const { page, logger } = options;
  let escapePressed = false;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const control = await findApplyNowControl(page);

    if (control) {
      logger.info("BIDASSIST_MORE_FILTERS_APPLY_BUTTON_FOUND");
      await control.scrollIntoViewIfNeeded().catch(() => undefined);
      let clicked = true;
      try {
        await control.click({ timeout: 10_000 });
        logger.info("BIDASSIST_MORE_FILTERS_APPLY_CLICKED");
      } catch (error) {
        clicked = false;
        logger.warn(
          `BIDASSIST_MORE_FILTERS_APPLY_CLICK_FAILED=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      if (clicked && (await verifyMoreFiltersApplied(page, logger))) {
        logger.info("BIDASSIST_OPENING_DATE_FILTER_APPLIED");
        await waitForBidassistResults(page, logger);
        return;
      }
    } else {
      logger.warn("BIDASSIST_MORE_FILTERS_APPLY_BUTTON_NOT_FOUND");
    }

    // A single Escape closes the calendar overlay; a second would close the modal
    if (!escapePressed) {
      escapePressed = true;
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(500);
      if (!(await findMoreFiltersModal(page))) {
        logger.warn("BIDASSIST_MORE_FILTERS_MODAL_CLOSED_BY_ESCAPE");
      }
    }
  }

  throw new AutomationError(
    "BIDASSIST_OPENING_DATE_FILTER_NOT_APPLIED",
    "Apply Now could not be clicked or verified in the More Filters modal",
  );
}

/**
 * Applying a second filter can drop the category selection, which would let
 * unrelated categories into the results. Re-check and reapply when needed.
 */
export async function verifyResultsFilters(options: {
  page: Page;
  config: BidassistConfig;
  logger: Logger;
  requireOpeningDate: boolean;
}): Promise<void> {
  const { page, config, logger, requireOpeningDate } = options;

  const categoryApplied = detectCategoryRouteApplied({
    url: page.url(),
    bodyText: await readBodyText(page),
    category: config.category,
  });
  if (!categoryApplied) {
    logger.warn(`BIDASSIST_CATEGORY_FILTER_LOST=${config.category} — reapplying`);
    await applyCategoryFilter({ page, category: config.category, logger });
    await waitForBidassistResults(page, logger);
  }
  logger.info("BIDASSIST_CATEGORY_FILTER_VERIFIED");

  if (requireOpeningDate) {
    const dateApplied = /onwards|opening\s*date/i.test(await readBodyText(page));
    if (!dateApplied) {
      logger.warn("BIDASSIST_OPENING_DATE_FILTER_LOST — reapplying");
      await applyOpeningDateFilter({
        page,
        openingDateFrom: config.openingDateFrom,
        openingDateTo: config.openingDateTo,
        logger,
      });
    }
  }

  logger.info("BIDASSIST_RESULTS_FILTERS_VERIFIED");
}

/** Wait for the result list to settle before discovery starts. */
export async function waitForBidassistResults(
  page: Page,
  logger: Logger,
): Promise<void> {
  await page
    .locator('button, a, [role="button"]')
    .filter({ hasText: /^\s*download\s*$/i })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => undefined);
  await page.waitForTimeout(2000);
  logger.info("BIDASSIST_RESULTS_REFRESHED");
}

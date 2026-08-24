/**
 * Shared Tender247 date-scoped Fresh/list preparation.
 *
 * Historical runners must NEVER click Today Tenders or treat today's Fresh badge
 * as proof that the requested mail date is active.
 */
import type { Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import {
  formatIsoToDdMmYyyy,
  formatIsoToDdMmYyyySlash,
  getIndiaTodayIsoDate,
} from "../dateUtils.js";
import type { Logger } from "../logger.js";
import {
  assertMailDateReadyForExcel,
  buildFilteredDateLabelRegex,
  readCurrentSelectMailDate,
  readFilteredMailDateTab,
  selectAndVerifyTender247MailDate,
  type MailDateScreenshotHook,
  type Tender247MailDateSelectionResult,
} from "../tenderDetails/selectTender247MailDate.js";

function logLine(logger: Logger, message: string): void {
  logger.info(message);
  console.log(message);
}

/**
 * Ensure the Tender247 list is ready for the requested mail date.
 * Selects/verifies Select Mail Date via real calendar clicks and waits for
 * the filtered list. Does not click Today Tenders.
 */
export async function ensureTender247FreshListForDate(
  page: Page,
  requestedDate: string,
  logger: Logger,
  pageTimeoutMs?: number,
  options?: {
    screenshotHook?: MailDateScreenshotHook;
    forceCalendarClick?: boolean;
  },
): Promise<Tender247MailDateSelectionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new Error(`Invalid requestedDate=${requestedDate}; expected YYYY-MM-DD`);
  }

  logLine(logger, `FRESH_PREP_DATE=${requestedDate}`);
  logLine(logger, `DATE_SELECTOR_REQUESTED_DATE=${requestedDate}`);

  const mailDate = await selectAndVerifyTender247MailDate({
    page,
    dateIso: requestedDate,
    logger,
    pageTimeoutMs,
    screenshotHook: options?.screenshotHook,
    forceCalendarClick: options?.forceCalendarClick,
  });
  assertMailDateReadyForExcel(mailDate, requestedDate);

  const timeoutMs = pageTimeoutMs ?? 45_000;
  const isToday = requestedDate === getIndiaTodayIsoDate();
  const labelRe = buildFilteredDateLabelRegex(requestedDate);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = await readCurrentSelectMailDate(page);
    if (current.iso !== requestedDate) {
      throw new AutomationError(
        "TENDER247_DATE_RESET_DETECTED",
        `Select Mail Date reset after selection requested=${requestedDate} visible=${current.iso || current.inputValue || "null"}`,
      );
    }

    const filtered = await readFilteredMailDateTab(page, requestedDate);
    const hasTender = await page
      .getByText(/T247\s*ID\s*[-:]?\s*\d+/i)
      .first()
      .isVisible()
      .catch(() => false);

    if (!isToday) {
      // Historical: require dated tab when present, or at least tenders after verified input.
      if (filtered && hasTender) {
        logLine(
          logger,
          `TENDER247_FILTERED_DATE_LABEL=${filtered.filteredDateLabel}`,
        );
        logLine(
          logger,
          `TENDER247_FILTERED_TENDER_COUNT=${filtered.filteredTenderCount}`,
        );
        logLine(logger, "TENDER247_FRESH_LIST_READY");
        return {
          ...mailDate,
          filteredDateLabel: filtered.filteredDateLabel,
          filteredTenderCount: filtered.filteredTenderCount,
          listRefreshComplete: true,
        };
      }
      if (hasTender) {
        // Input verified; dated tab may lag — accept tenders only if input still matches.
        const datedVisible = await page
          .getByText(labelRe)
          .first()
          .isVisible()
          .catch(() => false);
        if (datedVisible || Date.now() > deadline - 2_000) {
          logLine(
            logger,
            `TENDER247_FILTERED_DATE_LABEL=${formatIsoToDdMmYyyy(requestedDate)}`,
          );
          logLine(logger, "TENDER247_FRESH_LIST_READY");
          return { ...mailDate, listRefreshComplete: true };
        }
      }
    } else {
      const freshVisible = await page
        .getByText(/Fresh\s*\(\s*\d+\s*\)/i)
        .first()
        .isVisible()
        .catch(() => false);
      if ((freshVisible || filtered) && hasTender) {
        logLine(logger, "TENDER247_FRESH_LIST_READY");
        return { ...mailDate, listRefreshComplete: true };
      }
      // Today + correct mail date + Fresh/filtered chrome, but zero tenders:
      // valid for secondary accounts — do not block Excel / fatal the pipeline.
      if (
        (freshVisible || Boolean(filtered)) &&
        !hasTender &&
        Date.now() > deadline - Math.min(8_000, Math.floor(timeoutMs / 3))
      ) {
        logLine(logger, "TENDER247_FRESH_LIST_EMPTY=true");
        logLine(logger, "TENDER247_FRESH_LIST_READY");
        return {
          ...mailDate,
          filteredDateLabel: filtered?.filteredDateLabel ?? null,
          filteredTenderCount: filtered?.filteredTenderCount ?? 0,
          listRefreshComplete: true,
        };
      }
    }

    await page.waitForTimeout(400);
  }

  throw new AutomationError(
    "TENDER247_DATE_FILTER_MISMATCH",
    `Tender list not ready for requestedDate=${requestedDate} expectedInput=${formatIsoToDdMmYyyySlash(requestedDate)} TENDER247_EXCEL_DOWNLOAD_BLOCKED=true`,
  );
}

/**
 * @deprecated Prefer ensureTender247FreshListForDate — kept for callers that only wait.
 * For historical dates this never treats today's Fresh badge as success.
 */
export async function waitForFreshTenderList(
  page: Page,
  logger: Logger,
  dateIso?: string,
): Promise<void> {
  if (dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    await ensureTender247FreshListForDate(page, dateIso, logger);
    return;
  }

  const freshTab = page.getByText(/Fresh\s*\(\s*\d+\s*\)/i).first();
  await freshTab.waitFor({ state: "visible", timeout: 15_000 });
  const firstTender = page.getByText(/T247\s*ID\s*[-:]?\s*\d+/i).first();
  await firstTender.waitFor({ state: "visible", timeout: 15_000 });
  logger.info("TENDER247_FRESH_LIST_READY");
}

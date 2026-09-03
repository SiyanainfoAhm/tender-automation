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
import {
  hasVisibleTender247Cards,
  isFreshTabBadgeVisible,
} from "../tenderDetails/tender247ListUi.js";

function logLine(logger: Logger, message: string): void {
  logger.info(message);
  console.log(message);
}

async function freshListSignalsReady(
  page: Page,
  requestedDate: string,
): Promise<{
  filtered: Awaited<ReturnType<typeof readFilteredMailDateTab>>;
  hasTender: boolean;
  freshVisible: boolean;
}> {
  const filtered = await readFilteredMailDateTab(page, requestedDate);
  const hasTender = await hasVisibleTender247Cards(page);
  const freshVisible = await isFreshTabBadgeVisible(page);
  return { filtered, hasTender, freshVisible };
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

  const initial = await freshListSignalsReady(page, requestedDate);
  if (initial.hasTender || initial.freshVisible || initial.filtered) {
    logLine(logger, "TENDER247_FRESH_LIST_READY");
    if (initial.filtered) {
      logLine(
        logger,
        `TENDER247_FILTERED_DATE_LABEL=${initial.filtered.filteredDateLabel}`,
      );
      logLine(
        logger,
        `TENDER247_FILTERED_TENDER_COUNT=${initial.filtered.filteredTenderCount}`,
      );
    }
    return {
      ...mailDate,
      filteredDateLabel:
        initial.filtered?.filteredDateLabel ?? mailDate.filteredDateLabel,
      filteredTenderCount:
        initial.filtered?.filteredTenderCount ?? mailDate.filteredTenderCount,
      listRefreshComplete: true,
    };
  }

  while (Date.now() < deadline) {
    const current = await readCurrentSelectMailDate(page);
    if (current.iso !== requestedDate) {
      throw new AutomationError(
        "TENDER247_DATE_RESET_DETECTED",
        `Select Mail Date reset after selection requested=${requestedDate} visible=${current.iso || current.inputValue || "null"}`,
      );
    }

    const { filtered, hasTender, freshVisible } = await freshListSignalsReady(
      page,
      requestedDate,
    );

    if (!isToday) {
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
      if ((freshVisible || filtered) && hasTender) {
        logLine(logger, "TENDER247_FRESH_LIST_READY");
        return { ...mailDate, listRefreshComplete: true };
      }
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
      if (
        mailDate.listRefreshComplete &&
        (freshVisible || hasTender) &&
        Date.now() > deadline - Math.min(8_000, Math.floor(timeoutMs / 3))
      ) {
        logLine(logger, "TENDER247_FRESH_LIST_READY");
        return { ...mailDate, listRefreshComplete: true };
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

  const freshTab = page.getByText(/Fresh\s*\(\s*[^)]+\s*\)/i).first();
  await freshTab.waitFor({ state: "visible", timeout: 15_000 });
  if (await isFreshTabBadgeVisible(page)) {
    logger.info("TENDER247_FRESH_TAB_VISIBLE=true");
  }
  const firstTender = page.getByText(/T247\s*ID/i).first();
  await firstTender.waitFor({ state: "visible", timeout: 15_000 });
  logger.info("TENDER247_FRESH_LIST_READY");
}

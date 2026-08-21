import type { BrowserContext, Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { ensureTender247FreshListForDate } from "../tender247Batch/ensureTender247FreshListForDate.js";
import {
  getActiveTender247RunContext,
  requestedDateFromDateFolderSafe,
} from "../tender247Batch/tender247RunContext.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "./dismissSupportChat.js";
import {
  assertSameBrowserContext,
  ensureTender247DetailAuthenticated,
} from "./ensureTender247LoggedIn.js";
import type { TenderListItem } from "./types.js";
import {
  assertOpenSingleTenderDetailsAllowed,
  loadPhase1DecisionsFromDisk,
  lookupScreeningDecision,
} from "../runScreening/phase1DetailQueue.js";
import type { Phase1CrawlStatus } from "../runScreening/phase1Statuses.js";
import {
  expandTender247Row,
  readTender247CardTitle,
} from "./tender247Expansion.js";
import { readCurrentSelectMailDate } from "./selectTender247MailDate.js";

export interface OpenSingleTenderResult {
  page: Page;
  item: TenderListItem;
}

async function ensureListMailDateForDetailOpen(
  page: Page,
  config: AppConfig,
  logger: Logger,
  dateFolder?: string,
): Promise<string | null> {
  const requestedDate =
    getActiveTender247RunContext()?.requestedDate ??
    (dateFolder ? requestedDateFromDateFolderSafe(dateFolder) : null);
  if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return null;
  }

  const current = await readCurrentSelectMailDate(page);
  if (current.iso === requestedDate) {
    logger.info(`TENDER247_DETAIL_MAIL_DATE_OK=${requestedDate}`);
    return requestedDate;
  }

  logger.warn(
    `TENDER247_MAIL_DATE_DRIFT detected=${current.iso || current.inputValue || "unknown"} requested=${requestedDate}`,
  );
  console.log(
    `TENDER247_MAIL_DATE_DRIFT detected=${current.iso || current.inputValue || "unknown"} requested=${requestedDate}`,
  );
  await ensureTender247FreshListForDate(
    page,
    requestedDate,
    logger,
    config.pageTimeoutMs,
  );
  const after = await readCurrentSelectMailDate(page);
  if (after.iso !== requestedDate) {
    throw new AutomationError(
      "TENDER247_DATE_FILTER_MISMATCH",
      `Cannot open tender: Select Mail Date is ${after.iso || after.inputValue || "unknown"} but run date is ${requestedDate}`,
    );
  }
  logger.info(`TENDER247_DETAIL_MAIL_DATE_RESTORED=${requestedDate}`);
  return requestedDate;
}

/**
 * Direct single-tender open — never touches Today/Closed dashboard selection.
 *
 * Flow: restore requested mail date → dismiss promo → minimize chat → find ID →
 * complete bordered row → explicit View/Eye if present, otherwise title span.
 */
export async function openSingleTenderDirectly(
  page: Page,
  context: BrowserContext,
  requestedT247Id: string,
  config: AppConfig,
  logger: Logger,
  screening?: {
    dateFolder?: string;
    phase1ScreeningStatus?: Phase1CrawlStatus | string;
  },
): Promise<OpenSingleTenderResult> {
  const id = requestedT247Id.replace(/\D/g, "");
  if (!id) {
    throw new AutomationError(
      "TENDER247_REQUESTED_TENDER_NOT_FOUND",
      "Requested T247 ID is empty",
    );
  }

  let status = screening?.phase1ScreeningStatus;
  if (!status && screening?.dateFolder) {
    const decisions = loadPhase1DecisionsFromDisk(screening.dateFolder);
    status = lookupScreeningDecision(decisions ?? new Map(), id)?.status;
    if (decisions && !status) {
      throw new AutomationError(
        "T247_SCREENING_DECISION_MISSING",
        `T247_SCREENING_DECISION_MISSING:${id}`,
      );
    }
  }
  if (status) {
    assertOpenSingleTenderDetailsAllowed(status, id);
  }

  await dismissTender247BlockingOverlays(page, logger, config);
  await dismissTender247SupportChat(page, logger);
  await ensureListMailDateForDetailOpen(
    page,
    config,
    logger,
    screening?.dateFolder,
  );

  const idRegex = new RegExp(`T247\\s*ID\\s*[-:]?\\s*${id}\\b`, "i");
  const idLocator = page.getByText(idRegex).first();

  try {
    await idLocator.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    // List may have drifted to "today" while scrolling prior tenders — restore once.
    await ensureListMailDateForDetailOpen(
      page,
      config,
      logger,
      screening?.dateFolder,
    );
    logger.info(`T247-${id} not initially visible; scrolling to find`);
    await scrollUntilIdVisible(page, idLocator, logger);
  }

  logger.info(`TENDER247_REQUESTED_TENDER_FOUND=${id}`);

  const completeTenderRow = await resolveCompleteTenderRow(idLocator, id, logger);

  await dismissTender247SupportChat(page, logger);
  await completeTenderRow.waitFor({ state: "visible", timeout: 5_000 });

  const titleHint = await readTender247CardTitle(completeTenderRow);
  const detailPagePromise = context.waitForEvent("page", { timeout: 15_000 });
  const expansion = await expandTender247Row({
    page,
    row: completeTenderRow,
    t247Id: id,
    titleHint,
    logger,
    context,
  });

  const detailPage = await detailPagePromise;
  await detailPage
    .waitForLoadState("domcontentloaded", { timeout: config.pageTimeoutMs })
    .catch(() => undefined);
  detailPage.setDefaultTimeout(config.pageTimeoutMs);
  assertSameBrowserContext(detailPage, context, logger, `T247-${id} detail tab`);
  logger.info(`TENDER247_DETAIL_NEW_TAB_OPENED url=${detailPage.url()}`);

  await dismissTender247BlockingOverlays(detailPage, logger, config);
  await dismissTender247SupportChat(detailPage, logger);
  await ensureTender247DetailAuthenticated(detailPage, context, logger, config);
  await waitForAnyDetailMarker(
    detailPage,
    Math.min(config.pageTimeoutMs, 30_000),
    logger,
  );
  logger.info("TENDER247_DETAIL_PAGE_OPENED");

  const listTitle =
    expansion.titleText ?? (await readTender247CardTitle(completeTenderRow));
  const listClosingDate = await readCardClosingDate(completeTenderRow);

  return {
    page: detailPage,
    item: {
      t247Id: id,
      detailUrl: detailPage.url(),
      listTitle,
      listClosingDate,
    },
  };
}

async function scrollUntilIdVisible(
  page: Page,
  idLocator: Locator,
  logger: Logger,
): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    if (await idLocator.isVisible().catch(() => false)) {
      return;
    }
    await page.mouse.wheel(0, Math.max(700, 800));
    await page.waitForTimeout(400);
  }
  await idLocator.waitFor({ state: "visible", timeout: 5_000 });
  logger.info("Requested ID became visible after scroll");
}

/**
 * Extract T247 IDs from text. Digits must follow "T247 ID", never the "247" in "T247".
 * "T247 ID- 101466917" → ["101466917"]
 */
function extractT247Ids(text: string): string[] {
  const ids: string[] = [];
  const regex = /T247\s*ID\s*[-:]?\s*(\d+)/gi;

  for (const match of text.matchAll(regex)) {
    const id = match[1];
    if (id) {
      ids.push(id);
    }
  }

  return ids;
}

/**
 * Outer bordered tender row (≈1010x136), NOT the left 791px content card.
 * Uses Playwright locators only — no page.evaluate.
 */
async function resolveCompleteTenderRow(
  idLocator: Locator,
  id: string,
  logger: Logger,
): Promise<Locator> {
  const candidate = idLocator.locator(
    'xpath=ancestor::div[contains(@class,"border") and contains(@class,"w-full")][1]',
  );

  const visible = await candidate.isVisible().catch(() => false);
  if (!visible) {
    throw new AutomationError(
      "TENDER247_COMPLETE_ROW_NOT_FOUND",
      "Could not identify full tender row (bordered w-full ancestor not visible)",
    );
  }

  const rowBox = await candidate.boundingBox();
  const rowText = ((await candidate.innerText().catch(() => "")) || "").replace(
    /\s+/g,
    " ",
  );
  const ids = extractT247Ids(rowText);
  const uniqueIds = Array.from(new Set(ids));
  logger.info(`COMPLETE_ROW_T247_IDS=${JSON.stringify(uniqueIds)}`);

  const svgCount = await candidate.locator("svg").count();

  if (!rowBox || rowBox.width < 850) {
    throw new AutomationError(
      "TENDER247_COMPLETE_ROW_NOT_FOUND",
      `Could not identify full tender row (box=${rowBox ? `${Math.round(rowBox.width)}x${Math.round(rowBox.height)}` : "null"}, svg=${svgCount})`,
    );
  }

  if (uniqueIds.length !== 1 || uniqueIds[0] !== id) {
    throw new AutomationError(
      "TENDER247_COMPLETE_ROW_NOT_FOUND",
      `Complete row T247 ID mismatch: expected ${id}, got ${JSON.stringify(uniqueIds)}`,
    );
  }

  logger.info("TENDER247_COMPLETE_ROW_FOUND");
  logger.info(
    `COMPLETE_ROW_SIZE=${Math.round(rowBox.width)}x${Math.round(rowBox.height)}`,
  );
  logger.info(`COMPLETE_ROW_SVG_COUNT=${svgCount}`);

  return candidate;
}

async function waitForAnyDetailMarker(
  page: Page,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const markers = [
      page.getByText(/^Brief$/i).first(),
      page.getByText(/^Description$/i).first(),
      page.getByText(/Submission\s*Date/i).first(),
      page.getByText(/Tender\s*Documents/i).first(),
      page.getByText(/AI\s*Generated\s*Tender\s*Summary/i).first(),
    ];
    for (const m of markers) {
      if (await m.isVisible().catch(() => false)) {
        return;
      }
    }
    await page.waitForTimeout(250);
  }
  logger.warn("No detail markers yet; continuing");
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

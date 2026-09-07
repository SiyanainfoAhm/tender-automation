import type { BrowserContext, Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { ensureTender247FreshListForDate } from "../tender247Batch/ensureTender247FreshListForDate.js";
import {
  getActiveTender247RunContext,
  requestedDateFromDateFolderSafe,
} from "../tender247Batch/tender247RunContext.js";
import {
  dismissTender247AdvanceSearchModal,
  dismissTender247Interruptions,
} from "./dismissTender247Interruptions.js";
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
import { searchTender247ListById } from "./searchTender247ById.js";
import {
  buildDetailPageUrl,
  buildSearchBody,
  mailSearchUrl,
  postJson,
  resolveSessionContext,
} from "../tender247Batch/apiClient.js";
import type { SearchTenderRow } from "../tender247Batch/types.js";

async function lookupSecurityCodeViaSearchApi(options: {
  page: Page;
  context: BrowserContext;
  mailDate: string;
  t247Id: string;
  logger: Logger;
}): Promise<string | null> {
  const session = await resolveSessionContext(
    options.page,
    options.context,
    options.mailDate,
    options.logger,
  );
  const body = {
    ...buildSearchBody(session, 1, 20),
    search_text: options.t247Id,
    exact_search: true,
    exact_search_text: true,
  };

  // Prefer in-page fetch so browser cookies/auth headers are used (context.request can 401).
  const viaPage = await options.page
    .evaluate(
      async ({ url, payload }) => {
        const response = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
        });
        const text = await response.text();
        return { status: response.status, text };
      },
      { url: mailSearchUrl(), payload: body },
    )
    .catch((error: unknown) => {
      options.logger.warn(
        `TENDER247_SECURITY_CODE_FETCH_FAILED=${
          error instanceof Error ? error.message.slice(0, 160) : String(error)
        }`,
      );
      return null;
    });

  let rows: SearchTenderRow[] = [];
  if (viaPage && viaPage.status >= 200 && viaPage.status < 300) {
    try {
      const parsed = JSON.parse(viaPage.text) as { Data?: SearchTenderRow[] };
      rows = Array.isArray(parsed.Data) ? parsed.Data : [];
    } catch {
      options.logger.warn("TENDER247_SECURITY_CODE_API_JSON_PARSE_FAILED");
    }
  } else if (viaPage) {
    options.logger.warn(
      `TENDER247_SECURITY_CODE_API_HTTP=${viaPage.status} body=${viaPage.text.slice(0, 160)}`,
    );
  }

  if (!rows.length) {
    try {
      const res = await postJson<SearchTenderRow[]>(
        options.page.request,
        mailSearchUrl(),
        body,
        options.logger,
      );
      rows = Array.isArray(res.Data) ? res.Data : [];
    } catch (error) {
      options.logger.warn(
        `TENDER247_SECURITY_CODE_PAGE_REQUEST_FAILED=${
          error instanceof Error ? error.message.slice(0, 200) : String(error)
        }`,
      );
      return null;
    }
  }

  for (const row of rows) {
    if (String(row.tender_id) !== options.t247Id) continue;
    const code = String(row.security_code || "").trim();
    if (code) {
      options.logger.info(
        `TENDER247_SECURITY_CODE_FROM_API id=${options.t247Id} code=${code.slice(0, 8)}…`,
      );
      return code;
    }
  }
  options.logger.warn(
    `TENDER247_SECURITY_CODE_API_MISS id=${options.t247Id} rows=${rows.length}`,
  );
  return null;
}

export interface OpenSingleTenderResult {
  page: Page;
  item: TenderListItem;
  openedVia: "popup" | "same_tab" | "same_context_page";
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

  await dismissTender247Interruptions(page, logger, config).catch(() => undefined);
  await dismissTender247AdvanceSearchModal(page, logger).catch(() => undefined);

  const tryRestore = async (hardReset: boolean): Promise<string> => {
    if (hardReset) {
      const dashboardUrl =
        config.tender247Url?.trim() || "https://www.tender247.com/auth/tender";
      logger.warn(
        `TENDER247_UI_HARD_RESET reason=mail-date-restore url=${dashboardUrl}`,
      );
      await page.goto(dashboardUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.pageTimeoutMs,
      });
      await page.waitForTimeout(800);
      await dismissTender247Interruptions(page, logger, config).catch(
        () => undefined,
      );
      await dismissTender247AdvanceSearchModal(page, logger).catch(
        () => undefined,
      );
    }

    const current = await readCurrentSelectMailDate(page);
    if (current.iso === requestedDate && !hardReset) {
      logger.info(`TENDER247_DETAIL_MAIL_DATE_OK=${requestedDate}`);
      return requestedDate;
    }

    if (current.iso !== requestedDate) {
      logger.warn(
        `TENDER247_MAIL_DATE_DRIFT detected=${current.iso || current.inputValue || "unknown"} requested=${requestedDate}`,
      );
      console.log(
        `TENDER247_MAIL_DATE_DRIFT detected=${current.iso || current.inputValue || "unknown"} requested=${requestedDate}`,
      );
    }

    await ensureTender247FreshListForDate(
      page,
      requestedDate,
      logger,
      config.pageTimeoutMs,
      hardReset ? { forceCalendarClick: true } : undefined,
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
  };

  try {
    return await tryRestore(false);
  } catch (firstError) {
    const msg =
      firstError instanceof Error ? firstError.message : String(firstError);
    const code =
      firstError instanceof AutomationError ? firstError.code : "";
    const retryable =
      code === "TENDER247_MAIL_DATE_PICKER_NOT_OPENED" ||
      code === "TENDER247_MAIL_DATE_CONTROL_NOT_FOUND" ||
      code === "TENDER247_DATE_FILTER_MISMATCH" ||
      /calendar popup did not appear|Select Mail Date/i.test(msg);
    if (!retryable) {
      throw firstError;
    }
    logger.warn(
      `TENDER247_MAIL_DATE_RESTORE_RETRY hard-reset after=${code || "error"} reason=${msg.slice(0, 160)}`,
    );
    return await tryRestore(true);
  }
}

async function restoreListAndMailDate(
  page: Page,
  config: AppConfig,
  logger: Logger,
  dateFolder?: string,
): Promise<void> {
  await dismissTender247Interruptions(page, logger, config).catch(() => undefined);
  await dismissTender247AdvanceSearchModal(page, logger).catch(() => undefined);

  const requestedDate =
    getActiveTender247RunContext()?.requestedDate ??
    (dateFolder ? requestedDateFromDateFolderSafe(dateFolder) : null);

  const hardResetDashboard = async (reason: string): Promise<void> => {
    const dashboardUrl =
      config.tender247Url?.trim() || "https://www.tender247.com/auth/tender";
    logger.warn(
      `TENDER247_UI_HARD_RESET reason=${reason} url=${dashboardUrl}`,
    );
    await page.goto(dashboardUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.pageTimeoutMs,
    });
    await page.waitForTimeout(800);
    await dismissTender247Interruptions(page, logger, config).catch(
      () => undefined,
    );
    await dismissTender247AdvanceSearchModal(page, logger).catch(
      () => undefined,
    );
  };

  // Reminder / Advance Search can leave Select Mail Date unreadable ("unknown")
  // or block the calendar even when a stale value is still visible.
  let beforeIso: string | null = null;
  try {
    beforeIso = (await readCurrentSelectMailDate(page)).iso;
  } catch {
    beforeIso = null;
  }
  if (!beforeIso) {
    await hardResetDashboard("mail-date-unknown");
  }

  const applyMailDate = async (): Promise<void> => {
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      await ensureTender247FreshListForDate(
        page,
        requestedDate,
        logger,
        config.pageTimeoutMs,
        { forceCalendarClick: true },
      );
      return;
    }
    await ensureListMailDateForDetailOpen(page, config, logger, dateFolder);
  };

  try {
    await applyMailDate();
  } catch (firstError) {
    const msg =
      firstError instanceof Error ? firstError.message : String(firstError);
    const code =
      firstError instanceof AutomationError ? firstError.code : "";
    logger.warn(
      `TENDER247_MAIL_DATE_RESTORE_RETRY hard-reset after=${code || "error"} reason=${msg.slice(0, 160)}`,
    );
    await hardResetDashboard("mail-date-picker-blocked");
    await applyMailDate();
  }
}

/**
 * Direct single-tender open — never touches Today/Closed dashboard selection.
 *
 * Flow: restore requested mail date → dismiss promo → minimize chat →
 * Tender Filters search by T247 ID → matching card → View/Eye or title.
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
    /** AI-summary-first: allow NO_GO / No Bid detail opens. */
    allowNoBidDetailOpen?: boolean;
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
  if (status && screening?.allowNoBidDetailOpen !== true) {
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

  let idLocator: Locator;
  let securityCodeFromSearch: string | null = null;
  try {
    const searched = await searchTender247ListById({
      page,
      t247Id: id,
      logger,
      pageTimeoutMs: config.pageTimeoutMs,
    });
    idLocator = searched.locator;
    securityCodeFromSearch = searched.securityCode;
  } catch (firstError) {
    const firstMsg =
      firstError instanceof Error ? firstError.message : String(firstError);
    logger.warn(
      `SEARCH_FAILED id=${id} stage=search attempt=1 reason=${firstMsg}`,
    );
    logger.info(`SEARCH_RETRY id=${id} restoring list and mail date`);
    await restoreListAndMailDate(page, config, logger, screening?.dateFolder);
    await dismissTender247BlockingOverlays(page, logger, config);
    await dismissTender247SupportChat(page, logger);
    try {
      const searched = await searchTender247ListById({
        page,
        t247Id: id,
        logger,
        pageTimeoutMs: config.pageTimeoutMs,
      });
      idLocator = searched.locator;
      securityCodeFromSearch = searched.securityCode;
    } catch (retryError) {
      const retryMsg =
        retryError instanceof Error ? retryError.message : String(retryError);
      throw new AutomationError(
        "TENDER247_SEARCH_FAILED",
        `Search-by-T247-ID failed for ${id} after retry: ${retryMsg}`,
      );
    }
  }

  logger.info(`TENDER247_REQUESTED_TENDER_FOUND=${id}`);

  let completeTenderRow = await resolveCompleteTenderRow(idLocator, id, logger);

  await dismissTender247SupportChat(page, logger);
  await completeTenderRow.waitFor({ state: "visible", timeout: 5_000 });

  let titleHint = await readTender247CardTitle(completeTenderRow);
  const previousUrl = page.url();
  let pagesBefore = new Set(context.pages());

  let pagePromise = context
    .waitForEvent("page", { timeout: 15_000 })
    .catch(() => null);

  const openViaSecurityCode = async (
    securityCode: string,
  ): Promise<OpenSingleTenderResult> => {
    const detailUrl = buildDetailPageUrl(id, securityCode);
    logger.info(`EXPAND_VIA_API_DETAIL_URL id=${id}`);
    console.log(`EXPAND_VIA_API_DETAIL_URL id=${id}`);
    await page.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.pageTimeoutMs,
    });
    await dismissTender247BlockingOverlays(page, logger, config);
    await dismissTender247SupportChat(page, logger);
    await ensureTender247DetailAuthenticated(page, context, logger, config);
    await waitForAnyDetailMarker(
      page,
      Math.min(config.pageTimeoutMs, 30_000),
      logger,
    );
    const detailIdOk = await detailPageShowsT247Id(page, id);
    if (!detailIdOk) {
      throw new AutomationError(
        "TENDER247_DETAIL_ID_MISMATCH",
        `API detail URL opened but T247 ID ${id} was not verified (url=${page.url()})`,
      );
    }
    logger.info("TENDER247_DETAIL_PAGE_OPENED");
    logger.info(`DETAIL_OPENED id=${id}`);
    console.log(`DETAIL_OPENED id=${id}`);
    return {
      page,
      openedVia: "same_tab",
      item: {
        t247Id: id,
        detailUrl: page.url(),
        listTitle: titleHint,
        listClosingDate: null,
      },
    };
  };

  let expansion: Awaited<ReturnType<typeof expandTender247Row>>;
  try {
    expansion = await expandTender247Row({
      page,
      row: completeTenderRow,
      t247Id: id,
      titleHint,
      logger,
      context,
    });
  } catch (expandError) {
    const expandMsg =
      expandError instanceof Error ? expandError.message : String(expandError);
    const retryable =
      expandError instanceof AutomationError &&
      (expandError.code === "TENDER247_TITLE_FALLBACK_NOT_FOUND" ||
        expandError.code === "TENDER247_REMINDER_MODAL_BLOCKING" ||
        expandError.code === "TENDER247_EXPANSION_NOT_VERIFIED");
    if (!retryable) {
      throw expandError;
    }
    logger.warn(
      `EXPAND_RETRY id=${id} after=${expandError instanceof AutomationError ? expandError.code : "error"} reason=${expandMsg.slice(0, 180)}`,
    );
    await dismissTender247Interruptions(page, logger, config);
    await dismissTender247AdvanceSearchModal(page, logger);

    if (securityCodeFromSearch) {
      return openViaSecurityCode(securityCodeFromSearch);
    }

    await restoreListAndMailDate(page, config, logger, screening?.dateFolder);

    const requestedDate =
      getActiveTender247RunContext()?.requestedDate ??
      (screening?.dateFolder
        ? requestedDateFromDateFolderSafe(screening.dateFolder)
        : null);
    if (requestedDate) {
      const securityCode = await lookupSecurityCodeViaSearchApi({
        page,
        context,
        mailDate: requestedDate,
        t247Id: id,
        logger,
      });
      if (securityCode) {
        return openViaSecurityCode(securityCode);
      }
    }

    const searched = await searchTender247ListById({
      page,
      t247Id: id,
      logger,
      pageTimeoutMs: config.pageTimeoutMs,
    });
    idLocator = searched.locator;
    securityCodeFromSearch = searched.securityCode;
    if (securityCodeFromSearch) {
      return openViaSecurityCode(securityCodeFromSearch);
    }
    completeTenderRow = await resolveCompleteTenderRow(idLocator, id, logger);
    titleHint = await readTender247CardTitle(completeTenderRow);
    pagesBefore = new Set(context.pages());
    pagePromise = context
      .waitForEvent("page", { timeout: 15_000 })
      .catch(() => null);
    expansion = await expandTender247Row({
      page,
      row: completeTenderRow,
      t247Id: id,
      titleHint,
      logger,
      context,
    });
  }

  const newPage = await pagePromise;
  let detailPage: Page;
  let openedVia: OpenSingleTenderResult["openedVia"];

  if (newPage && !newPage.isClosed()) {
    detailPage = newPage;
    openedVia = "popup";
  } else {
    const spawned = context.pages().find((p) => !pagesBefore.has(p) && !p.isClosed());
    if (spawned) {
      detailPage = spawned;
      openedVia = "same_context_page";
    } else {
      detailPage = page;
      openedVia = "same_tab";
      await waitForDetailOrUrlChange(
        detailPage,
        previousUrl,
        Math.min(config.pageTimeoutMs, 15_000),
        logger,
      );
    }
  }

  await detailPage
    .waitForLoadState("domcontentloaded", { timeout: config.pageTimeoutMs })
    .catch(() => undefined);
  detailPage.setDefaultTimeout(config.pageTimeoutMs);
  assertSameBrowserContext(detailPage, context, logger, `T247-${id} detail tab`);
  logger.info(
    `TENDER247_DETAIL_TAB_OPENED via=${openedVia} url=${detailPage.url()}`,
  );

  await dismissTender247BlockingOverlays(detailPage, logger, config);
  await dismissTender247SupportChat(detailPage, logger);
  await ensureTender247DetailAuthenticated(detailPage, context, logger, config);
  await waitForAnyDetailMarker(
    detailPage,
    Math.min(config.pageTimeoutMs, 30_000),
    logger,
  );

  const detailIdOk = await detailPageShowsT247Id(detailPage, id);
  if (!detailIdOk) {
    throw new AutomationError(
      "TENDER247_DETAIL_ID_MISMATCH",
      `Detail page opened but T247 ID ${id} was not verified (url=${detailPage.url()})`,
    );
  }

  logger.info("TENDER247_DETAIL_PAGE_OPENED");
  logger.info(`DETAIL_OPENED id=${id}`);
  console.log(`DETAIL_OPENED id=${id}`);

  const listTitle =
    expansion.titleText ?? (await readTender247CardTitle(completeTenderRow));
  const listClosingDate = await readCardClosingDate(completeTenderRow);

  return {
    page: detailPage,
    openedVia,
    item: {
      t247Id: id,
      detailUrl: detailPage.url(),
      listTitle,
      listClosingDate,
    },
  };
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

async function detailPageShowsT247Id(page: Page, id: string): Promise<boolean> {
  const url = page.url();
  if (new RegExp(`/tender/${id}(?:/|\\?|$)`, "i").test(url)) {
    return true;
  }
  const body = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "");
  return new RegExp(`(?:T247\\s*ID|Tender\\s*Id)\\s*[-:]?\\s*${id}\\b`, "i").test(
    body,
  );
}

async function waitForDetailOrUrlChange(
  page: Page,
  previousUrl: string,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.url() !== previousUrl) {
      logger.info(`Detail URL changed: ${page.url()}`);
      return;
    }
    if (await hasDetailMarker(page)) {
      logger.info("Detail markers appeared on same tab");
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

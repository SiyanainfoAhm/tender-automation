/**
 * Locate a Tender247 list card via Tender Filters → Search By T247 ID / Relevance.
 * Replaces Fresh-list scrolling for single-tender open paths.
 */
import type { Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";
import { dismissTender247AdvanceSearchModal } from "./dismissTender247Interruptions.js";

const SEARCH_TIMEOUT_MS = 20_000;
const FILTER_EXPAND_TIMEOUT_MS = 10_000;

/** Locators aligned with existing Tender247 filter UI patterns in sources/tender247.ts */
export const tender247IdSearchSelectors = {
  tenderFiltersHeader: (page: Page): Locator =>
    page
      .getByText("Tender Filters", { exact: true })
      .or(page.getByText("FILTERS", { exact: true }))
      .or(page.getByRole("button", { name: /tender\s*filters|filters/i }))
      .first(),

  /** Exact SEARCH control — never ADVANCE SEARCH */
  searchButton: (page: Page): Locator =>
    page
      .getByRole("button", { name: /^SEARCH$/i })
      .filter({ hasNotText: /ADVANCE/i })
      .first(),

  advanceSearchButton: (page: Page): Locator =>
    page
      .getByRole("button", { name: /ADVANCE\s*SEARCH/i })
      .or(page.getByText(/ADVANCE\s*SEARCH/i))
      .first(),

  /**
   * Filter field labeled “Search By T247 ID / Relevance” (verified manually).
   * Prefer placeholder / accessible name over CSS classes.
   */
  t247IdSearchInput: (page: Page): Locator =>
    page
      .getByPlaceholder(/Search\s+By\s+T247\s+ID\s*\/\s*Relevance/i)
      .or(page.getByLabel(/Search\s+By\s+T247\s+ID\s*\/\s*Relevance/i))
      .or(
        page.getByRole("textbox", {
          name: /Search\s+By\s+T247\s+ID|T247\s+ID\s*\/\s*Relevance/i,
        }),
      )
      .or(
        page.locator(
          'input[placeholder*="T247 ID" i], input[placeholder*="Relevance" i]',
        ),
      )
      .first(),

  loadingIndicator: (page: Page): Locator =>
    page
      .getByText(/^LOADING\.{0,3}$/i)
      .or(page.locator('[aria-busy="true"]'))
      .or(
        page.locator(
          '.loading, .spinner, [class*="loading" i][class*="overlay" i]',
        ),
      )
      .first(),

  dateField: (page: Page): Locator =>
    page
      .getByPlaceholder(/date|select date|dd|mm|yyyy|start|end/i)
      .or(page.getByLabel(/date|tender date|due date|published|period/i))
      .or(page.getByRole("textbox", { name: /date|period|range/i }))
      .or(
        page.locator(
          'input[placeholder*="Date" i], input[name*="date" i], .ant-picker, [class*="date-picker" i]',
        ),
      )
      .first(),
};

function idPattern(id: string): RegExp {
  return new RegExp(`T247\\s*ID\\s*[-:]?\\s*${id}\\b`, "i");
}

export async function expandTenderFiltersIfCollapsed(
  page: Page,
  logger: Logger,
): Promise<void> {
  const searchInput = tender247IdSearchSelectors.t247IdSearchInput(page);
  if (await searchInput.isVisible().catch(() => false)) {
    logger.info("Tender Filters already expanded (T247 ID search visible)");
    return;
  }

  const dateField = tender247IdSearchSelectors.dateField(page);
  if (await dateField.isVisible().catch(() => false)) {
    logger.info("Tender Filters already expanded (date field visible)");
    return;
  }

  const header = tender247IdSearchSelectors.tenderFiltersHeader(page);
  if (!(await header.isVisible().catch(() => false))) {
    logger.warn("Tender Filters header not found; attempting search input directly");
    return;
  }

  await header.click({ timeout: FILTER_EXPAND_TIMEOUT_MS });
  logger.info("Expanded Tender Filters section");
  await searchInput
    .waitFor({ state: "visible", timeout: FILTER_EXPAND_TIMEOUT_MS })
    .catch(async () => {
      await dateField
        .waitFor({ state: "visible", timeout: FILTER_EXPAND_TIMEOUT_MS })
        .catch(() => {
          logger.warn("Filter fields still not visible after expanding Tender Filters");
        });
    });
}

async function waitForSearchResultsSettled(
  page: Page,
  id: string,
  pageTimeoutMs: number,
  logger: Logger,
): Promise<void> {
  const timeoutMs = Math.min(pageTimeoutMs, SEARCH_TIMEOUT_MS);
  const responsePromise = page
    .waitForResponse(
      (response) => {
        const url = response.url().toLowerCase();
        return (
          response.request().method() !== "OPTIONS" &&
          (url.includes("tender") ||
            url.includes("search") ||
            url.includes("filter") ||
            url.includes("mail")) &&
          response.status() < 500
        );
      },
      { timeout: timeoutMs },
    )
    .catch(() => undefined);

  await responsePromise;

  const loading = tender247IdSearchSelectors.loadingIndicator(page);
  if (await loading.isVisible().catch(() => false)) {
    await loading
      .waitFor({ state: "hidden", timeout: timeoutMs })
      .catch(() => {
        logger.warn("Post-search loading indicator did not clear in time");
      });
  }

  await page
    .waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10_000) })
    .catch(() => {
      logger.warn("Post-search networkidle timed out; checking for T247 ID card");
    });

  const idLocator = page.getByText(idPattern(id)).first();
  try {
    await idLocator.waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    throw new AutomationError(
      "TENDER247_SEARCH_RESULT_NOT_FOUND",
      `No result card with exact T247 ID ${id} after SEARCH`,
    );
  }
}

/**
 * Expand filters (if needed), replace the T247 ID search value, click SEARCH,
 * and wait until a card with the exact ID is visible.
 */
export async function searchTender247ListById(options: {
  page: Page;
  t247Id: string;
  logger: Logger;
  pageTimeoutMs: number;
}): Promise<{ locator: Locator; securityCode: string | null }> {
  const id = options.t247Id.replace(/\D/g, "");
  if (!id) {
    throw new AutomationError(
      "TENDER247_REQUESTED_TENDER_NOT_FOUND",
      "Requested T247 ID is empty",
    );
  }

  const { page, logger, pageTimeoutMs } = options;
  await dismissTender247AdvanceSearchModal(page, logger);
  await expandTenderFiltersIfCollapsed(page, logger);

  const input = tender247IdSearchSelectors.t247IdSearchInput(page);
  try {
    await input.waitFor({ state: "visible", timeout: FILTER_EXPAND_TIMEOUT_MS });
  } catch {
    throw new AutomationError(
      "TENDER247_ID_SEARCH_INPUT_NOT_FOUND",
      'Could not find "Search By T247 ID / Relevance" input',
    );
  }

  await input.click({ timeout: 5_000 });
  await input.fill("");
  await input.fill(id);
  logger.info(`SEARCH_STARTED id=${id}`);
  console.log(`SEARCH_STARTED id=${id}`);

  const searchButton = tender247IdSearchSelectors.searchButton(page);
  try {
    await searchButton.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    throw new AutomationError(
      "SEARCH_BUTTON_NOT_FOUND",
      'Could not find the visible "SEARCH" button',
    );
  }

  const advance = tender247IdSearchSelectors.advanceSearchButton(page);
  if (await advance.isVisible().catch(() => false)) {
    const advanceBox = await advance.boundingBox().catch(() => null);
    const searchBox = await searchButton.boundingBox().catch(() => null);
    if (
      advanceBox &&
      searchBox &&
      Math.abs(advanceBox.x - searchBox.x) < 2 &&
      Math.abs(advanceBox.y - searchBox.y) < 2
    ) {
      throw new AutomationError(
        "SEARCH_BUTTON_AMBIGUOUS",
        "Resolved SEARCH control overlaps ADVANCE SEARCH — refusing click",
      );
    }
    // Keep Advance Search opener out of the click path.
    logger.info("TENDER247_ADVANCE_SEARCH_BUTTON_VISIBLE=true (not clicking)");
  }

  let securityCode: string | null = null;
  const onResponse = async (response: {
    url: () => string;
    status: () => number;
    json: () => Promise<unknown>;
  }): Promise<void> => {
    const url = response.url().toLowerCase();
    if (!url.includes("search-tender") || response.status() >= 400) return;
    try {
      const payload = (await response.json()) as {
        Data?: Array<{ tender_id?: string | number; security_code?: string }>;
      };
      const rows = Array.isArray(payload.Data) ? payload.Data : [];
      for (const row of rows) {
        if (String(row.tender_id) !== id) continue;
        const code = String(row.security_code || "").trim();
        if (code) {
          securityCode = code;
          logger.info(
            `TENDER247_SECURITY_CODE_FROM_SEARCH id=${id} code=${code.slice(0, 8)}…`,
          );
          break;
        }
      }
    } catch {
      // ignore non-JSON search responses
    }
  };
  page.on("response", onResponse);

  try {
    // Prefer DOM click on the exact SEARCH control to avoid hitting nearby ADVANCE SEARCH.
    await searchButton.evaluate((el: HTMLElement) => el.click()).catch(async () => {
      await searchButton.click({ timeout: 10_000 });
    });
    logger.info(`SEARCH_CLICKED id=${id}`);

    // Accidental ADVANCE SEARCH drawer blocks result cards / mail-date calendar.
    await dismissTender247AdvanceSearchModal(page, logger);

    await waitForSearchResultsSettled(page, id, pageTimeoutMs, logger);
  } finally {
    page.off("response", onResponse);
  }

  const idLocator = page.getByText(idPattern(id)).first();
  const cardText = ((await idLocator.innerText().catch(() => "")) || "").replace(
    /\s+/g,
    " ",
  );
  if (!idPattern(id).test(cardText) && !(await idLocator.isVisible().catch(() => false))) {
    throw new AutomationError(
      "TENDER247_SEARCH_RESULT_ID_MISMATCH",
      `Search result did not contain exact T247 ID ${id}`,
    );
  }

  logger.info(`SEARCH_RESULT_MATCHED id=${id}`);
  console.log(`SEARCH_RESULT_MATCHED id=${id}`);
  return { locator: idLocator, securityCode };
}

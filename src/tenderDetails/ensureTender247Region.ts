/**
 * Navigate the shared Tender247 session to the Indian or Global feed URL.
 *
 * Global is NOT an Indian filter — it is a separate authenticated list:
 *   INDIAN → https://www.tender247.com/auth/tender
 *   GLOBAL → https://www.tender247.com/auth/globaltender
 */
import type { Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";
import {
  getTender247Source,
  tender247RegionLabel,
  urlMatchesTender247Region,
  type Tender247SourceRegion,
} from "../tender247/sourceRegion.js";

function pageMatchesSource(page: Page, region: Tender247SourceRegion): boolean {
  return urlMatchesTender247Region(page.url(), region);
}

export async function ensureTender247Region(
  page: Page,
  region: Tender247SourceRegion,
  logger: Logger,
  timeoutMs = 30_000,
): Promise<void> {
  const source = getTender247Source(region);
  const label = tender247RegionLabel(region);
  logger.info(
    `TENDER247_REGION_SWITCH_START region=${region} url=${source.url}`,
  );
  console.log(
    `TENDER247_REGION_SWITCH_START region=${region} url=${source.url}`,
  );

  if (!pageMatchesSource(page, region)) {
    logger.info(`TENDER247_REGION_GOTO=${source.url}`);
    console.log(`TENDER247_REGION_GOTO=${source.url}`);
    await page.goto(source.url, { waitUntil: "domcontentloaded" });
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pageMatchesSource(page, region)) {
      await page.goto(source.url, { waitUntil: "domcontentloaded" }).catch(() => null);
    }

    const hasMailDate = await page
      .getByText(/Select\s+Mail\s+Date/i)
      .first()
      .isVisible()
      .catch(() => false);
    const hasXls = await page
      .locator(
        '[title*="XLS" i], [aria-label*="XLS" i], a[href*="xls" i], button:has-text("XLS")',
      )
      .or(page.getByRole("button", { name: /xls|excel|export/i }))
      .first()
      .isVisible()
      .catch(() => false);
    const hasFilters = await page
      .getByText(/Tender\s+Filters|FILTERS|Fresh(\s*\(|$)/i)
      .first()
      .isVisible()
      .catch(() => false);

    if (pageMatchesSource(page, region) && (hasMailDate || hasXls || hasFilters)) {
      logger.info(
        `TENDER247_REGION_READY region=${region} label=${label} url=${page.url()}`,
      );
      console.log(`TENDER247_REGION_READY region=${region}`);
      return;
    }
    await page.waitForTimeout(400);
  }

  throw new AutomationError(
    "TENDER247_REGION_NOT_READY",
    `Timed out waiting for ${label} feed at ${source.url} (Select Mail Date / Excel)`,
  );
}

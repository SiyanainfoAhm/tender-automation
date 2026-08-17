import type { Page } from "playwright";
import type { Logger } from "../logger.js";

/**
 * Confirm the open detail page still belongs to the owned T247 id
 * before each artifact stage.
 */
export async function verifyCurrentTenderId(
  page: Page,
  t247Id: string,
  logger: Logger,
): Promise<boolean> {
  const expected = String(t247Id).replace(/^T247-/i, "").trim();
  if (!expected) return false;

  const url = page.url();
  const fromPath = url.match(/\/(?:auth\/)?tender\/(\d+)/i)?.[1];
  const fromQuery = url.match(/[?&](?:tender[_-]?id|id)=(\d+)/i)?.[1];
  const bodySnippet = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "");
  const fromBody = bodySnippet.match(
    new RegExp(`(?:T247\\s*ID|Tender\\s*Id)\\s*[:\\-]?\\s*${expected}\\b`, "i"),
  );

  const pageId = fromPath || fromQuery || "";
  const matched =
    fromPath === expected ||
    fromQuery === expected ||
    url.includes(expected) ||
    Boolean(fromBody);

  logger.info(`T247_EXPECTED_ID=${expected}`);
  logger.info(`T247_PAGE_ID=${pageId || "unknown"}`);
  logger.info(`T247_ID_MATCH=${matched}`);

  if (matched) {
    logger.info(`T247_CURRENT_TENDER_ID_VERIFIED=${expected}`);
    return true;
  }

  logger.warn(
    `T247_CURRENT_TENDER_ID_MISMATCH expected=${expected} url=${url}`,
  );
  throw new Error(
    `T247_CURRENT_TENDER_ID_MISMATCH expected=${expected} url=${url}`,
  );
}

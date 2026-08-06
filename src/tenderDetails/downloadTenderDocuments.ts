import type { BrowserContext, Locator, Page } from "playwright";
import type { Logger } from "../logger.js";
import { dismissPageOverlays } from "./collectTenderLinks.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import {
  clickAndSaveDownload,
  documentBaseNameFromLinkText,
} from "./downloadHelpers.js";
import type { DownloadedFileRecord } from "./types.js";

export interface DocumentDownloadOptions {
  page: Page;
  context: BrowserContext;
  documentsDir: string;
  timeoutMs: number;
  downloadAllToo: boolean;
  logger: Logger;
}

/**
 * Expand Tender Documents and download each named document (preferred),
 * optionally also Download All Documents.
 */
export async function downloadTenderDocuments(
  options: DocumentDownloadOptions,
): Promise<DownloadedFileRecord[]> {
  const { page, context, documentsDir, timeoutMs, downloadAllToo, logger } =
    options;

  await dismissPageOverlays(page, logger);
  await expandSection(page, /Tender\s*Documents/i, logger);

  const records: DownloadedFileRecord[] = [];
  const individual = await findIndividualDocumentControls(page);
  logger.info(`Documents discovered: ${individual.length}`);

  let index = 1;
  for (const item of individual) {
    logger.info(`Document download starting: "${item.linkText}"`);
    const baseName = documentBaseNameFromLinkText(item.linkText, index);
    const record = await clickAndSaveDownload({
      page,
      context,
      clickTarget: async () => {
        await item.locator.click({ timeout: 15_000 });
      },
      destinationDir: documentsDir,
      preferredBaseName: baseName,
      preferredExtension: "pdf",
      timeoutMs,
      logger,
      kind: "document",
      linkText: item.linkText,
    });
    records.push(record);
    index += 1;
  }

  const downloadAll = page
    .getByRole("link", { name: /Download\s+All\s+Documents/i })
    .or(page.getByRole("button", { name: /Download\s+All\s+Documents/i }))
    .or(page.getByText(/Download\s+All\s+Documents/i))
    .first();

  const allVisible = await downloadAll.isVisible().catch(() => false);
  const shouldDownloadAll =
    allVisible && (downloadAllToo || individual.length === 0);

  if (shouldDownloadAll) {
    logger.info("Downloading via Download All Documents");
    const record = await clickAndSaveDownload({
      page,
      context,
      clickTarget: async () => {
        await downloadAll.click({ timeout: 15_000 });
      },
      destinationDir: documentsDir,
      preferredBaseName: "All_Documents",
      preferredExtension: "zip",
      timeoutMs,
      logger,
      kind: "document",
      linkText: "Download All Documents",
    });
    records.push(record);
  } else if (allVisible && individual.length > 0) {
    logger.info(
      "Skipping Download All Documents (individuals already downloaded; DOWNLOAD_ALL_DOCUMENTS_TOO=false)",
    );
  }

  if (records.length === 0) {
    logger.warn("No tender document download controls found");
  }

  return records;
}

async function expandSection(
  page: Page,
  heading: RegExp,
  logger: Logger,
): Promise<void> {
  await dismissTender247BlockingOverlays(page, logger);

  const header = page
    .getByRole("button", { name: heading })
    .or(page.getByRole("heading", { name: heading }))
    .or(page.getByText(heading))
    .first();

  if (!(await header.isVisible().catch(() => false))) {
    logger.warn(`Section heading not found: ${heading}`);
    return;
  }

  const expanded = await header.getAttribute("aria-expanded").catch(() => null);
  if (expanded === "true") {
    return;
  }

  // If download links already visible under heading, skip click
  const nearbyDownload = page.getByText(/Download/i).first();
  if (await nearbyDownload.isVisible().catch(() => false)) {
    return;
  }

  await header.click({ timeout: 5_000 }).catch(() => undefined);
  logger.info(`Expanded section matching ${heading}`);
}

async function findIndividualDocumentControls(
  page: Page,
): Promise<Array<{ linkText: string; locator: Locator }>> {
  const section = page
    .locator("section, div, article")
    .filter({ has: page.getByText(/Tender\s*Documents/i) })
    .first();

  const scope = (await section.count().catch(() => 0)) > 0 ? section : page;

  const controls = scope
    .getByRole("link", { name: /download/i })
    .or(scope.getByRole("button", { name: /download/i }));

  const count = await controls.count().catch(() => 0);
  const items: Array<{ linkText: string; locator: Locator }> = [];

  for (let i = 0; i < count; i += 1) {
    const locator = controls.nth(i);
    if (!(await locator.isVisible().catch(() => false))) {
      continue;
    }
    const linkText = ((await locator.innerText().catch(() => "")) || "").replace(
      /\s+/g,
      " ",
    ).trim();
    if (!linkText) {
      continue;
    }
    if (/download\s+all\s+documents/i.test(linkText)) {
      continue;
    }
    if (/corrigendum|ai\s*summary/i.test(linkText)) {
      continue;
    }
    // Prefer NIT / Tender Document style entries
    if (
      /nit|tender\s*document|document\s*\d+|download/i.test(linkText) ||
      /download/i.test(linkText)
    ) {
      items.push({ linkText, locator });
    }
  }

  // Also catch rows like "NIT — Download"
  const labeled = scope.getByText(/NIT|Tender\s*Document\s*\d+/i);
  const labeledCount = await labeled.count().catch(() => 0);
  for (let i = 0; i < labeledCount; i += 1) {
    const row = labeled.nth(i).locator(
      "xpath=ancestor::*[self::tr or self::li or self::div][1]",
    );
    const downloadCtrl = row
      .getByRole("link", { name: /download/i })
      .or(row.getByRole("button", { name: /download/i }))
      .or(row.getByText(/^Download$/i))
      .first();
    if (!(await downloadCtrl.isVisible().catch(() => false))) {
      continue;
    }
    const labelText = ((await labeled.nth(i).innerText().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    const already = items.some((it) => it.linkText.includes(labelText));
    if (!already && labelText) {
      items.push({
        linkText: `${labelText} — Download`,
        locator: downloadCtrl,
      });
    }
  }

  return items;
}

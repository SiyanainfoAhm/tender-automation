import type { BrowserContext, Locator, Page } from "playwright";
import type { Logger } from "../logger.js";
import { dismissPageOverlays } from "./collectTenderLinks.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { clickAndSaveDownload } from "./downloadHelpers.js";
import { sanitizeFileName } from "./tenderFolder.js";
import type { DownloadedFileRecord } from "./types.js";

export interface CorrigendaDownloadOptions {
  page: Page;
  context: BrowserContext;
  corrigendaDir: string;
  timeoutMs: number;
  logger: Logger;
}

/**
 * Download every corrigendum row under Corrigendum Documents.
 */
export async function downloadCorrigenda(
  options: CorrigendaDownloadOptions,
): Promise<DownloadedFileRecord[]> {
  const { page, context, corrigendaDir, timeoutMs, logger } = options;
  await dismissPageOverlays(page, logger);
  await expandCorrigendaSection(page, logger);

  const rows = await findCorrigendumRows(page);
  logger.info(`Corrigenda discovered: ${rows.length}`);

  const records: DownloadedFileRecord[] = [];
  for (const row of rows) {
    logger.info(
      `Corrigendum download starting: date=${row.publishedDate ?? "unknown"} type=${row.corrigendumType ?? "unknown"}`,
    );
    const datePart = sanitizeDateForFile(row.publishedDate) || "unknown-date";
    const typePart = sanitizeFileName(row.corrigendumType || "Corrigendum");
    const baseName = `Corrigendum_${datePart}_${typePart}`;

    const record = await clickAndSaveDownload({
      page,
      context,
      clickTarget: async () => {
        await row.downloadLocator.click({ timeout: 15_000 });
      },
      destinationDir: corrigendaDir,
      preferredBaseName: baseName,
      preferredExtension: "pdf",
      timeoutMs,
      logger,
      kind: "corrigendum",
      linkText: row.linkText,
      publishedDate: row.publishedDate,
      corrigendumType: row.corrigendumType,
    });
    records.push(record);
  }

  return records;
}

async function expandCorrigendaSection(page: Page, logger: Logger): Promise<void> {
  await dismissTender247BlockingOverlays(page, logger);

  const header = page
    .getByRole("button", { name: /Corrigendum\s*Documents?/i })
    .or(page.getByRole("heading", { name: /Corrigendum\s*Documents?/i }))
    .or(page.getByText(/Corrigendum\s*Documents?/i))
    .first();

  if (!(await header.isVisible().catch(() => false))) {
    logger.info("Corrigendum Documents section not visible");
    return;
  }

  const expanded = await header.getAttribute("aria-expanded").catch(() => null);
  if (expanded === "true") {
    return;
  }
  await header.click({ timeout: 5_000 }).catch(() => undefined);
  logger.info("Expanded Corrigendum Documents section");
}

interface CorrigendumRow {
  publishedDate: string | null;
  corrigendumType: string | null;
  linkText: string;
  downloadLocator: Locator;
}

async function findCorrigendumRows(page: Page): Promise<CorrigendumRow[]> {
  const section = page
    .locator("section, div, article")
    .filter({ has: page.getByText(/Corrigendum\s*Documents?/i) })
    .first();
  const scope = (await section.count().catch(() => 0)) > 0 ? section : page;

  const tableRows = scope.locator("table tr");
  const rowCount = await tableRows.count().catch(() => 0);
  const results: CorrigendumRow[] = [];

  for (let i = 0; i < rowCount; i += 1) {
    const row = tableRows.nth(i);
    const text = ((await row.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (!text || /published\s*date/i.test(text) && /corrigendum\s*type/i.test(text)) {
      // header row
      if (/published\s*date/i.test(text)) {
        continue;
      }
    }

    const downloadLocator = row
      .getByRole("link", { name: /download/i })
      .or(row.getByRole("button", { name: /download/i }))
      .or(row.getByText(/^Download$/i))
      .first();

    if (!(await downloadLocator.isVisible().catch(() => false))) {
      continue;
    }

    const cells = row.locator("td, th");
    const cellCount = await cells.count().catch(() => 0);
    let publishedDate: string | null = null;
    let corrigendumType: string | null = null;
    if (cellCount >= 2) {
      publishedDate = ((await cells.nth(0).innerText().catch(() => "")) || "")
        .replace(/\s+/g, " ")
        .trim() || null;
      corrigendumType = ((await cells.nth(1).innerText().catch(() => "")) || "")
        .replace(/\s+/g, " ")
        .trim() || null;
    } else {
      const dateMatch = text.match(
        /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{4}-\d{2}-\d{2})/,
      );
      publishedDate = dateMatch?.[1] ?? null;
      corrigendumType = "Corrigendum";
    }

    results.push({
      publishedDate,
      corrigendumType,
      linkText: `Corrigendum ${publishedDate ?? ""} ${corrigendumType ?? ""}`.trim(),
      downloadLocator,
    });
  }

  return results;
}

function sanitizeDateForFile(value: string | null): string {
  if (!value) {
    return "";
  }
  const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const dmy = value.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    let year = dmy[3];
    if (year.length === 2) {
      year = `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }
  return sanitizeFileName(value);
}

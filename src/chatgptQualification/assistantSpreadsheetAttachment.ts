/**
 * Detect ChatGPT assistant spreadsheet cards for RUN_EXCEL_SCREENING.
 *
 * The generated XLSX filename/card is the primary artifact.
 * The hover-only "Download file" control is NOT required for detection.
 */
import type { Locator, Page } from "playwright";

const XLSX_NAME_RE = /[A-Za-z0-9._-]+\.xlsx/gi;

export const SCREENING_STABILITY_POLLS = 3;

export type AssistantSpreadsheetHit = {
  filename: string;
  locator: Locator;
};

export type GeneratedScreeningWorkbook = {
  filename: string;
  cardLocator: Locator;
  assistantMessageLocator: Locator;
};

export type SpreadsheetScanResult = {
  filename: string | null;
  filenameMatchCount: number;
  downloadButtonCount: number;
  downloadButtonFound: boolean;
  downloadLocator: Locator | null;
  names: string[];
  cardLocator: Locator | null;
  assistantMessageLocator: Locator | null;
};

function extractXlsxNames(raw: string | null | undefined, inputFileName?: string): string[] {
  if (!raw) return [];
  const input = (inputFileName || "run-normalized.xlsx").replace(/\s+/g, " ").trim().toLowerCase();
  const matches = raw.match(XLSX_NAME_RE) || [];
  const names: string[] = [];
  for (const match of matches) {
    const name = match.trim();
    if (!name) continue;
    if (name.toLowerCase() === input) continue;
    names.push(name);
  }
  return names;
}

function pickOutputName(
  names: string[],
  inputFileName?: string,
  correlationId?: string,
): string | null {
  const input = (inputFileName || "").replace(/\s+/g, " ").trim().toLowerCase();
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const notInput = unique.filter((name) => name.toLowerCase() !== input);
  const screened = notInput.filter((name) => /screened/i.test(name));
  const pool = screened.length > 0 ? screened : notInput;
  if (correlationId) {
    const correlated = pool.find((name) =>
      name.toUpperCase().includes(correlationId.toUpperCase()),
    );
    if (correlated) return correlated;
  }
  const xlsx = pool.find((name) => /\.xlsx$/i.test(name));
  return xlsx || pool[0] || null;
}

export async function isScreeningGenerationActive(page: Page): Promise<boolean> {
  const stop = page.getByRole("button", {
    name: /stop generating|stop response/i,
    includeHidden: false,
  });
  if ((await stop.count().catch(() => 0)) > 0) {
    const visible = await stop.last().isVisible().catch(() => false);
    if (visible) return true;
  }
  const thinking = page.getByText(
    /^(Thinking|Searching|Working|Generating|Reading documents|Analysing|Analyzing)\b/i,
  );
  if ((await thinking.count().catch(() => 0)) > 0) {
    const visible = await thinking.last().isVisible().catch(() => false);
    if (visible) return true;
  }
  return false;
}

export async function countAssistantMessages(page: Page): Promise<number> {
  return page
    .locator('[data-message-author-role="assistant"]')
    .count()
    .catch(() => 0);
}

function composerAncestor(locator: Locator): Locator {
  return locator.locator(
    'xpath=ancestor::*[@data-agenttender-composer-token or @id="prompt-textarea" or @id="composer"] | ancestor::form[.//*[@id="prompt-textarea"]]',
  );
}

async function isInsideComposer(locator: Locator): Promise<boolean> {
  return (await composerAncestor(locator).count().catch(() => 0)) > 0;
}

function latestAssistantLocator(page: Page): Locator {
  return page.locator('[data-message-author-role="assistant"]').last();
}

async function collectNamesFromAssistant(
  assistant: Locator,
  inputFileName?: string,
): Promise<string[]> {
  const names: string[] = [];
  const consider = (raw: string | null | undefined) => {
    names.push(...extractXlsxNames(raw, inputFileName));
  };
  consider(await assistant.innerText().catch(() => ""));
  const attrNodes = assistant.locator("a, button, [download], [aria-label], [title]");
  const attrCount = await attrNodes.count().catch(() => 0);
  for (let i = 0; i < attrCount; i += 1) {
    const node = attrNodes.nth(i);
    consider(await node.getAttribute("download").catch(() => null));
    consider(await node.getAttribute("title").catch(() => null));
    consider(await node.getAttribute("aria-label").catch(() => null));
    consider(await node.getAttribute("href").catch(() => null));
  }
  const textHits = assistant.getByText(/\.xlsx/i);
  const textCount = await textHits.count().catch(() => 0);
  for (let i = 0; i < textCount; i += 1) {
    consider(await textHits.nth(i).innerText().catch(() => ""));
    consider(await textHits.nth(i).textContent().catch(() => ""));
  }
  return [...new Set(names)];
}

async function cardForFilename(
  assistant: Locator,
  filename: string,
): Promise<Locator> {
  const nameLoc = assistant.getByText(filename, { exact: false }).last();
  if ((await nameLoc.count().catch(() => 0)) === 0) {
    const anyXlsx = assistant.getByText(/\.xlsx/i).last();
    if ((await anyXlsx.count().catch(() => 0)) > 0) return anyXlsx;
    return assistant;
  }
  const withSpreadsheet = nameLoc.locator(
    'xpath=ancestor::*[contains(translate(normalize-space(.),"SPREADSHEET","spreadsheet"),"spreadsheet")][1]',
  );
  if ((await withSpreadsheet.count().catch(() => 0)) > 0) {
    return withSpreadsheet.first();
  }
  const withControl = nameLoc.locator(
    'xpath=ancestor::*[.//button or .//a][1]',
  );
  if ((await withControl.count().catch(() => 0)) > 0) {
    return withControl.first();
  }
  const parent = nameLoc.locator("xpath=ancestor::*[1]");
  if ((await parent.count().catch(() => 0)) > 0) return parent.first();
  return nameLoc;
}

export async function findGeneratedScreeningWorkbook(
  page: Page,
  options: {
    correlationId: string;
    inputFileName?: string;
    assistantCountBefore?: number;
  },
): Promise<GeneratedScreeningWorkbook | null> {
  const assistantCountBefore = options.assistantCountBefore ?? 0;
  const total = await countAssistantMessages(page);
  if (total <= assistantCountBefore) return null;

  const assistant = latestAssistantLocator(page);
  if ((await assistant.count().catch(() => 0)) === 0) return null;
  if (await isInsideComposer(assistant)) return null;

  const names = await collectNamesFromAssistant(assistant, options.inputFileName);
  const preferred = new RegExp(
    `run-normalized-screened-${options.correlationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.xlsx`,
    "i",
  );
  const exact = names.find((name) => preferred.test(name));
  const filename =
    exact ||
    pickOutputName(names, options.inputFileName, options.correlationId);
  if (!filename) return null;

  const cardLocator = await cardForFilename(assistant, filename);
  return {
    filename,
    cardLocator,
    assistantMessageLocator: assistant,
  };
}

function downloadLocators(scope: Locator): Locator[] {
  return [
    scope.getByRole("button", { name: /download file/i, includeHidden: true }),
    scope.locator('button[aria-label*="Download file" i]'),
    scope.locator('[aria-label*="Download file" i]'),
    scope.locator('button[title*="Download file" i]'),
    scope.locator('button[aria-label*="Download" i]'),
    scope.locator('button[title*="Download" i]'),
    scope.getByRole("link", { name: /download file|download the completed/i }),
    scope.locator('a[download*=".xlsx" i], a[href*=".xlsx" i]'),
  ];
}

async function firstAttached(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const n = await locator.count().catch(() => 0);
    for (let i = n - 1; i >= 0; i -= 1) {
      const item = locator.nth(i);
      if (await isInsideComposer(item)) continue;
      return item;
    }
  }
  return null;
}

/**
 * Hover the generated file card so ChatGPT's download control can appear,
 * then return the download button/link. Hidden-until-hover is expected.
 */
export async function revealDownloadControl(
  page: Page,
  workbook: GeneratedScreeningWorkbook,
): Promise<Locator | null> {
  await workbook.cardLocator.scrollIntoViewIfNeeded().catch(() => undefined);
  await workbook.cardLocator.hover({ timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(400);

  const fromCard = await firstAttached(downloadLocators(workbook.cardLocator));
  if (fromCard) return fromCard;

  const fromAssistant = await firstAttached(
    downloadLocators(workbook.assistantMessageLocator),
  );
  if (fromAssistant) return fromAssistant;

  const fileLink = workbook.assistantMessageLocator.locator(
    `a:has-text("${workbook.filename}"), a[download*="${workbook.filename}" i], a[href*=".xlsx" i]`,
  );
  if ((await fileLink.count().catch(() => 0)) > 0) {
    return fileLink.last();
  }

  const proseLink = workbook.assistantMessageLocator.getByRole("link", {
    name: /download the completed phase-1 screened workbook|download.*xlsx/i,
  });
  if ((await proseLink.count().catch(() => 0)) > 0) {
    return proseLink.last();
  }

  return workbook.cardLocator;
}

export async function scanLatestAssistantSpreadsheet(
  page: Page,
  options: {
    inputFileName?: string;
    correlationId?: string;
    assistantCountBefore?: number;
  },
): Promise<SpreadsheetScanResult> {
  const workbook = options.correlationId
    ? await findGeneratedScreeningWorkbook(page, {
        correlationId: options.correlationId,
        inputFileName: options.inputFileName,
        assistantCountBefore: options.assistantCountBefore,
      })
    : null;

  const visibleDownload = page.getByRole("button", { name: /download file/i });
  let downloadButtonCount = 0;
  const visibleN = await visibleDownload.count().catch(() => 0);
  for (let i = 0; i < visibleN; i += 1) {
    const item = visibleDownload.nth(i);
    if (await isInsideComposer(item)) continue;
    if (await item.isVisible().catch(() => false)) downloadButtonCount += 1;
  }

  let downloadLocator: Locator | null = null;
  if (workbook) {
    downloadLocator = await firstAttached(downloadLocators(workbook.cardLocator));
  }

  return {
    filename: workbook?.filename ?? null,
    filenameMatchCount: workbook ? 1 : 0,
    downloadButtonCount,
    downloadButtonFound: Boolean(downloadLocator),
    downloadLocator,
    names: workbook ? [workbook.filename] : [],
    cardLocator: workbook?.cardLocator ?? null,
    assistantMessageLocator: workbook?.assistantMessageLocator ?? null,
  };
}

export async function detectAssistantSpreadsheetFilename(
  page: Page,
  options: {
    assistantCountBefore: number;
    inputFileName?: string;
    correlationId?: string;
  },
): Promise<string | null> {
  if (!options.correlationId) return null;
  const hit = await findGeneratedScreeningWorkbook(page, {
    correlationId: options.correlationId,
    inputFileName: options.inputFileName,
    assistantCountBefore: options.assistantCountBefore,
  });
  return hit?.filename ?? null;
}

export async function findAssistantSpreadsheetAttachment(
  page: Page,
  options: {
    assistantCountBefore: number;
    inputFileName?: string;
    correlationId?: string;
    filename?: string;
  },
): Promise<AssistantSpreadsheetHit | null> {
  if (!options.correlationId && !options.filename) {
    const scan = await scanLatestAssistantSpreadsheet(page, options);
    if (!scan.filename || !scan.cardLocator) return null;
    return { filename: scan.filename, locator: scan.downloadLocator || scan.cardLocator };
  }
  const hit = await findGeneratedScreeningWorkbook(page, {
    correlationId: options.correlationId || "RUN",
    inputFileName: options.inputFileName,
    assistantCountBefore: options.assistantCountBefore,
  });
  if (!hit) return null;
  const filename = options.filename || hit.filename;
  const download = await revealDownloadControl(page, hit);
  return { filename, locator: download || hit.cardLocator };
}

export async function resolveAssistantSpreadsheetHref(
  page: Page,
  locator: Locator,
  inputFileName?: string,
): Promise<string | null> {
  const input = (inputFileName || "run-normalized.xlsx").toLowerCase();
  const candidates: Locator[] = [
    locator,
    locator.locator("xpath=ancestor::a[1]"),
    locator.locator("xpath=.//a[@href]"),
    page
      .locator('[data-message-author-role="assistant"]')
      .last()
      .locator('a[href*=".xlsx"], a[download*=".xlsx"]'),
  ];
  for (const candidate of candidates) {
    const n = await candidate.count().catch(() => 0);
    for (let i = 0; i < n; i += 1) {
      const item = candidate.nth(i);
      const href = (await item.getAttribute("href").catch(() => null)) || "";
      const download = (await item.getAttribute("download").catch(() => null)) || "";
      if (!href || href === "#" || href.startsWith("javascript:")) continue;
      const blob = `${href} ${download}`.toLowerCase();
      if (blob.includes(input) && !/screened/i.test(blob)) continue;
      try {
        return new URL(href, page.url()).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}

export async function tryFindGeneratedWorkbookInLibrary(
  page: Page,
  options: {
    filename: string;
    correlationId: string;
    conversationUrl: string;
  },
): Promise<GeneratedScreeningWorkbook | null> {
  const libraryControl = page.getByRole("link", { name: /^library$/i }).or(
    page.getByRole("button", { name: /^library$/i }),
  );
  if ((await libraryControl.count().catch(() => 0)) === 0) return null;
  await libraryControl.first().click({ timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(1_000);
  const match = page.getByText(options.filename, { exact: false }).last();
  if ((await match.count().catch(() => 0)) === 0) {
    await page.goto(options.conversationUrl, { waitUntil: "domcontentloaded" }).catch(
      () => undefined,
    );
    return null;
  }
  if (!match) return null;
  return {
    filename: options.filename,
    cardLocator: match,
    assistantMessageLocator: match,
  };
}

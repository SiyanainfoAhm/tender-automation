/**
 * ChatGPT spreadsheet preview download.
 * Clicking a generated XLSX card opens a right-side preview; the browser
 * download event only fires after the preview toolbar Download control.
 */
import fs from "node:fs";
import path from "node:path";
import type { Download, Locator, Page } from "playwright";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";
import { ensureDir } from "../fileUtils.js";

export type ScreeningArtifactStatus =
  | "NOT_STARTED"
  | "GENERATING"
  | "GENERATED"
  | "PREVIEW_OPENED"
  | "DOWNLOADING"
  | "DOWNLOADED"
  | "DOWNLOAD_FAILED";

export type XlsxDownloadFailureStage =
  | "CARD_CLICK"
  | "PREVIEW_OPEN"
  | "DOWNLOAD_BUTTON_NOT_FOUND"
  | "DOWNLOAD_EVENT_TIMEOUT"
  | "LOCAL_FILE_VALIDATION";

export type PreviewDownloadResult = {
  outputPath: string;
  originalFilename: string;
  artifactStatus: ScreeningArtifactStatus;
};

const PREVIEW_OPEN_TIMEOUT_MS = 20_000;
const DOWNLOAD_EVENT_TIMEOUT_MS = 60_000;
const PREVIEW_EARLY_EXIT_MS = 3_500;

function log(logger: Logger, message: string): void {
  console.log(message);
  logger.info(message);
}

function logFailureStage(logger: Logger, stage: XlsxDownloadFailureStage): void {
  log(logger, `CHATGPT_XLSX_DOWNLOAD_FAILURE_STAGE=${stage}`);
}

export function previewRootLocator(page: Page): Locator {
  return page
    .locator(
      [
        '[role="dialog"]',
        '[data-testid*="spreadsheet" i]',
        '[data-testid*="file-preview" i]',
        '[data-testid*="filepreview" i]',
        '[data-testid*="preview-panel" i]',
        'aside:has(button[aria-label*="download" i])',
        'section:has(button[aria-label="Download"])',
        '[class*="spreadsheet" i]',
      ].join(", "),
    )
    .last();
}

function previewDownloadButtonLocators(scope: Locator): Locator[] {
  return [
    scope.locator('button[aria-label="Download"]'),
    scope.locator('button[aria-label*="download" i]'),
    scope.locator('[role="button"][aria-label*="download" i]'),
    scope.locator('button[title*="download" i]'),
    scope.locator('[data-testid*="download" i]'),
    scope.getByRole("button", { name: /^download$/i }),
    scope.getByRole("button", { name: /download file/i }),
    scope.getByRole("link", { name: /download/i }),
    // Icon-only download controls (Terra / Open file cards)
    scope.locator(
      'button:has(svg), [role="button"]:has(svg[aria-label*="download" i])',
    ),
  ];
}

async function firstVisible(locators: Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const n = await locator.count().catch(() => 0);
    if (n === 0) continue;
    const candidate = locator.last();
    if (await candidate.isVisible().catch(() => false)) return candidate;
    if (n > 0) return candidate;
  }
  return null;
}

export async function dumpPreviewToolbarButtons(
  page: Page,
  preview: Locator | null,
  logger: Logger,
): Promise<void> {
  const scope = preview ?? page.locator("body");
  const buttons = await scope
    .locator("button, [role='button']")
    .evaluateAll((els) =>
      els.slice(0, 40).map((el) => ({
        text: ((el as HTMLElement).innerText || "").slice(0, 80),
        ariaLabel: el.getAttribute("aria-label"),
        title: el.getAttribute("title"),
        testId: el.getAttribute("data-testid"),
        role: el.getAttribute("role"),
      })),
    )
    .catch(() => []);
  log(logger, `CHATGPT_XLSX_PREVIEW_BUTTONS=${JSON.stringify(buttons)}`);
}

export async function waitForSpreadsheetPreview(
  page: Page,
  expectedFilename: string,
  logger: Logger,
  timeoutMs = PREVIEW_OPEN_TIMEOUT_MS,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  const started = Date.now();
  while (Date.now() < deadline) {
    const root = previewRootLocator(page);
    const rootVisible = (await root.count().catch(() => 0)) > 0
      && (await root.isVisible().catch(() => false));
    const headerHasName =
      rootVisible &&
      (await root
        .getByText(expectedFilename, { exact: false })
        .first()
        .isVisible()
        .catch(() => false));
    const downloadInPreview =
      rootVisible &&
      (await firstVisible(previewDownloadButtonLocators(root))) != null;
    const closeInPreview =
      rootVisible &&
      (await root
        .locator(
          'button[aria-label*="close" i], [aria-label*="close preview" i], [aria-label*="dismiss" i]',
        )
        .count()
        .catch(() => 0)) > 0;
    const gridVisible =
      rootVisible &&
      (await root
        .locator('[role="grid"], table, canvas, [data-testid*="grid" i]')
        .first()
        .isVisible()
        .catch(() => false));

    if (rootVisible && (headerHasName || downloadInPreview || closeInPreview || gridVisible)) {
      await page.waitForTimeout(800).catch(() => undefined);
      log(logger, "CHATGPT_XLSX_PREVIEW_OPENED=true");
      return root;
    }

    if (Date.now() - started >= PREVIEW_EARLY_EXIT_MS && !rootVisible) {
      return null;
    }
    await page.waitForTimeout(250).catch(() => undefined);
  }
  return null;
}

async function hoverPreviewToolbar(preview: Locator, page: Page): Promise<void> {
  const box = await preview.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.move(box.x + box.width - 24, box.y + 16).catch(() => undefined);
    await page.waitForTimeout(400).catch(() => undefined);
    return;
  }
  await preview.hover({ timeout: 3_000, force: true }).catch(() => undefined);
  await page.waitForTimeout(400).catch(() => undefined);
}

export async function closeSpreadsheetPreviewIfOpen(
  page: Page,
  logger?: Logger,
): Promise<void> {
  const closeSelectors = [
    'button[aria-label*="Close" i]',
    'button[aria-label*="close preview" i]',
    'button[aria-label*="Dismiss" i]',
    '[aria-label*="Close preview" i]',
  ];
  for (const selector of closeSelectors) {
    const closeBtn = page.locator(selector).last();
    if ((await closeBtn.count().catch(() => 0)) === 0) continue;
    if (!(await closeBtn.isVisible().catch(() => false))) continue;
    await closeBtn.click({ force: true, timeout: 3_000 }).catch(() => undefined);
    logger?.info("CHATGPT_XLSX_PREVIEW_CLOSED=true");
    await page.waitForTimeout(400).catch(() => undefined);
    return;
  }
}

async function findPreviewDownloadButton(
  page: Page,
  preview: Locator,
  logger: Logger,
): Promise<Locator | null> {
  let button = await firstVisible(previewDownloadButtonLocators(preview));
  if (button) return button;

  await hoverPreviewToolbar(preview, page);
  button = await firstVisible(previewDownloadButtonLocators(preview));
  if (button) return button;

  const named = preview.locator("button, [role='button'], a").filter({
    hasText: /download|save|export/i,
  });
  if ((await named.count().catch(() => 0)) > 0) {
    return named.last();
  }

  const pageLevel = await firstVisible(previewDownloadButtonLocators(page.locator("body")));
  if (pageLevel) return pageLevel;

  const icon = preview.locator(
    'svg[data-icon*="download" i], svg[aria-label*="download" i]',
  );
  if ((await icon.count().catch(() => 0)) > 0) {
    const clickable = icon
      .last()
      .locator("xpath=ancestor::button[1] | ancestor::*[@role='button'][1]");
    if ((await clickable.count().catch(() => 0)) > 0) return clickable.first();
  }

  await dumpPreviewToolbarButtons(page, preview, logger);
  return null;
}

async function saveAndVerifyDownload(
  download: Download,
  finalOutputPath: string,
  logger: Logger,
): Promise<boolean> {
  ensureDir(path.dirname(finalOutputPath));
  try {
    await download.saveAs(finalOutputPath);
  } catch (error) {
    const failure = await download.failure().catch(() => String(error));
    logger.warn(`CHATGPT_SCREENING_DOWNLOAD_SAVE_RETRY=${failure || "saveAs failed"}`);
    const tmpPath = await download.path().catch(() => null);
    if (tmpPath && fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 0) {
      fs.copyFileSync(tmpPath, finalOutputPath);
    }
  }
  if (!fs.existsSync(finalOutputPath)) return false;
  const size = fs.statSync(finalOutputPath).size;
  if (size <= 0) return false;
  if (!/\.xlsx$/i.test(finalOutputPath) && !/\.xlsx$/i.test(download.suggestedFilename?.() || "")) {
    logger.warn("CHATGPT_XLSX_LOCAL_FILE_EXTENSION_UNEXPECTED=true");
  }
  log(logger, "CHATGPT_XLSX_LOCAL_FILE_VERIFIED=true");
  log(logger, `CHATGPT_XLSX_DOWNLOADED_PATH=${finalOutputPath}`);
  log(logger, `CHATGPT_XLSX_DOWNLOADED_FILE_SIZE=${size}`);
  return true;
}

async function clickDownloadAwaitingEvent(
  page: Page,
  downloadButton: Locator,
  logger: Logger,
  useEnter = false,
): Promise<Download | null> {
  const downloadPromise = page.waitForEvent("download", {
    timeout: DOWNLOAD_EVENT_TIMEOUT_MS,
  });
  await downloadButton.scrollIntoViewIfNeeded().catch(() => undefined);
  if (useEnter) {
    await downloadButton.focus().catch(() => undefined);
    await page.keyboard.press("Enter");
  } else {
    await downloadButton.click({ force: true, timeout: 8_000 });
  }
  log(logger, "CHATGPT_XLSX_PREVIEW_DOWNLOAD_CLICKED=true");
  try {
    const download = await downloadPromise;
    log(logger, "CHATGPT_XLSX_DOWNLOAD_EVENT_RECEIVED=true");
    log(logger, "CHATGPT_SCREENING_OUTPUT_DOWNLOAD_EVENT_RECEIVED=true");
    return download;
  } catch {
    logFailureStage(logger, "DOWNLOAD_EVENT_TIMEOUT");
    return null;
  }
}

export async function clickGeneratedXlsxCard(
  page: Page,
  expectedFilename: string,
  cardLocator: Locator,
  logger: Logger,
): Promise<void> {
  const matches = page.getByText(expectedFilename, { exact: false });
  const n = await matches.count().catch(() => 0);
  let target = cardLocator;
  for (let i = n - 1; i >= 0; i -= 1) {
    const item = matches.nth(i);
    if (await item.isVisible().catch(() => false)) {
      target = item;
      break;
    }
  }
  await target.waitFor({ state: "visible", timeout: 60_000 });
  await target.scrollIntoViewIfNeeded().catch(() => undefined);
  await target.click({ force: true, timeout: 8_000 });
  log(logger, "CHATGPT_XLSX_CARD_CLICKED=true");
}

export async function downloadGeneratedChatGptXlsx(options: {
  page: Page;
  expectedFilename: string;
  cardLocator: Locator;
  finalOutputPath: string;
  logger: Logger;
}): Promise<PreviewDownloadResult | { previewOpened: boolean; stage: XlsxDownloadFailureStage }> {
  const { page, expectedFilename, cardLocator, finalOutputPath, logger } = options;
  ensureDir(path.dirname(finalOutputPath));
  try {
    await clickGeneratedXlsxCard(page, expectedFilename, cardLocator, logger);
  } catch (error) {
    logFailureStage(logger, "CARD_CLICK");
    logger.warn(
      `CHATGPT_XLSX_CARD_CLICK_FAILED=${error instanceof Error ? error.message : String(error)}`,
    );
    return { previewOpened: false, stage: "CARD_CLICK" };
  }

  const preview = await waitForSpreadsheetPreview(page, expectedFilename, logger);
  if (!preview) {
    log(logger, "CHATGPT_XLSX_PREVIEW_OPENED=false");
    logFailureStage(logger, "PREVIEW_OPEN");
    return { previewOpened: false, stage: "PREVIEW_OPEN" };
  }

  const fromPreview = await downloadFromOpenPreview(
    page,
    preview,
    expectedFilename,
    finalOutputPath,
    logger,
  );
  if (fromPreview) return fromPreview;
  return { previewOpened: true, stage: "DOWNLOAD_EVENT_TIMEOUT" };
}

async function downloadFromOpenPreview(
  page: Page,
  preview: Locator,
  expectedFilename: string,
  finalOutputPath: string,
  logger: Logger,
): Promise<PreviewDownloadResult | null> {
  const downloadButton = await findPreviewDownloadButton(page, preview, logger);
  if (!downloadButton) {
    logFailureStage(logger, "DOWNLOAD_BUTTON_NOT_FOUND");
    return null;
  }
  log(logger, "CHATGPT_XLSX_PREVIEW_DOWNLOAD_BUTTON_FOUND=true");

  let download = await clickDownloadAwaitingEvent(page, downloadButton, logger, false);
  if (!download) {
    download = await clickDownloadAwaitingEvent(page, downloadButton, logger, true);
  }
  if (!download) return null;

  const suggested = download.suggestedFilename?.() || expectedFilename;
  const saved = await saveAndVerifyDownload(download, finalOutputPath, logger);
  if (!saved) {
    logFailureStage(logger, "LOCAL_FILE_VALIDATION");
    return null;
  }
  return {
    outputPath: finalOutputPath,
    originalFilename: suggested,
    artifactStatus: "DOWNLOADED",
  };
}

export async function downloadFromSpreadsheetPreview(
  page: Page,
  expectedFilename: string,
  finalOutputPath: string,
  logger: Logger,
): Promise<PreviewDownloadResult | null> {
  const preview = await waitForSpreadsheetPreview(page, expectedFilename, logger);
  if (!preview) {
    log(logger, "CHATGPT_XLSX_PREVIEW_OPENED=false");
    return null;
  }
  return downloadFromOpenPreview(
    page,
    preview,
    expectedFilename,
    finalOutputPath,
    logger,
  );
}

export function previewOpenFailedError(filename: string): AutomationError {
  return new AutomationError(
    "CHATGPT_XLSX_PREVIEW_OPEN_FAILED",
    `CHATGPT_XLSX_PREVIEW_OPEN_FAILED: generated workbook ${filename} was detected but the spreadsheet preview did not open`,
  );
}

export function downloadFailedError(
  filename: string,
  stage: XlsxDownloadFailureStage,
): AutomationError {
  return new AutomationError(
    "CHATGPT_XLSX_DOWNLOAD_FAILED",
    `CHATGPT_XLSX_DOWNLOAD_FAILED: generated workbook ${filename} could not be saved locally (stage=${stage})`,
  );
}

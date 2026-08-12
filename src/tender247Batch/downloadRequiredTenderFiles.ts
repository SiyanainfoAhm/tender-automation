import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { Logger } from "../logger.js";
import { AutomationError } from "../browserUtils.js";
import { dismissTender247Interruptions } from "../tenderDetails/dismissTender247Interruptions.js";
import { clickAndSaveDownload, waitForAllActiveDownloads } from "../tenderDetails/downloadHelpers.js";
import { ensureDir } from "../fileUtils.js";
import { extensionFromFilename } from "../tenderDetails/tenderFolder.js";
import {
  consolidateAllDocumentsDuplicates,
  findExistingAllDocumentsFile,
  isValidArtifact,
  removeInvalidAllDocumentsArtifacts,
} from "./resumeArtifacts.js";

export interface RequiredDownloadResult {
  aiSummaryPath: string | null;
  allDocumentsPath: string | null;
  aiSummaryDownloaded: boolean;
  allDocumentsDownloaded: boolean;
  aiSummarySize: number;
  allDocumentsSize: number;
  aiSummarySkipped: boolean;
  allDocumentsSkipped: boolean;
}

/**
 * Batch downloads: AI Summary PDF (optional) + Download All Documents (once).
 * Skips steps when valid artifacts already exist. Uses canonical filenames only.
 */
export async function downloadRequiredTenderFiles(options: {
  detailPage: Page;
  context: BrowserContext;
  tenderFolder: string;
  t247Id: string;
  timeoutMs: number;
  maxRetries: number;
  logger: Logger;
  skipAiSummary?: boolean;
  skipAllDocuments?: boolean;
  keepDebugFiles?: boolean;
}): Promise<RequiredDownloadResult> {
  const {
    detailPage,
    context,
    tenderFolder,
    t247Id,
    timeoutMs,
    maxRetries,
    logger,
  } = options;

  ensureDir(tenderFolder);
  const documentsDir = path.join(tenderFolder, "documents");

  let aiSummaryDownloaded = false;
  let allDocumentsDownloaded = false;
  let aiSummarySkipped = false;
  let allDocumentsSkipped = false;
  let aiSummaryPath: string | null = null;
  let allDocumentsPath: string | null = null;
  let aiSummarySize = 0;
  let allDocumentsSize = 0;

  await dismissTender247Interruptions(detailPage, logger).catch((error) => {
    if (
      error instanceof AutomationError &&
      error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
    ) {
      throw error;
    }
  });

  // --- AI Summary PDF ---
  const aiCanonical = path.join(tenderFolder, "AI_Summary.pdf");
  if (options.skipAiSummary || isValidArtifact(aiCanonical)) {
    aiSummarySkipped = true;
    aiSummaryDownloaded = isValidArtifact(aiCanonical);
    aiSummaryPath = aiSummaryDownloaded ? aiCanonical : null;
    aiSummarySize = aiSummaryDownloaded ? fs.statSync(aiCanonical).size : 0;
    logger.info("AI_SUMMARY_ALREADY_PRESENT_SKIP");
  } else {
    logger.info("AI_SUMMARY_DOWNLOAD_START");
    const aiResult = await downloadAiSummaryOnce({
      detailPage,
      context,
      tenderFolder,
      timeoutMs,
      maxRetries,
      logger,
    });
    if (aiResult) {
      aiSummaryDownloaded = true;
      aiSummaryPath = aiResult.path;
      aiSummarySize = aiResult.size;
      logger.info("AI_SUMMARY_DOWNLOADED");
      logger.info(`AI_SUMMARY_FILE_SIZE=${aiSummarySize}`);
    } else {
      logger.info("AI_SUMMARY_NOT_AVAILABLE");
    }
  }

  // --- Download All Documents ---
  ensureDir(documentsDir);
  consolidateAllDocumentsDuplicates(
    documentsDir,
    Boolean(options.keepDebugFiles),
    logger,
  );
  const existingAll = findExistingAllDocumentsFile(documentsDir);

  if (options.skipAllDocuments || isValidArtifact(existingAll)) {
    allDocumentsSkipped = true;
    allDocumentsDownloaded = isValidArtifact(existingAll);
    allDocumentsPath = allDocumentsDownloaded ? existingAll : null;
    allDocumentsSize =
      allDocumentsDownloaded && existingAll
        ? fs.statSync(existingAll).size
        : 0;
    logger.info("ALL_DOCUMENTS_ALREADY_PRESENT_SKIP");
  } else {
    logger.info("DOWNLOAD_ALL_DOCUMENTS_START");
    const allResult = await downloadAllDocumentsOnce({
      detailPage,
      context,
      documentsDir,
      timeoutMs,
      maxRetries,
      logger,
    });
    if (allResult) {
      allDocumentsDownloaded = true;
      allDocumentsPath = allResult.path;
      allDocumentsSize = allResult.size;
      logger.info("ALL_DOCUMENTS_DOWNLOADED");
      logger.info(`ALL_DOCUMENTS_FILE_SIZE=${allDocumentsSize}`);
    } else {
      logger.warn(`DOWNLOAD_ALL_DOCUMENTS_FAILED for T247-${t247Id}`);
    }
  }

  await waitForAllActiveDownloads();

  return {
    aiSummaryPath,
    allDocumentsPath,
    aiSummaryDownloaded,
    allDocumentsDownloaded,
    aiSummarySize,
    allDocumentsSize,
    aiSummarySkipped,
    allDocumentsSkipped,
  };
}

async function downloadAiSummaryOnce(options: {
  detailPage: Page;
  context: BrowserContext;
  tenderFolder: string;
  timeoutMs: number;
  maxRetries: number;
  logger: Logger;
}): Promise<{ path: string; size: number } | null> {
  const { detailPage, context, tenderFolder, timeoutMs, maxRetries, logger } =
    options;
  const canonical = path.join(tenderFolder, "AI_Summary.pdf");

  const attempts = Math.max(1, maxRetries + 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const control = await findAiSummaryPdfControl(detailPage);
      if (!control) {
        return null;
      }

      const record = await clickAndSaveDownload({
        page: detailPage,
        context,
        clickTarget: async () => {
          await control.click({ timeout: 15_000 });
        },
        destinationDir: tenderFolder,
        preferredBaseName: "AI_Summary",
        preferredExtension: "pdf",
        canonicalFileName: "AI_Summary.pdf",
        timeoutMs,
        logger,
        kind: "ai_summary",
        linkText: "AI Summary PDF Download",
      });

      if (record.status === "success" && isValidArtifact(canonical)) {
        return { path: canonical, size: fs.statSync(canonical).size };
      }

      throw new Error(record.error || "AI Summary download failed");
    } catch (error) {
      if (
        error instanceof AutomationError &&
        error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
      ) {
        throw error;
      }
      logger.warn(
        `AI Summary attempt ${attempt}/${attempts}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await dismissTender247Interruptions(detailPage, logger).catch((err) => {
        if (
          err instanceof AutomationError &&
          err.code === "TENDER247_REMINDER_MODAL_BLOCKING"
        ) {
          throw err;
        }
      });
      if (attempt >= attempts) {
        return null;
      }
      await detailPage.waitForTimeout(1000 * attempt).catch(() => undefined);
    }
  }
  return null;
}

async function findAiSummaryPdfControl(page: Page) {
  const aiSection = page
    .locator("section, div, article, aside")
    .filter({ hasText: /AI\s*(Generated\s*)?Tender\s*Summary|AI\s*Summary/i })
    .first();

  if (await aiSection.isVisible().catch(() => false)) {
    // Expand if collapsed
    const header = aiSection
      .getByText(/AI\s*(Generated\s*)?Tender\s*Summary/i)
      .first();
    if (await header.isVisible().catch(() => false)) {
      await header.click({ timeout: 3_000 }).catch(() => undefined);
    }

    const scoped = aiSection
      .getByRole("link", { name: /PDF\s*Download|Download/i })
      .or(aiSection.getByRole("button", { name: /PDF\s*Download|Download/i }))
      .or(aiSection.getByText(/PDF\s*Download/i))
      .first();
    if (await scoped.isVisible().catch(() => false)) {
      return scoped;
    }
  }

  const combined = page
    .getByText(/AI\s*Summary\s*[-–—]?\s*PDF\s*Download/i)
    .or(
      page
        .locator("a, button")
        .filter({ hasText: /AI\s*Summary/i })
        .filter({ hasText: /PDF|Download/i }),
    )
    .first();

  if (await combined.isVisible().catch(() => false)) {
    return combined;
  }

  return null;
}

async function downloadAllDocumentsOnce(options: {
  detailPage: Page;
  context: BrowserContext;
  documentsDir: string;
  timeoutMs: number;
  maxRetries: number;
  logger: Logger;
}): Promise<{ path: string; size: number } | null> {
  const { detailPage, context, documentsDir, timeoutMs, maxRetries, logger } =
    options;

  await expandTenderDocumentsSection(detailPage, logger);
  ensureDir(documentsDir);

  const attempts = Math.max(1, maxRetries + 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      removeInvalidAllDocumentsArtifacts(documentsDir);
      // Re-check before each attempt — another process may have finished
      const existing = findExistingAllDocumentsFile(documentsDir);
      if (isValidArtifact(existing)) {
        return { path: existing!, size: fs.statSync(existing!).size };
      }

      const control = await findDownloadAllDocumentsControl(detailPage);
      if (!control) {
        throw new Error('Visible "Download All Documents" control not found');
      }

      // Detect extension from a prior suggested name after click via preferred zip canonical
      const canonicalName = "Tender_All_Documents.zip";
      const record = await clickAndSaveDownload({
        page: detailPage,
        context,
        clickTarget: async () => {
          await control.click({ timeout: 15_000 });
        },
        destinationDir: documentsDir,
        preferredBaseName: "Tender_All_Documents",
        preferredExtension: "zip",
        canonicalFileName: canonicalName,
        timeoutMs,
        logger,
        kind: "document",
        linkText: "Download All Documents",
      });

      if (record.status !== "success" || !record.finalFilename) {
        throw new Error(record.error || "Download All Documents failed");
      }

      // If Playwright suggested a non-zip archive, rename to matching canonical ext
      let canonicalPath = path.join(documentsDir, record.finalFilename);
      const suggestedExt = extensionFromFilename(record.originalFilename || "");
      if (
        suggestedExt &&
        suggestedExt.toLowerCase() !== "zip" &&
        suggestedExt.toLowerCase() !== "download"
      ) {
        const alt = path.join(
          documentsDir,
          `Tender_All_Documents.${suggestedExt}`,
        );
        if (
          path.resolve(canonicalPath) !== path.resolve(alt) &&
          isValidArtifact(canonicalPath)
        ) {
          if (fs.existsSync(alt) && !isValidArtifact(alt)) {
            fs.unlinkSync(alt);
          }
          if (!fs.existsSync(alt)) {
            fs.renameSync(canonicalPath, alt);
          }
          canonicalPath = alt;
        }
      }

      // Remove accidental Tender_All_Documents_* siblings
      for (const name of fs.readdirSync(documentsDir)) {
        if (
          name !== path.basename(canonicalPath) &&
          /^Tender_All_Documents/i.test(name)
        ) {
          const p = path.join(documentsDir, name);
          if (path.resolve(p) !== path.resolve(canonicalPath)) {
            fs.unlinkSync(p);
          }
        }
      }

      if (!isValidArtifact(canonicalPath)) {
        throw new Error("Download All Documents file empty after save");
      }
      return { path: canonicalPath, size: fs.statSync(canonicalPath).size };
    } catch (error) {
      if (
        error instanceof AutomationError &&
        error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
      ) {
        throw error;
      }
      logger.warn(
        `Download All Documents attempt ${attempt}/${attempts}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await dismissTender247Interruptions(detailPage, logger).catch((err) => {
        if (
          err instanceof AutomationError &&
          err.code === "TENDER247_REMINDER_MODAL_BLOCKING"
        ) {
          throw err;
        }
      });
      if (attempt >= attempts) {
        return null;
      }
      await detailPage.waitForTimeout(1000 * attempt).catch(() => undefined);
    }
  }
  return null;
}

async function findDownloadAllDocumentsControl(page: Page) {
  const section = page
    .locator("section, div, article")
    .filter({ hasText: /Tender\s*Documents/i })
    .filter({ hasText: /Download\s+All\s+Documents/i })
    .first();

  const scope = (await section.isVisible().catch(() => false)) ? section : page;

  const control = scope
    .getByRole("link", { name: /^Download\s+All\s+Documents$/i })
    .or(scope.getByRole("button", { name: /^Download\s+All\s+Documents$/i }))
    .or(scope.getByText(/^Download\s+All\s+Documents$/i))
    .first();

  if (await control.isVisible().catch(() => false)) {
    return control;
  }

  const any = page.getByText(/Download\s+All\s+Documents/i).first();
  if (await any.isVisible().catch(() => false)) {
    const clickable = any
      .locator('xpath=ancestor-or-self::a[1] | ancestor-or-self::button[1]')
      .first();
    if (await clickable.count().catch(() => 0)) {
      return clickable;
    }
    return any;
  }

  return null;
}

async function expandTenderDocumentsSection(
  page: Page,
  logger: Logger,
): Promise<void> {
  const header = page
    .getByRole("button", { name: /Tender\s*Documents/i })
    .or(page.getByRole("heading", { name: /Tender\s*Documents/i }))
    .or(page.getByText(/Tender\s*Documents/i))
    .first();

  if (!(await header.isVisible().catch(() => false))) {
    return;
  }

  const expanded = await header.getAttribute("aria-expanded").catch(() => null);
  if (expanded === "true") {
    return;
  }

  const allVisible = await page
    .getByText(/Download\s+All\s+Documents/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (allVisible) {
    return;
  }

  await header.click({ timeout: 5_000 }).catch(() => undefined);
  logger.info("Expanded Tender Documents section");
}

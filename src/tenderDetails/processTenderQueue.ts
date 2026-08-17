import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import { getLocalTimestamp } from "../dateUtils.js";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { safeErrorMessage } from "../logger.js";
import { dismissPageOverlays } from "./collectTenderLinks.js";
import { dismissTender247BlockingOverlays } from "./dismissPromotionalPopups.js";
import { downloadAiSummary } from "./downloadAiSummary.js";
import { downloadCorrigenda } from "./downloadCorrigenda.js";
import { downloadTenderDocuments } from "./downloadTenderDocuments.js";
import { waitForAllActiveDownloads } from "./downloadHelpers.js";
import {
  assertSameBrowserContext,
  ensureTender247DetailAuthenticated,
} from "./ensureTender247LoggedIn.js";
import { extractTenderMetadata } from "./extractTenderMetadata.js";
import { writeTenderMetadata } from "./metadataWriter.js";
import { openTenderDetailPage } from "./openTenderDetailPage.js";
import { createTenderFolder } from "./tenderFolder.js";
import type {
  DownloadStatus,
  ExtractionStatus,
  TenderListItem,
  TenderMetadata,
  TenderProcessResult,
} from "./types.js";

export interface ProcessQueueOptions {
  context: BrowserContext;
  /** Shared list page — used for eye/view popup opens on the same context */
  listPage?: Page;
  items: TenderListItem[];
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  /**
   * Optional already-opened detail pages keyed by T247 ID (single-tender fast path).
   * When present, openTenderDetailPage is skipped for that tender.
   */
  preOpenedPages?: Map<
    string,
    { page: Page; openedVia: string; closeOnFinish: boolean }
  >;
}

/**
 * Process tenders strictly one at a time. Each tender uses its own page.
 * Failures are isolated — remaining tenders continue.
 */
export async function processTenderQueue(
  options: ProcessQueueOptions,
): Promise<TenderProcessResult[]> {
  const { context, listPage, items, dateFolder, config, logger, preOpenedPages } =
    options;
  const results: TenderProcessResult[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    logger.info(
      `Worker 1 starting tender ${index + 1}/${items.length}: T247-${item.t247Id}`,
    );
    const result = await processTenderWithRetries({
      context,
      listPage,
      item,
      dateFolder,
      config,
      logger,
      preOpened: preOpenedPages?.get(item.t247Id),
    });
    results.push(result);
  }

  return results;
}

async function processTenderWithRetries(args: {
  context: BrowserContext;
  listPage?: Page;
  item: TenderListItem;
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  preOpened?: { page: Page; openedVia: string; closeOnFinish: boolean };
}): Promise<TenderProcessResult> {
  const { context, listPage, item, dateFolder, config, logger, preOpened } = args;
  const maxAttempts = Math.max(1, config.tenderDetailMaxRetries + 1);
  let lastResult: TenderProcessResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      logger.warn(
        `Retrying tender T247-${item.t247Id} (attempt ${attempt}/${maxAttempts})`,
      );
    }
    // Pre-opened page is only valid for the first attempt
    lastResult = await processOneTender({
      context,
      listPage,
      item,
      dateFolder,
      config,
      logger,
      preOpened: attempt === 1 ? preOpened : undefined,
    });
    if (lastResult.status !== "failed") {
      return lastResult;
    }
  }

  return (
    lastResult ?? {
      t247Id: item.t247Id,
      detailUrl: item.detailUrl,
      folderPath: "",
      status: "failed",
      documentsDownloaded: 0,
      corrigendaDownloaded: 0,
      bytesDownloaded: 0,
      error: "No attempts completed",
      durationMs: 0,
    }
  );
}

async function processOneTender(args: {
  context: BrowserContext;
  listPage?: Page;
  item: TenderListItem;
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  preOpened?: { page: Page; openedVia: string; closeOnFinish: boolean };
}): Promise<TenderProcessResult> {
  const { context, listPage, item, dateFolder, config, logger, preOpened } = args;
  const started = Date.now();
  const folder = createTenderFolder(dateFolder, item.t247Id);
  let page: Page | undefined;
  let closeOnFinish = true;

  const metadata: TenderMetadata = {
    crawlStartedAt: new Date().toISOString(),
    crawlCompletedAt: null,
    source: "tender247",
    sourceUrl: item.detailUrl,
    t247Id: item.t247Id,
    listTitle: item.listTitle,
    listClosingDate: item.listClosingDate,
    extracted: {
      t247Id: item.t247Id,
      referenceNumber: null,
      tenderName: null,
      brief: null,
      description: null,
      organisation: null,
      department: null,
      location: null,
      submissionDate: null,
      openingDate: null,
      estimatedCost: null,
      emd: null,
      documentFees: null,
      category: null,
      completionPeriod: null,
      advisoryBank: null,
      emdInstrumentType: null,
      preBidMeeting: null,
      clarificationDate: null,
      detailUrl: item.detailUrl,
      extraFields: {},
    },
    aiSummary: {
      documentRequiredFromSeller: null,
      eligibilityCriteria: null,
      minimumTurnover: null,
      pastExperience: null,
      similarCategory: null,
      contractPeriod: null,
      extraFields: {},
      available: false,
    },
    documents: [],
    corrigenda: [],
    aiSummaryPdf: null,
    warnings: [],
    extractionStatus: "failed",
    downloadStatus: "none",
  };

  try {
    logger.info(`Tender starting: T247-${item.t247Id}`);

    if (preOpened?.page && !preOpened.page.isClosed()) {
      page = preOpened.page;
      closeOnFinish = preOpened.closeOnFinish;
      assertSameBrowserContext(page, context, logger, `T247-${item.t247Id}`);
      logger.info(
        `Detail page belongs to shared BrowserContext: true (via=${preOpened.openedVia})`,
      );
    } else {
      const opened = await openTenderDetailPage({
        context,
        listPage,
        item,
        pageTimeoutMs: config.pageTimeoutMs,
        logger,
      });
      page = opened.page;
      closeOnFinish = opened.openedVia !== "same_context_navigation" || true;
      // Always close dedicated detail pages; same_tab is handled via closeOnFinish from caller
      assertSameBrowserContext(page, context, logger, `T247-${item.t247Id}`);
      logger.info(
        `Detail page belongs to shared BrowserContext: true (via=${opened.openedVia})`,
      );
    }

    await dismissTender247BlockingOverlays(page, logger);
    await dismissPageOverlays(page, logger);
    await ensureTender247DetailAuthenticated(page, context, logger, config);
    logger.info(`Detail page opened: T247-${item.t247Id} url=${page.url()}`);

    await ensureTender247DetailAuthenticated(page, context, logger, config);
    const { extracted, aiSummary, warnings } = await extractTenderMetadata(
      page,
      logger,
      item.t247Id,
    );
    metadata.extracted = extracted;
    metadata.aiSummary = aiSummary;
    metadata.warnings.push(...warnings);
    metadata.extractionStatus = deriveExtractionStatus(extracted, warnings);
    logger.info(
      `Metadata extracted for T247-${item.t247Id} status=${metadata.extractionStatus}`,
    );

    await ensureTender247DetailAuthenticated(page, context, logger, config);
    metadata.documents = await downloadTenderDocuments({
      page,
      context,
      documentsDir: folder.documents,
      timeoutMs: config.downloadTimeoutMs,
      downloadAllToo: config.downloadAllDocumentsToo,
      logger,
    });

    await ensureTender247DetailAuthenticated(page, context, logger, config);
    metadata.corrigenda = await downloadCorrigenda({
      page,
      context,
      corrigendaDir: folder.corrigenda,
      timeoutMs: config.downloadTimeoutMs,
      logger,
    });

    metadata.aiSummaryPdf = await downloadAiSummary({
      page,
      context,
      destinationDir: folder.root,
      timeoutMs: config.downloadTimeoutMs,
      logger,
    });

    metadata.downloadStatus = deriveDownloadStatus(metadata);
    metadata.crawlCompletedAt = new Date().toISOString();

    const docsOk = metadata.documents.filter((d) => d.status === "success").length;
    const corrOk = metadata.corrigenda.filter((d) => d.status === "success").length;
    const bytes =
      sumBytes(metadata.documents) +
      sumBytes(metadata.corrigenda) +
      (metadata.aiSummaryPdf?.status === "success"
        ? metadata.aiSummaryPdf.sizeBytes
        : 0);

    const status = deriveTenderStatus(metadata);
    if (status === "partial") {
      logger.warn(`Tender partial failure: T247-${item.t247Id}`);
      metadata.warnings.push("One or more downloads or fields incomplete");
    } else {
      logger.info(`Tender completion: T247-${item.t247Id} status=${status}`);
    }

    await writeTenderMetadata(folder.metadataPath, metadata, logger);

    return {
      t247Id: item.t247Id,
      detailUrl: page.url() || item.detailUrl,
      folderPath: folder.root,
      status,
      documentsDownloaded: docsOk,
      corrigendaDownloaded: corrOk,
      bytesDownloaded: bytes,
      metadataPath: folder.metadataPath,
      durationMs: Date.now() - started,
      error: status === "failed" ? metadata.error : undefined,
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    logger.error(`Tender failed: T247-${item.t247Id} — ${message}`);
    metadata.error = message;
    metadata.extractionStatus = "failed";
    metadata.downloadStatus = "failed";
    metadata.crawlCompletedAt = new Date().toISOString();
    metadata.warnings.push(message);

    if (page && !page.isClosed()) {
      await captureTenderScreenshot(page, folder.screenshots, item.t247Id, logger);
    }

    try {
      await writeTenderMetadata(folder.metadataPath, metadata, logger);
    } catch {
      // ignore secondary write failures
    }

    return {
      t247Id: item.t247Id,
      detailUrl: item.detailUrl,
      folderPath: folder.root,
      status: "failed",
      documentsDownloaded: metadata.documents.filter((d) => d.status === "success")
        .length,
      corrigendaDownloaded: metadata.corrigenda.filter((d) => d.status === "success")
        .length,
      bytesDownloaded:
        sumBytes(metadata.documents) + sumBytes(metadata.corrigenda),
      error: message,
      metadataPath: folder.metadataPath,
      durationMs: Date.now() - started,
    };
  } finally {
    await waitForAllActiveDownloads().catch(() => undefined);
    if (closeOnFinish && page && !page.isClosed()) {
      await page.close().catch(() => undefined);
    }
  }
}

async function captureTenderScreenshot(
  page: Page,
  screenshotsDir: string,
  t247Id: string,
  logger: Logger,
): Promise<void> {
  ensureDir(screenshotsDir);
  const filePath = path.join(
    screenshotsDir,
    `T247-${t247Id}_ERROR_${getLocalTimestamp()}.png`,
  );
  try {
    await page.screenshot({ path: filePath, fullPage: true });
    logger.info(`Screenshot saved: ${path.relative(process.cwd(), filePath)}`);
  } catch (error) {
    logger.warn(`Screenshot failed: ${safeErrorMessage(error)}`);
  }
}

function deriveExtractionStatus(
  extracted: TenderMetadata["extracted"],
  warnings: string[],
): ExtractionStatus {
  if (extracted.tenderName || extracted.brief || extracted.referenceNumber) {
    return warnings.length > 0 ? "partial" : "success";
  }
  return "failed";
}

function deriveDownloadStatus(metadata: TenderMetadata): DownloadStatus {
  const docs = metadata.documents;
  const corrs = metadata.corrigenda;
  if (docs.length === 0 && corrs.length === 0) {
    return "none";
  }
  const all = [...docs, ...corrs];
  const success = all.filter((d) => d.status === "success").length;
  const failed = all.filter((d) => d.status === "failed").length;
  if (success > 0 && failed === 0) {
    return "success";
  }
  if (success > 0 && failed > 0) {
    return "partial";
  }
  if (failed > 0) {
    return "failed";
  }
  return "none";
}

function deriveTenderStatus(
  metadata: TenderMetadata,
): "success" | "partial" | "failed" {
  if (metadata.extractionStatus === "failed" && metadata.downloadStatus === "failed") {
    return "failed";
  }
  if (
    metadata.extractionStatus === "success" &&
    (metadata.downloadStatus === "success" || metadata.downloadStatus === "none")
  ) {
    return "success";
  }
  if (metadata.extractionStatus === "failed" && metadata.downloadStatus === "none") {
    return "failed";
  }
  if (
    metadata.extractionStatus === "partial" ||
    metadata.downloadStatus === "partial" ||
    metadata.downloadStatus === "failed"
  ) {
    return "partial";
  }
  return "success";
}

function sumBytes(
  records: Array<{ status: string; sizeBytes: number }>,
): number {
  return records
    .filter((r) => r.status === "success")
    .reduce((sum, r) => sum + r.sizeBytes, 0);
}

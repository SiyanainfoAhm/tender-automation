import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { AutomationError } from "../browserUtils.js";
import { dismissTender247Interruptions } from "../tenderDetails/dismissTender247Interruptions.js";
import { dismissTender247BlockingOverlays } from "../tenderDetails/dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "../tenderDetails/dismissSupportChat.js";
import { sanitizeFileName, sanitizeT247Id } from "../tenderDetails/tenderFolder.js";
import {
  buildDetailPageUrl,
  postJson,
  tenderDetailUrl,
} from "./apiClient.js";
import { createTenderZip, removeDirectoryRecursive } from "./createTenderZip.js";
import { ensureCanonicalTenderArchive } from "./canonicalTenderArchive.js";
import { downloadRequiredTenderFiles } from "./downloadRequiredTenderFiles.js";
import {
  ensureTender247DateScopedDir,
  getActiveTender247RunContext,
  requestedDateFromDateFolder,
} from "./tender247RunContext.js";
import {
  extractCompleteTenderMetadata,
  type CompleteTenderMetadata,
} from "./extractCompleteMetadata.js";
import { findVisibleLiveTenderCards } from "./liveListCards.js";
import { openTenderFromLiveCard } from "./openTenderFromCard.js";
import { resolveTender247Tender } from "./resolveTender247Tender.js";
import {
  consolidateAllDocumentsDuplicates,
  inspectTenderResumeState,
  isValidArtifact,
  writeMetadataSyncMarker,
} from "./resumeArtifacts.js";
import { waitForAllActiveDownloads } from "../tenderDetails/downloadHelpers.js";
import {
  fetchTender247Metadata,
  upsertTender247Metadata,
} from "../supabase/tenderMetadataStore.js";
import {
  buildTender247PrescreenInput,
  runAndPersistPrescreen,
} from "../prescreen/runPrescreen.js";
import { loadPrescreenConfig } from "../prescreen/prescreenConfig.js";
import type { Tender247ItRelevanceResult } from "../prescreen/tender247ItRelevanceClassifier.js";
import { evaluateTender247ItRelevanceFromMetadata } from "./tender247ItRelevanceGate.js";
import type {
  ArtifactStepStatus,
  ProcessTenderResult,
} from "./types.js";

const METADATA_EXTRACTION_TIMEOUT_MS = 30_000;

export interface ProcessLiveTenderOptions {
  listPage: Page;
  context: BrowserContext;
  t247Id: string;
  index: number;
  total: number;
  dateFolder: string;
  config: AppConfig;
  logger: Logger;
  titleHint?: string | null;
  excelTenderValue?: number | null;
  excelEmd?: number | null;
  /**
   * When the live Fresh card is not visible, open detail via this captured
   * security_code (never invent — must come from Tender247 API/UI).
   */
  securityCodeOverride?: string | null;
  /**
   * Use production single-tender direct open (same as crawl:tender247:one).
   * Preferred for kept-pipeline — no search-tender API.
   */
  openViaSingleTenderDirect?: boolean;
}

/**
 * Canonical per-tender processor with two-level resume:
 * A) skip if final ZIP valid
 * B) resume missing steps from partial folder
 */
export async function processLiveTender(
  options: ProcessLiveTenderOptions,
): Promise<ProcessTenderResult> {
  const { listPage, context, index, total, dateFolder, config, logger } =
    options;
  const t247Id = sanitizeT247Id(options.t247Id);

  let detailPage: Page | null = null;
  let hardError: string | null = null;
  let securityCodeCaptured = false;
  let lastCompletedStep: string | null = null;

  let metadataStatus: ArtifactStepStatus = "missing";
  let aiSummaryStatus: ArtifactStepStatus = "missing";
  let allDocumentsStatus: ArtifactStepStatus = "missing";
  let metadataPath: string | null = null;
  let aiSummaryPath: string | null = null;
  let allDocumentsPath: string | null = null;
  let zipPath: string | null = null;
  let zipSize = 0;
  let lastItGate: Tender247ItRelevanceResult | null = null;

  logger.info(`[${index}/${total}] START T247-${t247Id}`);

  // -------- LEVEL A: completed ZIP --------
  let resume = inspectTenderResumeState(dateFolder, t247Id);
  if (resume.finalZipValid) {
    logger.info(`TENDER247_ALREADY_COMPLETED_SKIP=T247-${t247Id}`);
    return {
      t247Id,
      status: "completed",
      zipPath: resume.zipPath,
      zipSize: fs.statSync(resume.zipPath).size,
      documentsDownloaded: 1,
      corrigendaDownloaded: 0,
      aiSummaryDownloaded: resume.aiSummaryValid,
      allDocumentsDownloaded: true,
      securityCodeCaptured: true,
      metadataStatus: "complete",
      aiSummaryStatus: resume.aiSummaryValid ? "complete" : "unavailable",
      allDocumentsStatus: "complete",
      metadataPath: resume.metadataValid ? resume.metadataPath : null,
      aiSummaryPath: resume.aiSummaryPath,
      allDocumentsPath: resume.allDocumentsPath,
      lastCompletedStep: "zip",
      error: null,
      failedDocuments: [],
    };
  }

  // -------- LEVEL B: partial folder resume without opening if already complete enough --------
  if (resume.folderExists) {
    logger.info(`TENDER247_PARTIAL_FOLDER_RESUME=T247-${t247Id}`);
    consolidateAllDocumentsDuplicates(
      path.join(resume.tenderFolder, "documents"),
      config.keepDebugFiles,
      logger,
    );
    resume = inspectTenderResumeState(dateFolder, t247Id);

    if (resume.metadataValid) {
      logger.info("METADATA_ALREADY_PRESENT_SKIP");
      metadataStatus = "complete";
      metadataPath = resume.metadataPath;
      lastCompletedStep = "metadata";
    }
    if (resume.aiSummaryValid) {
      logger.info("AI_SUMMARY_ALREADY_PRESENT_SKIP");
      aiSummaryStatus = "complete";
      aiSummaryPath = resume.aiSummaryPath;
      lastCompletedStep = "ai_summary";
    }
    if (resume.allDocumentsValid) {
      logger.info("ALL_DOCUMENTS_ALREADY_PRESENT_SKIP");
      allDocumentsStatus = "complete";
      allDocumentsPath = resume.allDocumentsPath;
      lastCompletedStep = "all_documents";
    }

    // ZIP repair / create from existing folder — do not reopen Tender247
    if (resume.metadataValid && resume.allDocumentsValid) {
      try {
        const existingMeta = await loadOrCreateMinimumMetadata({
          metadataPath: resume.metadataPath,
          tenderFolder: resume.tenderFolder,
          t247Id,
          detailUrl: "",
          titleHint: options.titleHint ?? null,
          securityCodeCaptured: true,
          logger,
        });
        const gate = applyItRelevanceGate({
          metadata: existingMeta,
          t247Id,
          logger,
        });
        if (gate.relevance !== "IT_RELEVANT") {
          removeDirectoryRecursive(resume.tenderFolder);
          if (fs.existsSync(resume.zipPath)) {
            try {
              fs.unlinkSync(resume.zipPath);
            } catch {
              // ignore
            }
          }
          return buildGateDropResult({
            t247Id,
            gate,
            title:
              String(existingMeta.normalized?.tenderName ?? options.titleHint ?? "") ||
              null,
            securityCodeCaptured: true,
          });
        }

        if (
          fs.existsSync(resume.zipPath) &&
          fs.statSync(resume.zipPath).size <= 0
        ) {
          fs.unlinkSync(resume.zipPath);
          logger.info(`Removed 0-byte ZIP T247-${t247Id}.zip`);
        }
        logger.info("TENDER_ZIP_REPAIR_FROM_EXISTING_FOLDER");
        logger.info("ZIP_CREATE_FROM_EXISTING_FOLDER");
        const zipResult = await createTenderZip({
          tenderFolderPath: resume.tenderFolder,
          zipPath: resume.zipPath,
          t247Id,
          logger,
        });
        zipPath = zipResult.zipPath;
        zipSize = zipResult.sizeBytes;
        lastCompletedStep = "zip";
        if (!config.keepUnzippedTenderFolders) {
          removeDirectoryRecursive(resume.tenderFolder);
        }
        const completedOk =
          isValidArtifact(resume.metadataPath) &&
          isValidArtifact(resume.allDocumentsPath) &&
          isValidArtifact(zipPath);
        return buildResult({
          t247Id,
          status: completedOk ? "completed" : "partial",
          zipPath: completedOk ? zipPath : null,
          zipSize: completedOk ? zipSize : 0,
          aiSummaryDownloaded: resume.aiSummaryValid,
          allDocumentsDownloaded: true,
          securityCodeCaptured: true,
          metadataStatus: "complete",
          aiSummaryStatus: resume.aiSummaryValid ? "complete" : "unavailable",
          allDocumentsStatus: "complete",
          metadataPath: resume.metadataPath,
          aiSummaryPath: resume.aiSummaryPath,
          allDocumentsPath: resume.allDocumentsPath,
          lastCompletedStep,
          error: completedOk ? null : "Completion validation failed after ZIP repair",
          itRelevance: gate,
        });
      } catch (error) {
        hardError = error instanceof Error ? error.message : String(error);
        logger.warn(`ZIP from existing folder failed: ${hardError}`);
        return buildResult({
          t247Id,
          status: "partial",
          zipPath: null,
          zipSize: 0,
          aiSummaryDownloaded: resume.aiSummaryValid,
          allDocumentsDownloaded: true,
          securityCodeCaptured: true,
          metadataStatus: "complete",
          aiSummaryStatus: resume.aiSummaryValid ? "complete" : "unavailable",
          allDocumentsStatus: "complete",
          metadataPath: resume.metadataPath,
          aiSummaryPath: resume.aiSummaryPath,
          allDocumentsPath: resume.allDocumentsPath,
          lastCompletedStep: "all_documents",
          error: hardError,
        });
      }
    }
  }

  // Need live detail page for missing steps
  try {
    await listPage.bringToFront().catch(() => undefined);
    await dismissForTenderPage(listPage, logger, config);

    let securityCode: string | null = null;
    let titleHint = options.titleHint ?? null;
    let card: Awaited<ReturnType<typeof findVisibleLiveTenderCards>>[number] | undefined;

    if (options.openViaSingleTenderDirect) {
      const resolved = await resolveTender247Tender({
        listPage,
        context,
        tenderId: t247Id,
        config,
        logger,
      });
      detailPage = resolved.detailPage;
      titleHint = options.titleHint ?? resolved.item.listTitle;
      const fromUrl = detailPage.url().match(
        /\/auth\/tender\/\d+\/([0-9a-f-]{8,})/i,
      );
      if (fromUrl?.[1]) {
        securityCode = fromUrl[1];
        securityCodeCaptured = true;
        logger.info("SECURITY_CODE_CAPTURED");
      }
    } else {
      const cards = await findVisibleLiveTenderCards(listPage, logger);
      card = cards.find((c) => c.t247Id === t247Id);
      if (card) {
        const opened = await openTenderFromLiveCard(
          listPage,
          context,
          card,
          config,
          logger,
        );
        detailPage = opened.detailPage;
        securityCodeCaptured = opened.securityCodeCaptured;
        securityCode = opened.securityCode;
        titleHint = options.titleHint ?? card.titleHint;
        if (!detailPage || detailPage.isClosed()) {
          throw new Error(`Detail tab failed to open for T247-${t247Id}`);
        }
      } else if (options.securityCodeOverride?.trim()) {
        securityCode = options.securityCodeOverride.trim();
        const url = buildDetailPageUrl(t247Id, securityCode, null);
        logger.info(`TENDER247_OPEN_DETAIL_BY_SECURITY_CODE=T247-${t247Id}`);
        detailPage = await context.newPage();
        await detailPage.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: config.pageTimeoutMs,
        });
        await detailPage
          .waitForLoadState("networkidle", {
            timeout: Math.min(config.pageTimeoutMs, 20_000),
          })
          .catch(() => undefined);
        await dismissForTenderPage(detailPage, logger, config);
        securityCodeCaptured = true;
        logger.info("SECURITY_CODE_CAPTURED");
      } else {
        throw new Error(
          `Live tender row for T247-${t247Id} not found in currently rendered list`,
        );
      }
    }

    if (!detailPage || detailPage.isClosed()) {
      throw new Error(`Detail tab failed to open for T247-${t247Id}`);
    }

    // Create lean folder only when processing starts
    ensureDir(resume.tenderFolder);
    metadataPath = resume.metadataPath;

    if (!securityCode) {
      const fromUrl = detailPage.url().match(
        /\/auth\/tender\/\d+\/([0-9a-f-]{8,})/i,
      );
      if (fromUrl?.[1]) {
        securityCode = fromUrl[1];
        securityCodeCaptured = true;
        logger.info("SECURITY_CODE_CAPTURED");
      }
    } else if (card && !options.openViaSingleTenderDirect) {
      logger.info("SECURITY_CODE_CAPTURED");
    }

    const portalUrl = securityCode
      ? buildDetailPageUrl(t247Id, securityCode, null)
      : detailPage.url();

    // Minimum metadata first (in-memory / Supabase / legacy — never permanent metadata.json)
    let metadata: CompleteTenderMetadata = await loadOrCreateMinimumMetadata({
      metadataPath: resume.metadataPath,
      tenderFolder: resume.tenderFolder,
      t247Id,
      detailUrl: portalUrl,
      titleHint,
      securityCodeCaptured,
      logger,
    });
    metadataStatus =
      metadata.metadataExtractionStatus === "complete" ? "complete" : "partial";
    lastCompletedStep = "metadata_min";

    // Optional API enrichment (Playwright request context carries browser cookies)
    let detailRow: Record<string, unknown> = {};
    if (securityCode) {
      try {
        const detailEnvelope = await postJson<unknown[]>(
          context.request,
          tenderDetailUrl(t247Id),
          { guest_user_id: 0, security_code: securityCode, ip: "" },
          logger,
        );
        if (Array.isArray(detailEnvelope.Data) && detailEnvelope.Data[0]) {
          detailRow = detailEnvelope.Data[0] as Record<string, unknown>;
        }
      } catch (error) {
        logger.warn(
          `Detail API failed (continuing): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await detailPage.bringToFront().catch(() => undefined);
    await dismissForTenderPage(detailPage, logger, config);

    // ---- METADATA extraction (in-memory; no Supabase until docs + IT gate) ----
    if (!resume.metadataValid) {
      try {
        const extracted = await extractCompleteTenderMetadata({
          detailPage,
          t247Id,
          detailUrl: portalUrl,
          titleHint,
          apiDetailRow: detailRow,
          logger,
          deadlineMs: Date.now() + METADATA_EXTRACTION_TIMEOUT_MS,
        });
        if (!config.keepDebugFiles) {
          delete extracted.apiDetail;
        }
        metadata = {
          ...extracted,
          securityCodeCaptured,
          status: "processing",
          metadataExtractionStatus: "complete",
          metadataExtractionError: null,
        };
        metadataStatus = "complete";
        metadataPath = null;
        lastCompletedStep = "metadata";
        logger.info("METADATA_EXTRACTED_IN_MEMORY");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("METADATA_EXTRACTION_PARTIAL");
        logger.warn(`METADATA_EXTRACTION_ERROR=${message}`);
        metadata.metadataExtractionStatus = "partial";
        metadata.metadataExtractionError = message;
        metadata.processedAt = new Date().toISOString();
        metadataStatus = "partial";
        metadataPath = null;
        lastCompletedStep = "metadata_partial";
      }
    } else {
      logger.info("METADATA_ALREADY_PRESENT_SKIP");
      metadataStatus = "complete";
      metadataPath = null;
    }

    // Preserve Excel financial survivors when detail lacks authoritative amounts
    applyExcelFinancialsToMetadata(metadata, {
      excelTenderValue: options.excelTenderValue,
      excelEmd: options.excelEmd,
      logger,
    });

    // ---- IT relevance gate (BEFORE documents / Supabase / ChatGPT) ----
    const itGate = applyItRelevanceGate({
      metadata,
      t247Id,
      logger,
    });
    lastItGate = itGate;
    if (itGate.relevance !== "IT_RELEVANT") {
      removeDirectoryRecursive(resume.tenderFolder);
      return buildGateDropResult({
        t247Id,
        gate: itGate,
        title:
          String(metadata.normalized?.tenderName ?? titleHint ?? "") ||
          null,
        securityCodeCaptured,
      });
    }

    // ---- DOWNLOADS first (IT_RELEVANT only) — then Supabase ----
    logger.info(`TENDER247_DOCUMENT_DOWNLOAD_START=T247-${t247Id}`);
    try {
      const downloads = await downloadRequiredTenderFiles({
        detailPage,
        context,
        tenderFolder: resume.tenderFolder,
        t247Id,
        timeoutMs: config.downloadTimeoutMs,
        maxRetries: config.documentDownloadMaxRetries,
        logger,
        skipAiSummary: resume.aiSummaryValid,
        skipAllDocuments: resume.allDocumentsValid,
        keepDebugFiles: config.keepDebugFiles,
      });

      aiSummaryPath = downloads.aiSummaryPath;
      allDocumentsPath = downloads.allDocumentsPath;

      if (downloads.aiSummaryDownloaded) {
        aiSummaryStatus = "complete";
      } else if (downloads.aiSummarySkipped && !resume.aiSummaryValid) {
        aiSummaryStatus = "unavailable";
      } else if (!downloads.aiSummaryDownloaded) {
        aiSummaryStatus = resume.aiSummaryValid ? "complete" : "unavailable";
      }

      logger.info(
        `TENDER247_AI_SUMMARY_AVAILABLE=${aiSummaryStatus === "complete"}`,
      );

      if (downloads.allDocumentsDownloaded) {
        allDocumentsStatus = "complete";
        lastCompletedStep = "all_documents";
      } else {
        allDocumentsStatus = "failed";
        hardError = `Download All Documents failed for T247-${t247Id}`;
      }

      // Refresh resume after downloads
      resume = inspectTenderResumeState(dateFolder, t247Id);
      if (resume.aiSummaryValid) {
        aiSummaryStatus = "complete";
        aiSummaryPath = resume.aiSummaryPath;
      }
      if (resume.allDocumentsValid) {
        allDocumentsStatus = "complete";
        allDocumentsPath = resume.allDocumentsPath;
      }

      if (allDocumentsStatus === "complete" && allDocumentsPath) {
        logger.info(`TENDER247_DOCUMENT_ARCHIVE_DOWNLOAD_START=T247-${t247Id}`);
        logger.info(
          `TENDER247_DOCUMENT_ARCHIVE_DOWNLOADED=${allDocumentsPath}`,
        );
        logger.info("TENDER247_DOCUMENT_ARCHIVE_VALID=true");
        const canonical = await ensureCanonicalTenderArchive({
          tenderDir: resume.tenderFolder,
          documentsDir: path.join(resume.tenderFolder, "documents"),
          sourceTenderId: t247Id,
          logger,
        });
        if (canonical.ready && canonical.canonicalZipPath) {
          allDocumentsPath = canonical.canonicalZipPath;
        }
      } else {
        logger.warn(`TENDER247_DOCUMENT_DOWNLOAD_FAILED=T247-${t247Id}`);
      }

      metadata.downloads = {
        aiSummaryDownloaded: aiSummaryStatus === "complete",
        allDocumentsDownloaded: allDocumentsStatus === "complete",
        aiSummaryFile: aiSummaryPath ? path.basename(aiSummaryPath) : null,
        allDocumentsFile: allDocumentsPath
          ? path.relative(resume.tenderFolder, allDocumentsPath).replace(/\\/g, "/")
          : null,
      };
      metadata.processedAt = new Date().toISOString();

      // Persist only after documents succeed (IT_RELEVANT path)
      if (allDocumentsStatus === "complete") {
        await persistTender247Metadata({
          metadata,
          tenderFolder: resume.tenderFolder,
          logger,
        });
        metadataPath = null;
        logger.info("METADATA_SAVED");
      } else {
        logger.info("SUPABASE_WRITE_SKIPPED=true");
        logger.info("CHATGPT_SKIPPED=true");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Downloads step error (continuing): ${message}`);
      logger.warn(`TENDER247_DOCUMENT_DOWNLOAD_FAILED=T247-${t247Id}`);
      hardError = hardError || message;
      if (allDocumentsStatus !== "complete") {
        allDocumentsStatus = "failed";
      }
    }
  } catch (error) {
    hardError = error instanceof Error ? error.message : String(error);
    logger.warn(`Tender T247-${t247Id} failed: ${hardError}`);
  } finally {
    // Finish any in-flight Playwright saves before closing the detail tab
    await waitForAllActiveDownloads().catch(() => undefined);
    try {
      if (detailPage && !detailPage.isClosed()) {
        await detailPage.close({ runBeforeUnload: false });
        logger.info(`DETAIL_TAB_CLOSED T247-${t247Id}`);
      }
    } catch {
      // ignore
    }
    detailPage = null;
    for (const p of context.pages()) {
      if (p !== listPage && !p.isClosed()) {
        await p.close({ runBeforeUnload: false }).catch(() => undefined);
      }
    }
    if (!listPage.isClosed()) {
      await listPage.bringToFront().catch(() => undefined);
    }
  }

  // ---- ZIP from folder if required files exist ----
  await waitForAllActiveDownloads().catch(() => undefined);
  resume = inspectTenderResumeState(dateFolder, t247Id);
  try {
    if (resume.metadataValid && resume.allDocumentsValid) {
      if (
        fs.existsSync(resume.zipPath) &&
        fs.statSync(resume.zipPath).size <= 0
      ) {
        fs.unlinkSync(resume.zipPath);
      }
      logger.info(
        resume.folderExists
          ? "TENDER_ZIP_REPAIR_FROM_EXISTING_FOLDER"
          : "ZIP_CREATE_FROM_EXISTING_FOLDER",
      );
      if (resume.folderExists) {
        logger.info("ZIP_CREATE_FROM_EXISTING_FOLDER");
      }
      const zipResult = await createTenderZip({
        tenderFolderPath: resume.tenderFolder,
        zipPath: resume.zipPath,
        t247Id,
        logger,
      });
      zipPath = zipResult.zipPath;
      zipSize = zipResult.sizeBytes;
      lastCompletedStep = "zip";
      if (!config.keepUnzippedTenderFolders) {
        removeDirectoryRecursive(resume.tenderFolder);
      }
    } else if (!hardError && !resume.allDocumentsValid) {
      hardError = `Required Download All Documents missing for T247-${t247Id}`;
    }
  } catch (error) {
    hardError = error instanceof Error ? error.message : String(error);
    logger.warn(`ZIP failed for T247-${t247Id}: ${hardError}`);
    zipPath = null;
    zipSize = 0;
  }

  // Cleanup empty folder
  if (
    resume.folderExists &&
    fs.existsSync(resume.tenderFolder) &&
    !folderHasUsefulContent(resume.tenderFolder) &&
    !isValidArtifact(zipPath)
  ) {
    removeDirectoryRecursive(resume.tenderFolder);
    logger.info(`Removed empty tender folder T247-${t247Id}/`);
  }

  resume = inspectTenderResumeState(dateFolder, t247Id);
  const metadataOk = isValidArtifact(resume.metadataPath) || isValidArtifact(metadataPath);
  const allDocsOk =
    isValidArtifact(resume.allDocumentsPath) ||
    isValidArtifact(allDocumentsPath) ||
    allDocumentsStatus === "complete";
  const zipOk = isValidArtifact(zipPath) || isValidArtifact(resume.zipPath);
  if (zipOk) {
    const resolvedZip = isValidArtifact(zipPath) ? zipPath! : resume.zipPath;
    zipPath = resolvedZip;
    zipSize = fs.statSync(resolvedZip).size;
  }

  const status =
    metadataOk && allDocsOk && zipOk
      ? "completed"
      : zipOk || metadataOk || allDocsOk
        ? "partial"
        : "failed";

  if (status === "completed") {
    metadataStatus = "complete";
    allDocumentsStatus = "complete";
  }

  logger.info(`[${index}/${total}] COMPLETE status=${status}`);

  return buildResult({
    t247Id,
    status,
    zipPath: zipOk ? zipPath : null,
    zipSize: zipOk ? zipSize : 0,
    aiSummaryDownloaded: aiSummaryStatus === "complete",
    allDocumentsDownloaded: allDocsOk,
    securityCodeCaptured,
    metadataStatus,
    aiSummaryStatus,
    allDocumentsStatus: allDocsOk ? "complete" : allDocumentsStatus,
    metadataPath: metadataPath || resume.metadataPath,
    aiSummaryPath,
    allDocumentsPath: allDocumentsPath || resume.allDocumentsPath,
    lastCompletedStep,
    error: status === "completed" ? null : hardError,
    itRelevance: lastItGate,
  });
}

function applyExcelFinancialsToMetadata(
  metadata: CompleteTenderMetadata,
  options: {
    excelTenderValue?: number | null;
    excelEmd?: number | null;
    logger: Logger;
  },
): void {
  metadata.normalized = metadata.normalized || {};
  metadata.raw = metadata.raw || {};

  const unavailable = (text: unknown): boolean => {
    if (text === null || text === undefined) return true;
    const s = String(text).trim().toLowerCase();
    if (!s) return true;
    return /refer\s+documents?|not\s+disclosed|n\/?a|unavailable|nil/.test(s);
  };

  const excelValue = options.excelTenderValue;
  if (typeof excelValue === "number" && Number.isFinite(excelValue)) {
    const current = metadata.normalized.tenderValue;
    const rawCost = metadata.raw["Tender Estimated Cost"];
    const currentMissing =
      current === null ||
      current === undefined ||
      (typeof current === "number" && !Number.isFinite(current)) ||
      unavailable(rawCost);
    if (currentMissing) {
      metadata.normalized.tenderValue = excelValue;
      if (unavailable(rawCost)) {
        metadata.raw["Tender Estimated Cost"] = String(excelValue);
      }
      options.logger.info(
        `EXCEL_TENDER_VALUE_APPLIED=${excelValue}`,
      );
    }
  }

  const excelEmd = options.excelEmd;
  if (typeof excelEmd === "number" && Number.isFinite(excelEmd)) {
    const current = metadata.normalized.emdAmount;
    const rawEmd = metadata.raw.EMD;
    const currentMissing =
      current === null ||
      current === undefined ||
      (typeof current === "number" && !Number.isFinite(current)) ||
      unavailable(rawEmd);
    if (currentMissing) {
      metadata.normalized.emdAmount = excelEmd;
      if (unavailable(rawEmd)) {
        metadata.raw.EMD = String(excelEmd);
      }
      options.logger.info(`EXCEL_EMD_APPLIED=${excelEmd}`);
    }
  }
}

function applyItRelevanceGate(options: {
  metadata: CompleteTenderMetadata;
  t247Id: string;
  logger: Logger;
}): Tender247ItRelevanceResult {
  const requireIt = loadPrescreenConfig().tender247RequireItRelevance;
  options.logger.info(`TENDER247_IT_RELEVANCE_START=T247-${options.t247Id}`);

  if (!requireIt) {
    const bypass: Tender247ItRelevanceResult = {
      relevance: "IT_RELEVANT",
      reasonCode: "STRONG_IT_TERM_MATCH",
      matchedTerms: [],
      negativeTerms: [],
      evidenceFields: [],
      explanation: "IT relevance gate disabled (PRESCREEN_TENDER247_REQUIRE_IT_RELEVANCE=false)",
    };
    options.logger.info("TENDER247_IT_RELEVANCE=IT_RELEVANT");
    options.logger.info("TENDER247_IT_RELEVANCE_REASON=GATE_DISABLED");
    return bypass;
  }

  const result = evaluateTender247ItRelevanceFromMetadata(options.metadata);
  options.logger.info(`TENDER247_IT_RELEVANCE=${result.relevance}`);
  options.logger.info(`TENDER247_IT_RELEVANCE_REASON=${result.reasonCode}`);

  if (result.relevance === "NON_IT") {
    options.logger.info("TENDER247_DROPPED_BEFORE_SUPABASE=true");
    options.logger.info("SUPABASE_WRITE_SKIPPED=true");
    options.logger.info("DOCUMENT_DOWNLOAD_SKIPPED=true");
    options.logger.info("CHATGPT_SKIPPED=true");
  } else if (result.relevance === "AMBIGUOUS") {
    options.logger.info("TENDER247_MANUAL_REVIEW_REQUIRED=true");
    options.logger.info("SUPABASE_WRITE_SKIPPED=true");
    options.logger.info("DOCUMENT_DOWNLOAD_SKIPPED=true");
    options.logger.info("CHATGPT_SKIPPED=true");
  }

  return result;
}

function buildGateDropResult(options: {
  t247Id: string;
  gate: Tender247ItRelevanceResult;
  title: string | null;
  securityCodeCaptured: boolean;
}): ProcessTenderResult {
  const status =
    options.gate.relevance === "NON_IT"
      ? "dropped_non_it"
      : "ambiguous_manual_review";
  return {
    t247Id: options.t247Id,
    status,
    zipPath: null,
    zipSize: 0,
    documentsDownloaded: 0,
    corrigendaDownloaded: 0,
    aiSummaryDownloaded: false,
    allDocumentsDownloaded: false,
    securityCodeCaptured: options.securityCodeCaptured,
    metadataStatus: "missing",
    aiSummaryStatus: "missing",
    allDocumentsStatus: "missing",
    metadataPath: null,
    aiSummaryPath: null,
    allDocumentsPath: null,
    lastCompletedStep: "it_relevance_gate",
    error: null,
    failedDocuments: [],
    itRelevance: options.gate.relevance,
    itRelevanceReasonCode: options.gate.reasonCode,
    itRelevanceMatchedTerms: options.gate.matchedTerms,
    itRelevanceNegativeTerms: options.gate.negativeTerms,
    itRelevanceEvidenceFields: options.gate.evidenceFields,
    itRelevanceExplanation: options.gate.explanation ?? null,
    titleForAudit: options.title,
    supabaseWriteSkipped: true,
    documentDownloadSkipped: true,
    chatgptSkipped: true,
  };
}

function buildResult(input: {
  t247Id: string;
  status: ProcessTenderResult["status"];
  zipPath: string | null;
  zipSize: number;
  aiSummaryDownloaded: boolean;
  allDocumentsDownloaded: boolean;
  securityCodeCaptured: boolean;
  metadataStatus: ArtifactStepStatus;
  aiSummaryStatus: ArtifactStepStatus;
  allDocumentsStatus: ArtifactStepStatus;
  metadataPath: string | null;
  aiSummaryPath: string | null;
  allDocumentsPath: string | null;
  lastCompletedStep: string | null;
  error: string | null;
  itRelevance?: Tender247ItRelevanceResult | null;
}): ProcessTenderResult {
  return {
    t247Id: input.t247Id,
    status: input.status,
    zipPath: input.zipPath,
    zipSize: input.zipSize,
    documentsDownloaded: input.allDocumentsDownloaded ? 1 : 0,
    corrigendaDownloaded: 0,
    aiSummaryDownloaded: input.aiSummaryDownloaded,
    allDocumentsDownloaded: input.allDocumentsDownloaded,
    securityCodeCaptured: input.securityCodeCaptured,
    metadataStatus: input.metadataStatus,
    aiSummaryStatus: input.aiSummaryStatus,
    allDocumentsStatus: input.allDocumentsStatus,
    metadataPath: input.metadataPath,
    aiSummaryPath: input.aiSummaryPath,
    allDocumentsPath: input.allDocumentsPath,
    lastCompletedStep: input.lastCompletedStep,
    error: input.error,
    failedDocuments: [],
    itRelevance: input.itRelevance?.relevance ?? null,
    itRelevanceReasonCode: input.itRelevance?.reasonCode ?? null,
    itRelevanceMatchedTerms: input.itRelevance?.matchedTerms ?? [],
    itRelevanceNegativeTerms: input.itRelevance?.negativeTerms ?? [],
    itRelevanceEvidenceFields: input.itRelevance?.evidenceFields ?? [],
    itRelevanceExplanation: input.itRelevance?.explanation ?? null,
    supabaseWriteSkipped: false,
    documentDownloadSkipped: false,
    chatgptSkipped: false,
  };
}

function loadOrCreateMinimumMetadata(options: {
  metadataPath: string;
  tenderFolder: string;
  t247Id: string;
  detailUrl: string;
  titleHint: string | null;
  securityCodeCaptured: boolean;
  logger: Logger;
}): Promise<CompleteTenderMetadata> {
  return (async () => {
    const fromSupabase = await fetchTender247Metadata(options.t247Id);
    if (fromSupabase) {
      options.logger.info("METADATA_LOADED_FROM_SUPABASE");
      return fromSupabase;
    }

    if (isValidArtifact(options.metadataPath)) {
      try {
        options.logger.info("METADATA_LOADED_FROM_LEGACY_FILE");
        return JSON.parse(
          fs.readFileSync(options.metadataPath, "utf8"),
        ) as CompleteTenderMetadata;
      } catch {
        options.logger.warn("Existing metadata.json unreadable; using minimum");
      }
    }

    return {
      source: "tender247",
      t247Id: options.t247Id,
      detailUrl: options.detailUrl,
      raw: {},
      normalized: {
        tenderName: options.titleHint,
      },
      tenderOverview: {},
      aiSummary: {},
      downloads: {
        aiSummaryDownloaded: false,
        allDocumentsDownloaded: false,
        aiSummaryFile: null,
        allDocumentsFile: null,
      },
      processedAt: new Date().toISOString(),
      securityCodeCaptured: options.securityCodeCaptured,
      status: "processing",
      metadataExtractionStatus: "processing",
      metadataExtractionError: null,
    };
  })();
}

async function persistTender247Metadata(options: {
  metadata: CompleteTenderMetadata;
  tenderFolder: string;
  logger: Logger;
}): Promise<void> {
  const { metadata, tenderFolder, logger } = options;
  logger.info("METADATA_WRITE_START");
  // Phase 1: Supabase is the durable store — do not keep metadata.json on disk
  const result = await upsertTender247Metadata({
    metadata,
    localFolderPath: tenderFolder,
    logger,
  });
  writeMetadataSyncMarker(tenderFolder, {
    sourcePortal: "TENDER247",
    sourceTenderId: metadata.t247Id,
    contentHash: result.contentHash,
    extractionStatus: metadata.metadataExtractionStatus ?? null,
    syncedAt: new Date().toISOString(),
    ok: result.ok,
    error: result.error,
  });
  if (result.ok) {
    if (result.id) {
      await runAndPersistPrescreen({
        tenderId: result.id,
        sourcePortal: "TENDER247",
        sourceTenderId: metadata.t247Id,
        input: buildTender247PrescreenInput(metadata),
        metadataHash: result.contentHash,
        logger,
      });
    }
    const keepLocal =
      process.env.KEEP_LOCAL_METADATA_JSON?.trim().toLowerCase() === "true" ||
      process.env.KEEP_LOCAL_METADATA_JSON?.trim() === "1";
    const legacyPath = path.join(tenderFolder, "metadata.json");
    if (!keepLocal && fs.existsSync(legacyPath)) {
      try {
        fs.rmSync(legacyPath, { force: true });
        logger.info("METADATA_LEGACY_FILE_REMOVED");
      } catch {
        // ignore
      }
    } else if (keepLocal) {
      fs.writeFileSync(
        legacyPath,
        JSON.stringify(metadata, null, 2),
        "utf8",
      );
      logger.info("METADATA_LOCAL_KEPT");
    }
  }
  logger.info(result.ok ? "METADATA_SAVED" : "METADATA_DB_SYNC_FAILED");
}

function folderHasUsefulContent(root: string): boolean {
  if (!fs.existsSync(root)) {
    return false;
  }
  const walk = (dir: string): boolean => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (walk(p)) {
          return true;
        }
      } else if (st.isFile() && st.size > 0) {
        return true;
      }
    }
    return false;
  };
  return walk(root);
}

async function dismissForTenderPage(
  page: Page,
  logger: Logger,
  config: AppConfig,
): Promise<void> {
  try {
    await dismissTender247Interruptions(page, logger, config);
  } catch (error) {
    if (
      error instanceof AutomationError &&
      error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
    ) {
      throw error;
    }
    await dismissTender247BlockingOverlays(page, logger, config).catch(
      () => undefined,
    );
    await dismissTender247SupportChat(page, logger).catch(() => undefined);
  }
}

/** @deprecated */
export async function processTender(): Promise<never> {
  throw new Error(
    "Use processLiveTender — the single canonical tender processor.",
  );
}

export function ensureTenderWorkspace(dateFolder: string, t247Id: string): string {
  const safe = sanitizeT247Id(t247Id);
  const root = path.join(dateFolder, `T247-${safe}`);
  const requestedDate =
    getActiveTender247RunContext()?.requestedDate ??
    requestedDateFromDateFolder(dateFolder);
  ensureTender247DateScopedDir(root, requestedDate);
  return root;
}

export function uniqueDocFileName(
  typeName: string,
  extension: string,
  used: Set<string>,
): string {
  const ext = extension.startsWith(".") ? extension.slice(1) : extension || "bin";
  let base = sanitizeFileName(typeName || "Document");
  let name = `${base}.${ext}`;
  let i = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base}_${i}.${ext}`;
    i += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

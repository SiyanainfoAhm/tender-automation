import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { dismissTender247BlockingOverlays } from "../tenderDetails/dismissPromotionalPopups.js";
import { dismissTender247SupportChat } from "../tenderDetails/dismissSupportChat.js";
import { sanitizeFileName, sanitizeT247Id } from "../tenderDetails/tenderFolder.js";
import {
  buildDetailPageUrl,
  postJson,
  tenderDetailUrl,
} from "./apiClient.js";
import { createTenderZip, removeDirectoryRecursive } from "./createTenderZip.js";
import { downloadRequiredTenderFiles } from "./downloadRequiredTenderFiles.js";
import {
  extractCompleteTenderMetadata,
  type CompleteTenderMetadata,
} from "./extractCompleteMetadata.js";
import { findVisibleLiveTenderCards } from "./liveListCards.js";
import { openTenderFromLiveCard } from "./openTenderFromCard.js";
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
    await dismissTender247BlockingOverlays(listPage, logger, config).catch(
      () => undefined,
    );
    await dismissTender247SupportChat(listPage, logger).catch(() => undefined);

    const cards = await findVisibleLiveTenderCards(listPage, logger);
    const card = cards.find((c) => c.t247Id === t247Id);
    if (!card) {
      throw new Error(
        `Live tender row for T247-${t247Id} not found in currently rendered list`,
      );
    }

    const opened = await openTenderFromLiveCard(
      listPage,
      context,
      card,
      config,
      logger,
    );
    detailPage = opened.detailPage;
    securityCodeCaptured = opened.securityCodeCaptured;
    let securityCode = opened.securityCode;

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
    } else {
      logger.info("SECURITY_CODE_CAPTURED");
    }

    const portalUrl = securityCode
      ? buildDetailPageUrl(t247Id, securityCode, null)
      : opened.detailUrl || detailPage.url();

    // Minimum metadata first (in-memory / Supabase / legacy — never permanent metadata.json)
    let metadata: CompleteTenderMetadata = await loadOrCreateMinimumMetadata({
      metadataPath: resume.metadataPath,
      tenderFolder: resume.tenderFolder,
      t247Id,
      detailUrl: portalUrl,
      titleHint: options.titleHint ?? card.titleHint,
      securityCodeCaptured,
      logger,
    });
    metadataStatus =
      metadata.metadataExtractionStatus === "complete" ? "complete" : "partial";
    lastCompletedStep = "metadata_min";

    // Optional API enrichment
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
    await dismissTender247BlockingOverlays(detailPage, logger, config).catch(
      () => undefined,
    );
    await dismissTender247SupportChat(detailPage, logger).catch(() => undefined);

    // ---- METADATA (independent) ----
    if (!resume.metadataValid) {
      try {
        const extracted = await extractCompleteTenderMetadata({
          detailPage,
          t247Id,
          detailUrl: portalUrl,
          titleHint: options.titleHint ?? card.titleHint,
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
        await persistTender247Metadata({
          metadata,
          tenderFolder: resume.tenderFolder,
          logger,
        });
        metadataStatus = "complete";
        metadataPath = null;
        lastCompletedStep = "metadata";
        logger.info("METADATA_SAVED");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("METADATA_EXTRACTION_PARTIAL");
        logger.warn(`METADATA_EXTRACTION_ERROR=${message}`);
        metadata.metadataExtractionStatus = "partial";
        metadata.metadataExtractionError = message;
        metadata.processedAt = new Date().toISOString();
        await persistTender247Metadata({
          metadata,
          tenderFolder: resume.tenderFolder,
          logger,
        });
        metadataStatus = "partial";
        metadataPath = null;
        lastCompletedStep = "metadata_partial";
        logger.info("METADATA_SAVED");
      }
    } else {
      logger.info("METADATA_ALREADY_PRESENT_SKIP");
      metadataStatus = "complete";
      metadataPath = null;
    }

    // ---- DOWNLOADS (independent; skip present artifacts) ----
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

      metadata.downloads = {
        aiSummaryDownloaded: aiSummaryStatus === "complete",
        allDocumentsDownloaded: allDocumentsStatus === "complete",
        aiSummaryFile: aiSummaryPath ? path.basename(aiSummaryPath) : null,
        allDocumentsFile: allDocumentsPath
          ? path.relative(resume.tenderFolder, allDocumentsPath).replace(/\\/g, "/")
          : null,
      };
      metadata.processedAt = new Date().toISOString();
      await persistTender247Metadata({
        metadata,
        tenderFolder: resume.tenderFolder,
        logger,
      });
      metadataPath = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Downloads step error (continuing): ${message}`);
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
  });
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

/** @deprecated */
export async function processTender(): Promise<never> {
  throw new Error(
    "Use processLiveTender — the single canonical tender processor.",
  );
}

export function ensureTenderWorkspace(dateFolder: string, t247Id: string): string {
  const safe = sanitizeT247Id(t247Id);
  const root = path.join(dateFolder, `T247-${safe}`);
  ensureDir(root);
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

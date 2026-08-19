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
import { downloadRequiredTenderFiles } from "./downloadRequiredTenderFiles.js";
import {
  ensureTender247DateScopedDir,
  getActiveTender247RunContext,
  requestedDateFromDateFolder,
  requestedDateFromDateFolderSafe,
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
import { verifyCurrentTenderId } from "./verifyCurrentTenderId.js";
import {
  inspectTenderArtifactState,
  isTenderSafeToSkipReopen,
  pendingTimeoutReasonFromState,
} from "./tenderArtifactState.js";
import {
  assertCanCloseAfterFinalGate,
  runFinalTenderAdvanceGate,
  type FinalTenderAdvanceGateResult,
} from "./finalTenderAdvanceGate.js";
import {
  isAiSummaryTerminalFailure,
  resolveAiSummaryStage,
  saveAiSummaryStage,
  shouldSkipAiSummaryRetry,
} from "./aiSummaryStage.js";
import {
  assertSingleTender247DetailPage,
  closeExtraTender247DetailPages,
} from "./assertSingleTender247DetailPage.js";
import {
  getTender247DocumentDownloadTimeoutMs,
} from "./tender247ConcurrencyConfig.js";
import {
  assertCanCloseTenderDetailPage,
  createDocumentStageTracker,
  t247Event,
} from "./tenderDocumentStage.js";
import {
  buildFinalEvidenceState,
  writeFinalEvidenceState,
  writeJsonAtomic,
} from "./tender247EvidenceState.js";
import {
  fetchTender247Metadata,
  upsertTender247Metadata,
} from "../supabase/tenderMetadataStore.js";
import {
  assertOpenSingleTenderDetailsAllowed,
  loadPhase1DecisionsFromDisk,
  lookupScreeningDecision,
} from "../runScreening/phase1DetailQueue.js";
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
  recoveryBudgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** ChatGPT Phase-1 screening is authoritative — do not locally drop as NON_IT. */
  phase1ScreeningAuthoritative?: boolean;
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
  let downloadAllAttempted = false;
  let downloadAllSuccess = false;
  let individualFallbackUsed = false;
  let individualDocsFound = 0;
  let individualDocsSuccess = 0;
  let individualDocsFailed: string[] = [];
  let canonicalZipReady = false;
  let documentsStageRan = false;
  const documentStage = createDocumentStageTracker(t247Id);
  const tenderStartedAt = Date.now();
  let terminalKind: "none" | "complete" | "pending_timeout" | "dropped" = "none";
  let lastGate: FinalTenderAdvanceGateResult | null = null;

  logger.info(`[${index}/${total}] START T247-${t247Id}`);

  const phase1Decisions = loadPhase1DecisionsFromDisk(dateFolder);
  if (phase1Decisions) {
    const decision = lookupScreeningDecision(phase1Decisions, t247Id);
    if (!decision) {
      throw new AutomationError(
        "T247_SCREENING_DECISION_MISSING",
        `T247_SCREENING_DECISION_MISSING:${t247Id}`,
      );
    }
    logger.info(`[T247 ${t247Id}] PHASE1_STATUS=${decision.status}`);
    if (decision.status === "NO_BID") {
      logger.error(`T247_REFUSING_TO_SCRAPE_NO_BID id=${t247Id}`);
      const folder = path.join(dateFolder, `T247-${t247Id}`);
      if (fs.existsSync(folder)) {
        logger.info(`T247_EXISTING_FOLDER_NO_BID_SKIPPED=${t247Id}`);
      }
      logger.info(`[T247 ${t247Id}] DETAIL_SCRAPE_ALLOWED=false`);
      return {
        t247Id,
        status: "skipped_no_bid",
        zipPath: null,
        zipSize: 0,
        documentsDownloaded: 0,
        corrigendaDownloaded: 0,
        aiSummaryDownloaded: false,
        allDocumentsDownloaded: false,
        securityCodeCaptured: false,
        metadataStatus: "missing",
        aiSummaryStatus: "missing",
        allDocumentsStatus: "missing",
        metadataPath: null,
        aiSummaryPath: null,
        allDocumentsPath: null,
        lastCompletedStep: null,
        error: null,
        failedDocuments: [],
        pendingReason: null,
        artifactComplete: false,
        chatgptSkipped: true,
      };
    }
    logger.info(`[T247 ${t247Id}] DETAIL_SCRAPE_ALLOWED=true`);
  }

  // -------- LEVEL A: skip reopen when core artifacts are ready and AI is
  // present or has already reached an explicit terminal failure --------
  let resume = inspectTenderResumeState(dateFolder, t247Id);
  if (isTenderSafeToSkipReopen(resume.tenderFolder, t247Id)) {
    const artifacts = inspectTenderArtifactState(resume.tenderFolder, t247Id);
    const aiStage = resolveAiSummaryStage({
      tenderDir: resume.tenderFolder,
      aiSummaryValid: artifacts.aiSummaryValid,
    });
    logger.info(`TENDER247_ALREADY_COMPLETED_SKIP=T247-${t247Id}`);
    if (!artifacts.aiSummaryValid && isAiSummaryTerminalFailure(aiStage)) {
      t247Event(logger, t247Id, "AI_SUMMARY_DOWNLOAD_FAILED");
      t247Event(logger, t247Id, "AI_SUMMARY_NON_BLOCKING=true");
      t247Event(logger, t247Id, `AI_SUMMARY_STATUS=${aiStage}`);
      t247Event(logger, t247Id, "AI_SUMMARY_RECOVERY_PENDING=true");
      saveAiSummaryStage({
        tenderDir: resume.tenderFolder,
        t247Id,
        aiStage,
        aiSummaryValid: false,
      });
    }
    const zipOk =
      fs.existsSync(resume.zipPath) && fs.statSync(resume.zipPath).size > 0;
    if (!zipOk && artifacts.coreReady) {
      try {
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
      } catch (error) {
        logger.warn(
          `ZIP from existing folder failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else if (zipOk) {
      zipPath = resume.zipPath;
      zipSize = fs.statSync(resume.zipPath).size;
    }
    if (
      artifacts.complete &&
      !config.keepUnzippedTenderFolders &&
      fs.existsSync(resume.tenderFolder)
    ) {
      removeDirectoryRecursive(resume.tenderFolder);
    }
    return buildResult({
      t247Id,
      status: "completed",
      zipPath: zipPath || (zipOk ? resume.zipPath : null),
      zipSize: zipSize || (zipOk ? fs.statSync(resume.zipPath).size : 0),
      aiSummaryDownloaded: artifacts.aiSummaryValid,
      allDocumentsDownloaded: artifacts.documentsZipValid,
      securityCodeCaptured: true,
      metadataStatus: artifacts.metadataValid ? "complete" : "missing",
      aiSummaryStatus: artifacts.aiSummaryValid
        ? "complete"
        : isAiSummaryTerminalFailure(aiStage)
          ? "failed"
          : "unavailable",
      allDocumentsStatus: artifacts.documentsZipValid ? "complete" : "missing",
      metadataPath: artifacts.metadataValid ? artifacts.metadataPath : null,
      aiSummaryPath: artifacts.aiSummaryValid ? artifacts.aiSummaryPath : null,
      allDocumentsPath: artifacts.documentsZipValid
        ? artifacts.documentsZipPath
        : null,
      lastCompletedStep: lastCompletedStep || "zip",
      error: null,
      pendingReason: null,
      artifactComplete: artifacts.complete,
      chatgptSkipped: false,
      completeWithAiMissing:
        artifacts.coreReady &&
        !artifacts.aiSummaryValid &&
        isAiSummaryTerminalFailure(aiStage),
    });
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

    // ZIP repair only when all attempted artifacts already exist (do not skip AI).
    if (resume.metadataValid && resume.allDocumentsValid && resume.aiSummaryValid) {
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
          phase1ScreeningAuthoritative: options.phase1ScreeningAuthoritative,
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
        const artifacts = inspectTenderArtifactState(resume.tenderFolder, t247Id);
        const completedOk = artifacts.complete && isValidArtifact(zipPath);
        return buildResult({
          t247Id,
          status: completedOk ? "completed" : "partial",
          zipPath: completedOk ? zipPath : null,
          zipSize: completedOk ? zipSize : 0,
          aiSummaryDownloaded: artifacts.aiSummaryValid,
          allDocumentsDownloaded: artifacts.documentsZipValid,
          securityCodeCaptured: true,
          metadataStatus: artifacts.metadataValid ? "complete" : "missing",
          aiSummaryStatus: artifacts.aiSummaryValid ? "complete" : "unavailable",
          allDocumentsStatus: artifacts.documentsZipValid ? "complete" : "missing",
          metadataPath: resume.metadataPath,
          aiSummaryPath: resume.aiSummaryPath,
          allDocumentsPath: resume.allDocumentsPath,
          lastCompletedStep,
          error: completedOk ? null : "Completion validation failed after ZIP repair",
          itRelevance: gate,
          pendingReason: null,
          artifactComplete: completedOk,
          chatgptSkipped: !completedOk,
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
    if (phase1Decisions) {
      const decision = lookupScreeningDecision(phase1Decisions, t247Id);
      assertOpenSingleTenderDetailsAllowed(decision?.status, t247Id);
    }
    await closeExtraTender247DetailPages(context, listPage);
    assertSingleTender247DetailPage(context, listPage, logger);
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
        dateFolder,
        phase1ScreeningStatus: phase1Decisions
          ? lookupScreeningDecision(phase1Decisions, t247Id)?.status
          : undefined,
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

    logger.info(`T247_ARTIFACT_TRANSACTION_START=${t247Id}`);
    logger.info("OPENING_DETAIL");
    logger.info("DETAIL_PAGE_READY");
    logger.info("T247_DETAIL_PAGE_OPENED=true");
    t247Event(logger, t247Id, "DETAIL_OPENED");
    assertSingleTender247DetailPage(context, listPage, logger);

    const portalUrl = securityCode
      ? buildDetailPageUrl(t247Id, securityCode, null)
      : detailPage.url();

    await verifyCurrentTenderId(detailPage, t247Id, logger);

    // Minimum metadata first (in-memory / Supabase / legacy — never permanent metadata.json)
    logger.info("METADATA_CAPTURE_START");
    logger.info(`T247_METADATA_START=${t247Id}`);
    logger.info(`T247_METADATA_CAPTURE_START=${t247Id}`);
    t247Event(logger, t247Id, "METADATA_START");
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

    // ---- METADATA extraction immediately after detail page is ready ----
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

    const metadataOkNow =
      metadata.source === "tender247" &&
      metadata.t247Id === t247Id &&
      Boolean(metadata.normalized?.tenderName) &&
      Boolean(metadata.raw && Object.keys(metadata.raw).length > 0);
    logger.info(`T247_METADATA_CAPTURE_SUCCESS=${metadataOkNow}`);
    logger.info(`T247_METADATA_TENDER_ID=${t247Id}`);
    logger.info("METADATA_COMPLETE");
    t247Event(logger, t247Id, "METADATA_DONE");

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
      phase1ScreeningAuthoritative: options.phase1ScreeningAuthoritative,
    });
    lastItGate = itGate;
    if (itGate.relevance !== "IT_RELEVANT") {
      terminalKind = "dropped";
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

    // Persist metadata before AI Summary / documents so it does not depend on ZIP.
    try {
      await persistTender247Metadata({
        metadata,
        tenderFolder: resume.tenderFolder,
        logger,
      });
      metadataPath = null;
      const localSaved = verifyLocalMetadataJson(resume.tenderFolder, t247Id);
      const verified = await fetchTender247Metadata(t247Id);
      logger.info(`T247_METADATA_SAVED=${localSaved}`);
      logger.info(`T247_METADATA_VERIFIED=${localSaved}`);
      logger.info("T247_METADATA_SUPABASE_UPSERTED=true");
      logger.info(`T247_METADATA_SUPABASE_VERIFIED=${Boolean(verified)}`);
      logger.info("PERSIST");
    } catch (error) {
      logger.warn(
        `T247_METADATA_SUPABASE_UPSERTED=false ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // ---- Sequential artifacts: AI Summary then documents (concurrency=1) ----
    logger.info("AI_SUMMARY_CAPTURE_START");
    try {
      const downloads = await downloadRequiredTenderFiles({
        detailPage,
        context,
        tenderFolder: resume.tenderFolder,
        t247Id,
        timeoutMs: getTender247DocumentDownloadTimeoutMs(),
        aiSummaryTimeoutMs: Math.min(
          config.downloadTimeoutMs,
          Number.parseInt(process.env.T247_AI_SUMMARY_TIMEOUT_MS || "90000", 10) ||
            90_000,
        ),
        maxRetries: Math.min(1, config.documentDownloadMaxRetries),
        logger,
        skipAiSummary: shouldSkipAiSummaryRetry(
          resume.aiSummaryValid,
          resolveAiSummaryStage({
            tenderDir: resume.tenderFolder,
            aiSummaryValid: resume.aiSummaryValid,
          }),
        ),
        skipAllDocuments: resume.allDocumentsValid,
        keepDebugFiles: config.keepDebugFiles,
        documentStage,
      });

      aiSummaryPath = downloads.aiSummaryPath;
      allDocumentsPath = downloads.allDocumentsPath;
      aiSummaryStatus = downloads.aiSummaryStatus;
      allDocumentsStatus =
        downloads.documentsStatus === "unavailable"
          ? "failed"
          : downloads.documentsStatus === "missing"
            ? "failed"
            : downloads.documentsStatus;
      downloadAllAttempted = downloads.downloadAllAttempted;
      downloadAllSuccess = downloads.downloadAllSuccess;
      individualFallbackUsed = downloads.individualFallbackUsed;
      individualDocsFound = downloads.individualDocsFound;
      individualDocsSuccess = downloads.individualDocsSuccess;
      individualDocsFailed = downloads.individualDocsFailed;
      canonicalZipReady = downloads.canonicalZipReady;
      documentsStageRan = downloads.documentsAttempted;

      logger.info(
        `TENDER247_AI_SUMMARY_AVAILABLE=${aiSummaryStatus === "complete"}`,
      );
      logger.info("AI_SUMMARY_COMPLETE");

      if (downloads.allDocumentsDownloaded || downloads.canonicalZipReady) {
        lastCompletedStep = "all_documents";
        logger.info(`TENDER247_DOCUMENT_ARCHIVE_DOWNLOAD_START=T247-${t247Id}`);
        logger.info(
          `TENDER247_DOCUMENT_ARCHIVE_DOWNLOADED=${allDocumentsPath}`,
        );
        logger.info("TENDER247_DOCUMENT_ARCHIVE_VALID=true");
      } else {
        logger.warn(`TENDER247_DOCUMENT_DOWNLOAD_FAILED=T247-${t247Id}`);
        hardError =
          hardError ||
          `Tender documents incomplete for T247-${t247Id}` +
            (downloads.individualFallbackUsed
              ? ` (individual fallback used; failed=${downloads.individualDocsFailed.join(",")})`
              : " (Download All failed)");
      }
      logger.info("DOCUMENT_DOWNLOAD_COMPLETE");

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

      logger.info(`AI_SUMMARY_ATTEMPTED=true`);
      logger.info(`AI_SUMMARY_SUCCESS=${aiSummaryStatus === "complete"}`);
      logger.info(`DOWNLOAD_ALL_ATTEMPTED=${downloads.downloadAllAttempted}`);
      logger.info(`DOWNLOAD_ALL_SUCCESS=${downloads.downloadAllSuccess}`);
      logger.info(
        `INDIVIDUAL_DOC_FALLBACK_USED=${downloads.individualFallbackUsed}`,
      );
      logger.info(`INDIVIDUAL_DOCS_FOUND=${downloads.individualDocsFound}`);
      logger.info(`INDIVIDUAL_DOCS_SUCCESS=${downloads.individualDocsSuccess}`);
      logger.info(
        `INDIVIDUAL_DOCS_FAILED=${downloads.individualDocsFailed.length}`,
      );
      logger.info(`CANONICAL_ZIP_READY=${downloads.canonicalZipReady}`);
      t247Event(logger, t247Id, "ARTIFACT_BATCH_COMPLETE");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Downloads step error (continuing): ${message}`);
      logger.warn(`TENDER247_DOCUMENT_DOWNLOAD_FAILED=T247-${t247Id}`);
      hardError = hardError || message;
      if (allDocumentsStatus !== "complete" && allDocumentsStatus !== "partial") {
        allDocumentsStatus = "failed";
      }
      const stage = documentStage.get();
      if (stage === "downloading" || stage === "verifying") {
        documentStage.set("failed");
      }
    }
  } catch (error) {
    hardError = error instanceof Error ? error.message : String(error);
    logger.warn(`Tender T247-${t247Id} failed: ${hardError}`);
  } finally {
    await waitForAllActiveDownloads().catch(() => undefined);
    const stage = documentStage.get();
    if (stage === "downloading" || stage === "verifying") {
      logger.error(
        `REFUSING_TO_CLOSE_TENDER_${t247Id}: document stage still active (${stage})`,
      );
      assertCanCloseTenderDetailPage(documentStage, t247Id);
    }
    try {
      if (
        terminalKind !== "dropped" &&
        detailPage &&
        !detailPage.isClosed()
      ) {
        const retryMissing = async () => {
          if (!detailPage || detailPage.isClosed()) return;
          const current = inspectTenderArtifactState(resume.tenderFolder, t247Id);
          const aiStage = resolveAiSummaryStage({
            tenderDir: resume.tenderFolder,
            aiSummaryValid: current.aiSummaryValid,
          });
          if (current.ready) return;
          await downloadRequiredTenderFiles({
            detailPage,
            context,
            tenderFolder: resume.tenderFolder,
            t247Id,
            timeoutMs: getTender247DocumentDownloadTimeoutMs(),
            aiSummaryTimeoutMs: Math.min(
              config.downloadTimeoutMs,
              Number.parseInt(process.env.T247_AI_SUMMARY_TIMEOUT_MS || "90000", 10) ||
                90_000,
            ),
            maxRetries: Math.min(1, config.documentDownloadMaxRetries),
            logger,
            skipAiSummary: shouldSkipAiSummaryRetry(current.aiSummaryValid, aiStage),
            skipAllDocuments: current.documentsZipValid,
            keepDebugFiles: config.keepDebugFiles,
            documentStage,
          });
        };
        lastGate = await runFinalTenderAdvanceGate({
          tenderDir: resume.tenderFolder,
          t247Id,
          logger,
          recoveryBudgetMs: options.recoveryBudgetMs,
          now: options.now,
          sleep: options.sleep,
          retryAi: retryMissing,
          retryDocuments: retryMissing,
        });
        terminalKind = lastGate.ready
          ? "complete"
          : lastGate.pendingTimeout
            ? "pending_timeout"
            : "none";
        assertCanCloseAfterFinalGate(t247Id, lastGate);
      }
      if (detailPage && !detailPage.isClosed()) {
        await verifyCurrentTenderId(detailPage, t247Id, logger).catch(() => undefined);
        t247Event(logger, t247Id, "DETAIL_CLOSE_START");
        logger.info("DETAIL_CLOSE_START");
        await detailPage.close({ runBeforeUnload: false });
        logger.info(`DETAIL_TAB_CLOSED T247-${t247Id}`);
        logger.info("T247_DETAIL_PAGE_CLOSED=true");
        t247Event(logger, t247Id, "DETAIL_CLOSED");
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "REFUSING_TO_CLOSE_TENDER") {
        throw error;
      }
      if (
        error instanceof Error &&
        (error.message.startsWith("REFUSING_TO_CLOSE_TENDER_") ||
          error.message.startsWith("T247_PREVIOUS_TENDER_NOT_TERMINAL"))
      ) {
        throw error;
      }
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
    t247Event(
      logger,
      t247Id,
      `TOTAL_TENDER_PROCESSING_MS=${Date.now() - tenderStartedAt}`,
    );
  }

  // ---- ZIP from folder only when the authoritative artifact gate passed ----
  await waitForAllActiveDownloads().catch(() => undefined);
  resume = inspectTenderResumeState(dateFolder, t247Id);
  const artifactsAfterGate =
    lastGate?.state ?? inspectTenderArtifactState(resume.tenderFolder, t247Id);
  try {
    if (artifactsAfterGate.coreReady) {
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
      const aiStageAfterZip = resolveAiSummaryStage({
        tenderDir: resume.tenderFolder,
        aiSummaryValid: artifactsAfterGate.aiSummaryValid,
      });
      const keepForAiRecovery =
        !artifactsAfterGate.aiSummaryValid &&
        isAiSummaryTerminalFailure(aiStageAfterZip);
      if (keepForAiRecovery) {
        t247Event(logger, t247Id, "AI_SUMMARY_RECOVERY_PENDING=true");
      }
      if (!config.keepUnzippedTenderFolders && artifactsAfterGate.complete) {
        removeDirectoryRecursive(resume.tenderFolder);
      }
    } else if (!artifactsAfterGate.documentsZipValid) {
      logger.warn(
        `T247_DOCUMENTS_AVAILABLE=false (final gate incomplete; folder kept for recovery)`,
      );
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
  const artifacts = inspectTenderArtifactState(resume.tenderFolder, t247Id);
  const metadataOk =
    artifacts.metadataValid ||
    artifactsAfterGate.metadataValid ||
    lastGate?.state.metadataValid === true;
  const allDocsOk =
    artifacts.documentsZipValid || artifactsAfterGate.documentsZipValid;
  if (allDocsOk) {
    allDocumentsPath =
      artifacts.documentsZipPath ||
      artifactsAfterGate.documentsZipPath ||
      resume.allDocumentsPath;
    allDocumentsStatus = "complete";
  }
  const zipOk = isValidArtifact(zipPath) || isValidArtifact(resume.zipPath);
  if (zipOk) {
    const resolvedZip = isValidArtifact(zipPath) ? zipPath! : resume.zipPath;
    zipPath = resolvedZip;
    zipSize = fs.statSync(resolvedZip).size;
  }

  const aiOk =
    artifacts.aiSummaryValid || artifactsAfterGate.aiSummaryValid;
  const evidenceCount =
    (metadataOk ? 1 : 0) + (allDocsOk ? 1 : 0) + (aiOk ? 1 : 0);
  const evidenceMode =
    evidenceCount === 3 ? "FULL" : evidenceCount >= 1 ? "PARTIAL" : "NONE";
  logger.info("EVIDENCE_VERIFY");
  logger.info(`T247_EVIDENCE_METADATA=${metadataOk}`);
  logger.info(`T247_EVIDENCE_AI_SUMMARY=${aiOk}`);
  logger.info(`T247_EVIDENCE_DOCUMENTS=${allDocsOk}`);
  logger.info(`T247_METADATA_AVAILABLE=${metadataOk}`);
  logger.info(`T247_AI_SUMMARY_AVAILABLE=${aiOk}`);
  logger.info(`T247_DOCUMENTS_AVAILABLE=${allDocsOk}`);
  logger.info(`T247_EVIDENCE_MODE=${evidenceMode}`);
  logger.info(`EVIDENCE_COUNT=${evidenceCount}`);
  logger.info(`METADATA_ATTEMPTED=true`);
  logger.info(`METADATA_SUCCESS=${metadataOk}`);
  logger.info(`T247_ID=${t247Id}`);
  logger.info(
    evidenceMode === "FULL"
      ? "DONE_FULL"
      : evidenceMode === "PARTIAL"
        ? "DONE_PARTIAL"
        : "DONE_NONE",
  );
  logger.info(`T247_ARTIFACT_TRANSACTION_COMPLETE=${t247Id}`);

  const aiAttempted = aiSummaryStatus !== "missing";
  const docsAttempted =
    documentsStageRan ||
    downloadAllAttempted ||
    individualFallbackUsed ||
    allDocumentsStatus !== "missing";
  writeFinalEvidenceState(
    resume.tenderFolder,
    buildFinalEvidenceState({
      t247Id,
      metadataAttempted: true,
      metadataAvailable: metadataOk,
      metadataStatus: metadataOk
        ? "complete"
        : metadataStatus === "partial"
          ? "failed"
          : "failed",
      aiAttempted,
      aiAvailable: aiOk,
      aiStatus:
        aiSummaryStatus === "unavailable"
          ? "unavailable"
          : aiOk
            ? "complete"
            : aiAttempted
              ? "failed"
              : "not_attempted",
      aiPath: aiSummaryPath || resume.aiSummaryPath,
      documentsAttempted: docsAttempted,
      documentsAvailable: allDocsOk,
      documentsStatus:
        allDocumentsStatus === "partial"
          ? "partial"
          : allDocsOk
            ? "complete"
            : docsAttempted
              ? "failed"
              : "not_attempted",
      documentsPath: allDocumentsPath || resume.allDocumentsPath,
      downloadAllAttempted,
      downloadAllSuccess,
      individualFallbackUsed,
      individualDocsFound,
      individualDocsSuccess,
      individualDocsFailed,
      canonicalZipReady,
    }),
  );

  const pendingTimeout =
    lastGate?.pendingTimeout === true || terminalKind === "pending_timeout";
  const aiStageFinal = resolveAiSummaryStage({
    tenderDir: resume.tenderFolder,
    aiSummaryValid: aiOk,
    explicitStage: lastGate?.aiStage,
  });
  if (!aiOk && isAiSummaryTerminalFailure(aiStageFinal)) {
    saveAiSummaryStage({
      tenderDir: resume.tenderFolder,
      t247Id,
      aiStage: aiStageFinal,
      aiSummaryValid: false,
    });
  }
  const completeWithAiMissing =
    lastGate?.completeWithAiMissing === true ||
    (Boolean(lastGate?.safeToAdvance) &&
      !pendingTimeout &&
      metadataOk &&
      allDocsOk &&
      !aiOk &&
      isAiSummaryTerminalFailure(aiStageFinal));
  const gateComplete =
    ((lastGate?.ready === true || artifactsAfterGate.complete) &&
      metadataOk &&
      aiOk &&
      allDocsOk) ||
    completeWithAiMissing;

  if (gateComplete && (!allDocsOk || !metadataOk)) {
    throw new Error(
      `T247_COMPLETED_WITHOUT_REQUIRED_ARTIFACTS: ${t247Id}`,
    );
  }
  if (gateComplete && !aiOk && !completeWithAiMissing) {
    throw new Error(
      `T247_COMPLETED_WITHOUT_REQUIRED_ARTIFACTS: ${t247Id}`,
    );
  }

  let status: ProcessTenderResult["status"];
  let pendingReason: string | null = null;
  let artifactComplete = false;
  let chatgptSkipped = false;

  if (completeWithAiMissing && metadataOk && allDocsOk) {
    status = "completed";
    artifactComplete = false;
    chatgptSkipped = false;
    metadataStatus = "complete";
    aiSummaryStatus = "failed";
    allDocumentsStatus = "complete";
    t247Event(logger, t247Id, "AI_SUMMARY_DOWNLOAD_FAILED");
    t247Event(logger, t247Id, "AI_SUMMARY_NON_BLOCKING=true");
  } else if (gateComplete) {
    status = "completed";
    artifactComplete = true;
    chatgptSkipped = false;
    metadataStatus = "complete";
    aiSummaryStatus = "complete";
    allDocumentsStatus = "complete";
  } else if (pendingTimeout) {
    status = "pending";
    pendingReason =
      lastGate?.pendingReason ?? pendingTimeoutReasonFromState(artifactsAfterGate);
    artifactComplete = false;
    chatgptSkipped = true;
    logger.info(`[T247 ${t247Id}] STATUS=${pendingReason}`);
  } else if (hardError && !metadataOk && !aiOk && !allDocsOk) {
    status = "failed";
    artifactComplete = false;
    chatgptSkipped = true;
  } else {
    status = "pending";
    pendingReason = pendingTimeoutReasonFromState(artifactsAfterGate);
    artifactComplete = false;
    chatgptSkipped = true;
  }

  if (status === "completed" && (!allDocsOk || !metadataOk)) {
    throw new Error(
      `T247_COMPLETED_WITHOUT_REQUIRED_ARTIFACTS: ${t247Id}`,
    );
  }
  if (status === "completed" && !aiOk && !completeWithAiMissing) {
    throw new Error(
      `T247_COMPLETED_WITHOUT_REQUIRED_ARTIFACTS: ${t247Id}`,
    );
  }

  logger.info(`[${index}/${total}] COMPLETE status=${status}`);
  if (status === "pending") {
    logger.info(`[T247 ${t247Id}] artifactComplete=false chatgptSkipped=true`);
  }

  return buildResult({
    t247Id,
    status,
    zipPath: gateComplete && zipOk ? zipPath : zipOk ? zipPath : null,
    zipSize: zipOk ? zipSize : 0,
    aiSummaryDownloaded: aiOk,
    allDocumentsDownloaded: allDocsOk,
    securityCodeCaptured,
    metadataStatus: metadataOk ? "complete" : metadataStatus,
    aiSummaryStatus: aiOk ? "complete" : aiSummaryStatus,
    allDocumentsStatus: allDocsOk ? "complete" : allDocumentsStatus,
    metadataPath: metadataPath || resume.metadataPath,
    aiSummaryPath,
    allDocumentsPath: allDocumentsPath || resume.allDocumentsPath,
    lastCompletedStep,
    error:
      status === "completed"
        ? null
        : lastGate?.pendingMessage || hardError,
    itRelevance: lastItGate,
    pendingReason,
    artifactComplete,
    chatgptSkipped,
    completeWithAiMissing,
  });
}

export const processTender247ArtifactTransaction = processLiveTender;

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
  phase1ScreeningAuthoritative?: boolean;
}): Tender247ItRelevanceResult {
  const requireIt = loadPrescreenConfig().tender247RequireItRelevance;
  options.logger.info(`TENDER247_IT_RELEVANCE_START=T247-${options.t247Id}`);

  if (options.phase1ScreeningAuthoritative) {
    const result = evaluateTender247ItRelevanceFromMetadata(options.metadata);
    options.logger.info(`TENDER247_IT_RELEVANCE=${result.relevance}`);
    options.logger.info("TENDER247_IT_RELEVANCE_REASON=PHASE1_SCREENING_AUTHORITATIVE");
    options.logger.info(
      "TENDER247_LOCAL_COMPANY_FILTER_BYPASSED=true (ChatGPT Phase-1 Excel screening is source of truth)",
    );
    return {
      ...result,
      relevance: "IT_RELEVANT",
      explanation: `Phase-1 ChatGPT screening already shortlisted this tender; local IT drop bypassed (classifier=${result.relevance})`,
    };
  }

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
    artifactComplete: false,
    pendingReason: null,
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
  pendingReason?: string | null;
  artifactComplete?: boolean;
  chatgptSkipped?: boolean;
  completeWithAiMissing?: boolean;
}): ProcessTenderResult {
  const artifactComplete = Boolean(input.artifactComplete);
  const completeWithAiMissing = Boolean(input.completeWithAiMissing);
  const chatgptSkipped =
    input.chatgptSkipped ??
    (input.status !== "completed" || (!artifactComplete && !completeWithAiMissing));
  if (input.status === "completed" && !artifactComplete && !completeWithAiMissing) {
    throw new Error(
      `T247_COMPLETED_WITHOUT_REQUIRED_ARTIFACTS: ${input.t247Id}`,
    );
  }
  if (input.status === "pending" && (artifactComplete || !chatgptSkipped)) {
    throw new Error(
      `T247_PENDING_MUST_NOT_BE_GPT_READY: ${input.t247Id}`,
    );
  }
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
    pendingReason: input.pendingReason ?? null,
    artifactComplete,
    chatgptSkipped,
    completeWithAiMissing: completeWithAiMissing || undefined,
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
  const legacyPath = path.join(tenderFolder, "metadata.json");
  writeJsonAtomic(legacyPath, metadata);
  logger.info("METADATA_LOCAL_WRITTEN=true");
  const result = await upsertTender247Metadata({
    metadata,
    localFolderPath: tenderFolder,
    scrapedDate:
      getActiveTender247RunContext()?.requestedDate ??
      requestedDateFromDateFolderSafe(path.dirname(tenderFolder)),
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
  writeJsonAtomic(legacyPath, metadata);
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
  }
  logger.info(result.ok ? "METADATA_SAVED" : "METADATA_DB_SYNC_FAILED");
}

function verifyLocalMetadataJson(tenderFolder: string, t247Id: string): boolean {
  const filePath = path.join(tenderFolder, "metadata.json");
  if (!isValidArtifact(filePath)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      t247Id?: string;
      sourceTenderId?: string;
      source?: string;
      normalized?: Record<string, unknown>;
      raw?: Record<string, unknown>;
    };
    const id = String(data.t247Id || data.sourceTenderId || "")
      .replace(/^T247-/i, "")
      .trim();
    if (id !== t247Id) return false;
    const hasNormalized =
      Boolean(data.normalized && Object.keys(data.normalized).length > 0) ||
      Boolean(data.raw && Object.keys(data.raw).length > 0);
    return hasNormalized;
  } catch {
    return false;
  }
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

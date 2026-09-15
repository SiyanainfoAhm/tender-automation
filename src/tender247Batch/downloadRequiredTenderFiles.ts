import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Frame, Locator, Page } from "playwright";
import type { Logger } from "../logger.js";
import { AutomationError } from "../browserUtils.js";
import { dismissTender247Interruptions } from "../tenderDetails/dismissTender247Interruptions.js";
import {
  clickAndSaveDownload,
  documentBaseNameFromLinkText,
  waitForAllActiveDownloads,
} from "../tenderDetails/downloadHelpers.js";
import { ensureDir } from "../fileUtils.js";
import { captureAiSummaryArtifact } from "./captureAiSummaryArtifact.js";
import {
  canonicalZipPath,
  ensureCanonicalTenderArchive,
  isCanonicalDocumentsZipReady,
  isValidTenderDocumentsZip,
  removeInvalidCanonicalZip,
} from "./canonicalTenderArchive.js";
import {
  consolidateAllDocumentsDuplicates,
  isValidArtifact,
  removeInvalidAllDocumentsArtifacts,
} from "./resumeArtifacts.js";
import {
  writeInterimEvidenceState,
} from "./tender247EvidenceState.js";
import {
  type TenderDocumentStageTracker,
  t247Event,
} from "./tenderDocumentStage.js";
import { verifyCurrentTenderId } from "./verifyCurrentTenderId.js";
import {
  inspectTenderArtifactState,
  isValidAiSummaryPdf,
} from "./tenderArtifactState.js";
import {
  loadAiSummaryStage,
  mapCaptureStatusToAiStage,
  saveAiSummaryStage,
} from "./aiSummaryStage.js";
import {
  parseTender247DetailRoute,
  tender247RegionFromUrl,
} from "../tender247/sourceRegion.js";
import {
  postJson,
  tenderDocumentListUrl,
} from "./apiClient.js";
import type { DownloadedFileRecord } from "../tenderDetails/types.js";
import { classifyDocumentDownloadFailure } from "../tenderDetails/downloadHelpers.js";

const ARTIFACT_ATTEMPTS = 3;

export type ArtifactResult =
  | { status: "success"; path: string }
  | { status: "retryable_failure"; reason: string }
  | { status: "unavailable"; reason: string };

export interface RequiredDownloadResult {
  aiSummaryPath: string | null;
  allDocumentsPath: string | null;
  aiSummaryDownloaded: boolean;
  allDocumentsDownloaded: boolean;
  aiSummarySize: number;
  allDocumentsSize: number;
  aiSummarySkipped: boolean;
  allDocumentsSkipped: boolean;
  aiSummaryStatus: "complete" | "unavailable" | "failed" | "missing";
  documentsStatus: "complete" | "partial" | "failed" | "unavailable" | "missing";
  downloadAllAttempted: boolean;
  downloadAllSuccess: boolean;
  individualFallbackUsed: boolean;
  individualDocsFound: number;
  individualDocsSuccess: number;
  individualDocsFailed: string[];
  canonicalZipReady: boolean;
  documentsAttempted: boolean;
  aiResult: ArtifactResult;
  documentsResult: ArtifactResult;
}

/**
 * Sequential per-tender artifact acquisition (concurrency = 1):
 * AI Summary, then Tender Documents (Download All, then individual fallback).
 * Documents always run after AI reaches a terminal state — metadata/AI
 * presence is never permission to skip Download All — unless
 * `documentsOnlyIfAiMissing` is set (AI-summary-first pipelines).
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
  /**
   * When true with skipAiSummary: treat AI as already satisfied (Supabase
   * ai_summary_url present) even if the local PDF is missing.
   */
  skipAiSummaryAssumeComplete?: boolean;
  /**
   * When true: download documents only if AI Summary was not captured.
   * Used by the AI-summary-first pipeline.
   */
  documentsOnlyIfAiMissing?: boolean;
  keepDebugFiles?: boolean;
  aiSummaryTimeoutMs?: number;
  documentStage?: TenderDocumentStageTracker;
}): Promise<RequiredDownloadResult> {
  const {
    detailPage,
    context,
    tenderFolder,
    t247Id,
    timeoutMs,
    logger,
  } = options;
  const aiTimeoutMs = options.aiSummaryTimeoutMs ?? timeoutMs;
  const documentsDir = path.join(tenderFolder, "documents");

  ensureDir(tenderFolder);

  await dismissTender247Interruptions(detailPage, logger).catch((error) => {
    if (
      error instanceof AutomationError &&
      error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
    ) {
      throw error;
    }
  });

  logger.info(`T247_AI_SUMMARY_START=${t247Id}`);
  t247Event(logger, t247Id, "AI_START");
  logger.info("AI_SUMMARY_CAPTURE_START");
  let ai: Awaited<ReturnType<typeof captureAiSummaryArtifact>> = {
    attempted: true,
    available: false,
    status: "failed",
    method: "UNAVAILABLE",
    path: null,
    size: 0,
    sectionFound: false,
    scrollContainerFound: false,
  };
  const existingAi = inspectTenderArtifactState(tenderFolder, t247Id);
  if (options.skipAiSummary) {
    if (existingAi.aiSummaryValid) {
      ai = {
        attempted: true,
        available: true,
        status: "complete",
        method: "NATIVE_DOWNLOAD",
        path: existingAi.aiSummaryPath,
        size: fs.existsSync(existingAi.aiSummaryPath)
          ? fs.statSync(existingAi.aiSummaryPath).size
          : 0,
        sectionFound: true,
        scrollContainerFound: true,
      };
      saveAiSummaryStage({
        tenderDir: tenderFolder,
        t247Id,
        aiStage: "COMPLETE",
        aiSummaryValid: true,
      });
    } else if (options.skipAiSummaryAssumeComplete === true) {
      ai = {
        attempted: true,
        available: true,
        status: "complete",
        method: "NATIVE_DOWNLOAD",
        path: null,
        size: 0,
        sectionFound: true,
        scrollContainerFound: true,
      };
      saveAiSummaryStage({
        tenderDir: tenderFolder,
        t247Id,
        aiStage: "COMPLETE",
        aiSummaryValid: true,
      });
      logger.info("AI_SUMMARY_SKIPPED_EXISTING_URL=true");
    } else {
      const saved = loadAiSummaryStage(tenderFolder);
      const skippedStatus =
        saved?.aiStage === "UNAVAILABLE" || saved?.aiSummaryStatus === "UNAVAILABLE"
          ? "unavailable"
          : "failed";
      ai = {
        attempted: true,
        available: false,
        status: skippedStatus,
        method: "UNAVAILABLE",
        path: null,
        size: 0,
        sectionFound: false,
        scrollContainerFound: false,
      };
      saveAiSummaryStage({
        tenderDir: tenderFolder,
        t247Id,
        aiStage: saved?.aiStage && saved.aiStage !== "COMPLETE"
          ? saved.aiStage
          : mapCaptureStatusToAiStage(skippedStatus),
        aiSummaryValid: false,
      });
    }
  } else {
    saveAiSummaryStage({
      tenderDir: tenderFolder,
      t247Id,
      aiStage: "DOWNLOADING",
      aiSummaryValid: false,
    });
    try {
      ai = await captureAiSummaryArtifact({
        detailPage,
        context,
        tenderFolder,
        t247Id,
        timeoutMs: aiTimeoutMs,
        logger,
        skipIfPresent: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`T247_AI_SUMMARY_COMPLETE=false ${message}`);
      ai = {
        attempted: true,
        available: false,
        status: "failed",
        method: "UNAVAILABLE",
        path: null,
        size: 0,
        sectionFound: false,
        scrollContainerFound: false,
      };
    }
    saveAiSummaryStage({
      tenderDir: tenderFolder,
      t247Id,
      aiStage: mapCaptureStatusToAiStage(ai.status),
      aiSummaryValid: ai.available && isValidAiSummaryPdf(ai.path || existingAi.aiSummaryPath),
    });
  }
  logger.info(`T247_AI_SUMMARY_COMPLETE=${ai.available}`);
  logger.info(`T247_AI_SUMMARY_FILE_VERIFIED=${ai.available && isValidArtifact(ai.path)}`);
  logger.info("AI_SUMMARY_COMPLETE");
  t247Event(logger, t247Id, "AI_DONE");

  const aiSummaryOk =
    ai.available === true &&
    isValidAiSummaryPdf(ai.path || existingAi.aiSummaryPath);
  const skipDocsBecauseAiPresent =
    options.documentsOnlyIfAiMissing === true && aiSummaryOk;

  logger.info(`T247_DOCUMENTS_START=${t247Id}`);
  t247Event(logger, t247Id, "DOCUMENTS_START");
  const documentsStartedAt = Date.now();
  options.documentStage?.set("downloading");
  consolidateAllDocumentsDuplicates(
    documentsDir,
    Boolean(options.keepDebugFiles),
    logger,
  );

  const alreadyCanonical = isCanonicalDocumentsZipReady(documentsDir);
  let documentsStatus: RequiredDownloadResult["documentsStatus"] = alreadyCanonical
    ? "complete"
    : "missing";
  let allDocumentsPath: string | null = alreadyCanonical
    ? canonicalZipPath(documentsDir)
    : null;
  let allDocumentsDownloaded = alreadyCanonical;
  let allDocumentsSkipped = false;
  let allDocumentsSize =
    alreadyCanonical && allDocumentsPath
      ? fs.statSync(allDocumentsPath).size
      : 0;
  let downloadAllAttempted = false;
  let downloadAllSuccess = false;
  let individualFallbackUsed = false;
  let individualDocsFound = 0;
  let individualDocsSuccess = 0;
  const individualDocsFailed: string[] = [];
  let documentsAttempted = false;

  if (skipDocsBecauseAiPresent && !alreadyCanonical) {
    allDocumentsSkipped = true;
    documentsAttempted = false;
    documentsStatus = "missing";
    logger.info("DOCUMENTS_SKIPPED_AI_SUMMARY_PRESENT=true");
    t247Event(logger, t247Id, "DOCUMENTS_SKIPPED_AI_SUMMARY_PRESENT");
    options.documentStage?.set("success");
  } else if (options.skipAllDocuments) {
    allDocumentsSkipped = true;
    documentsAttempted = true;
    documentsStatus = "complete";
    allDocumentsDownloaded = true;
    if (alreadyCanonical) {
      logger.info("ALL_DOCUMENTS_ALREADY_PRESENT_SKIP");
      logger.info("T247_CANONICAL_ZIP_VERIFIED=true");
    } else {
      // Supabase already has documents_zip_url — do not re-download from Tender247.
      logger.info("ALL_DOCUMENTS_SKIPPED_EXISTING_URL=true");
    }
    options.documentStage?.set("success");
  } else {
    if (alreadyCanonical) {
      logger.info("ALL_DOCUMENTS_ALREADY_PRESENT_SKIP");
      documentsAttempted = true;
      allDocumentsSkipped = true;
    } else {
      if (options.documentsOnlyIfAiMissing) {
        logger.info("DOCUMENTS_DOWNLOAD_BECAUSE_AI_SUMMARY_MISSING=true");
        t247Event(logger, t247Id, "DOCUMENTS_DOWNLOAD_BECAUSE_AI_SUMMARY_MISSING");
      }
      try {
        const docs = await acquireTenderDocuments({
          detailPage,
          context,
          tenderFolder,
          documentsDir,
          t247Id,
          timeoutMs,
          logger,
        });
        documentsAttempted = true;
        downloadAllAttempted = docs.downloadAllAttempted;
        downloadAllSuccess = docs.downloadAllSuccess;
        individualFallbackUsed = docs.individualFallbackUsed;
        individualDocsFound = docs.individualDocsFound;
        individualDocsSuccess = docs.individualDocsSuccess;
        individualDocsFailed.push(...docs.individualDocsFailed);
        allDocumentsPath = docs.path;
        allDocumentsDownloaded = isValidArtifact(docs.path);
        allDocumentsSize =
          allDocumentsDownloaded && docs.path
            ? fs.statSync(docs.path).size
            : 0;
        documentsStatus = docs.status;
      } catch (error) {
        options.documentStage?.set("failed");
        throw error;
      }
    }
  }

  await waitForAllActiveDownloads();
  options.documentStage?.set("verifying");
  t247Event(logger, t247Id, "ZIP_BUILD_START");
  removeInvalidCanonicalZip(documentsDir);

  const canonical = await ensureCanonicalTenderArchive({
    tenderDir: tenderFolder,
    documentsDir,
    sourceTenderId: t247Id,
    logger,
  });
  let canonicalZipReady = Boolean(
    canonical.ready &&
      canonical.canonicalZipPath &&
      isValidTenderDocumentsZip(canonical.canonicalZipPath),
  );
  t247Event(logger, t247Id, "ZIP_BUILD_DONE");
  t247Event(logger, t247Id, "ZIP_VERIFY_START");
  if (canonicalZipReady && canonical.canonicalZipPath) {
    allDocumentsPath = canonical.canonicalZipPath;
    allDocumentsDownloaded = true;
    allDocumentsSize = fs.statSync(canonical.canonicalZipPath).size;
    if (documentsStatus === "missing" || documentsStatus === "failed") {
      documentsStatus = "complete";
    }
    logger.info(`T247_CANONICAL_ZIP_CREATED=${canonical.created}`);
    logger.info("T247_CANONICAL_ZIP_VERIFIED=true");
    t247Event(logger, t247Id, "ZIP_VERIFY_OK");
    options.documentStage?.set("success");
  } else {
    logger.info("T247_CANONICAL_ZIP_CREATED=false");
    logger.info("T247_CANONICAL_ZIP_VERIFIED=false");
    t247Event(logger, t247Id, "ZIP_VERIFY_FAILED");
    if (documentsStatus === "complete") {
      documentsStatus =
        individualDocsSuccess > 0 || allDocumentsDownloaded
          ? "partial"
          : downloadAllAttempted
            ? "failed"
            : "unavailable";
    }
    allDocumentsDownloaded = false;
    if (!downloadAllAttempted && documentsStatus === "missing") {
      options.documentStage?.set("unavailable");
    } else if (documentsStatus === "unavailable") {
      options.documentStage?.set("unavailable");
    } else {
      options.documentStage?.set("failed");
    }
  }

  logger.info(`DOWNLOAD_ALL_ATTEMPTED=${downloadAllAttempted}`);
  logger.info(`DOWNLOAD_ALL_SUCCESS=${downloadAllSuccess}`);
  logger.info(`INDIVIDUAL_DOC_FALLBACK_USED=${individualFallbackUsed}`);
  logger.info(`INDIVIDUAL_DOCS_FOUND=${individualDocsFound}`);
  logger.info(`INDIVIDUAL_DOCS_SUCCESS=${individualDocsSuccess}`);
  logger.info(`INDIVIDUAL_DOCS_FAILED=${individualDocsFailed.length}`);
  logger.info(`CANONICAL_ZIP_READY=${canonicalZipReady}`);
  t247Event(
    logger,
    t247Id,
    `DOCUMENTS_DOWNLOAD_MS=${Date.now() - documentsStartedAt}`,
  );

  const disk = inspectTenderArtifactState(tenderFolder, t247Id);
  const aiValid = disk.aiSummaryValid && isValidAiSummaryPdf(disk.aiSummaryPath);
  const aiResult: ArtifactResult = aiValid
    ? { status: "success", path: disk.aiSummaryPath }
    : ai.status === "unavailable" || ai.status === "failed"
      ? {
          status: "unavailable",
          reason:
            ai.status === "unavailable"
              ? "AI Summary not available on the tender page"
              : "AI_Summary.pdf download failed",
        }
      : { status: "retryable_failure", reason: "AI_Summary.pdf missing or invalid on disk" };
  const documentsResult: ArtifactResult = disk.documentsZipValid
    ? { status: "success", path: disk.documentsZipPath }
    : individualDocsFound === 0 && downloadAllAttempted && !downloadAllSuccess
      ? {
          status: "retryable_failure",
          reason: "Download All produced no file and individual fallback found no links",
        }
      : {
          status: "retryable_failure",
          reason: "Tender_All_Documents.zip missing or invalid on disk",
        };

  return {
    aiSummaryPath: aiValid ? disk.aiSummaryPath : ai.path,
    allDocumentsPath: canonicalZipReady ? allDocumentsPath : null,
    aiSummaryDownloaded: aiValid,
    allDocumentsDownloaded: canonicalZipReady && disk.documentsZipValid,
    aiSummarySize: ai.size,
    allDocumentsSize: canonicalZipReady ? allDocumentsSize : 0,
    aiSummarySkipped: Boolean(options.skipAiSummary),
    allDocumentsSkipped,
    aiSummaryStatus: aiValid ? "complete" : ai.status,
    documentsStatus: canonicalZipReady && disk.documentsZipValid
      ? documentsStatus === "partial"
        ? "partial"
        : "complete"
      : documentsStatus === "complete"
        ? "failed"
        : documentsStatus,
    downloadAllAttempted,
    downloadAllSuccess,
    individualFallbackUsed,
    individualDocsFound,
    individualDocsSuccess,
    individualDocsFailed,
    canonicalZipReady: canonicalZipReady && disk.documentsZipValid,
    documentsAttempted: documentsAttempted || downloadAllAttempted || individualFallbackUsed,
    aiResult,
    documentsResult,
  };
}

/** Authoritative documents+AI acquisition; always reaches a terminal document stage. */
export const downloadTenderDocumentsUntilTerminalState =
  downloadRequiredTenderFiles;

async function acquireTenderDocuments(options: {
  detailPage: Page;
  context: BrowserContext;
  tenderFolder: string;
  documentsDir: string;
  t247Id: string;
  timeoutMs: number;
  logger: Logger;
}): Promise<{
  path: string | null;
  status: RequiredDownloadResult["documentsStatus"];
  downloadAllAttempted: boolean;
  downloadAllSuccess: boolean;
  individualFallbackUsed: boolean;
  individualDocsFound: number;
  individualDocsSuccess: number;
  individualDocsFailed: string[];
}> {
  const { detailPage, context, tenderFolder, documentsDir, t247Id, timeoutMs, logger } =
    options;
  logger.info("DOCUMENT_DOWNLOAD_START");
  logger.info(`TENDER247_DOCUMENT_DOWNLOAD_START=T247-${t247Id}`);
  logger.info(`T247_DOWNLOAD_ALL_DOCUMENTS_START=${t247Id}`);
  await verifyCurrentTenderId(detailPage, t247Id, logger);

  const sectionFound = await locateTenderDocumentsSection(detailPage, logger);
  if (!sectionFound) {
    logger.info("T247_TENDER_DOCUMENTS_SECTION_FOUND=false");
  }

  writeInterimEvidenceState(tenderFolder, {
    t247Id,
    metadata: { attempted: true, available: false, status: "processing" },
    aiSummary: { attempted: true, available: false, status: "processing" },
    documents: {
      attempted: true,
      available: false,
      status: "processing",
      downloadAllAttempted: true,
      individualFallbackUsed: false,
    },
    evidenceMode: "PARTIAL",
    artifactTransactionComplete: false,
    updatedAt: new Date().toISOString(),
  });

  let downloadAllAttempted = false;
  let downloadAllSuccess = false;
  const allResult = await downloadAllDocumentsOnce({
    detailPage,
    context,
    documentsDir,
    t247Id,
    timeoutMs,
    logger,
  });
  downloadAllAttempted = allResult.attempted;
  downloadAllSuccess = Boolean(allResult.path) && isValidArtifact(allResult.path);
  logger.info(`T247_DOWNLOAD_ALL_FOUND=${allResult.controlFound}`);
  logger.info(`T247_DOWNLOAD_ALL_DOCUMENTS_FOUND=${allResult.controlFound}`);
  logger.info(`T247_DOWNLOAD_ALL_COMPLETED=${downloadAllSuccess}`);
  logger.info(`T247_DOWNLOAD_ALL_DOCUMENTS_SUCCESS=${downloadAllSuccess}`);
  if (allResult.failureKind) {
    logger.info(`T247_DOWNLOAD_ALL_FAILURE_KIND=${allResult.failureKind}`);
  }
  if (
    allResult.failureKind === "DOCUMENT_NOT_AVAILABLE" ||
    (allResult.failureKind === "PORTAL_ALERT" &&
      (allResult.responseStatus ?? 0) >= 500)
  ) {
    logger.info(
      `T247_DOCUMENTS_TERMINAL_UNAVAILABLE id=${t247Id} kind=${allResult.failureKind} — closing tender and advancing`,
    );
    return {
      path: null,
      status: "unavailable",
      downloadAllAttempted,
      downloadAllSuccess: false,
      individualFallbackUsed: false,
      individualDocsFound: 0,
      individualDocsSuccess: 0,
      individualDocsFailed: [],
    };
  }

  if (downloadAllSuccess && allResult.path) {
    return {
      path: allResult.path,
      status: "complete",
      downloadAllAttempted,
      downloadAllSuccess,
      individualFallbackUsed: false,
      individualDocsFound: 0,
      individualDocsSuccess: 0,
      individualDocsFailed: [],
    };
  }

  logger.info("T247_DOWNLOAD_ALL_COMPLETED=false");
  logger.info("T247_DOCUMENT_FALLBACK_START=true");
  logger.info("T247_INDIVIDUAL_DOCUMENT_FALLBACK=true");
  const individual = await downloadIndividualDocumentsOnce({
    detailPage,
    context,
    documentsDir,
    t247Id,
    timeoutMs,
    logger,
  });

  const status: RequiredDownloadResult["documentsStatus"] =
    individual.successCount === 0
      ? "failed"
      : individual.failed.length > 0
        ? "partial"
        : "complete";

  return {
    path: individual.savedPaths[0] ?? allResult.path,
    status,
    downloadAllAttempted,
    downloadAllSuccess,
    individualFallbackUsed: true,
    individualDocsFound: individual.found,
    individualDocsSuccess: individual.successCount,
    individualDocsFailed: individual.failed,
  };
}

const DOWNLOAD_ALL_PHRASE = /download\s+all\s+documents/i;

function normalizeControlLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isDownloadAllDocumentsLabel(text: string): boolean {
  const normalized = normalizeControlLabel(text);
  if (!DOWNLOAD_ALL_PHRASE.test(normalized)) return false;
  // Parent cards also contain this phrase plus NIT rows — those are not the control.
  if (normalized.length > 80) return false;
  if (/\bnit\b|tender\s*document\s*\d+/i.test(normalized)) return false;
  return true;
}

async function tenderDocumentsHeader(scope: Page | Frame): Promise<Locator | null> {
  const heading = scope.getByRole("heading", { name: /Tender\s*Documents/i }).first();
  if ((await heading.count().catch(() => 0)) > 0) return heading;
  const accordion = scope.getByRole("button", { name: /Tender\s*Documents/i }).first();
  if ((await accordion.count().catch(() => 0)) > 0) return accordion;
  const labeled = scope.getByText("Tender Documents", { exact: true }).first();
  if ((await labeled.count().catch(() => 0)) > 0) return labeled;
  return null;
}

export async function locateTenderDocumentsSection(
  page: Page,
  logger: { info: (msg: string) => void },
): Promise<boolean> {
  // Headed runs sometimes leave browser zoom <100% so controls look "stuck"
  // off-layout — reset before scrolling the documents accordion into view.
  await page
    .evaluate(() => {
      const root = document.documentElement as HTMLElement & { style: CSSStyleDeclaration };
      const body = document.body as HTMLElement & { style: CSSStyleDeclaration };
      root.style.zoom = "1";
      body.style.zoom = "1";
    })
    .catch(() => undefined);
  try {
    const size = page.viewportSize();
    if (!size || size.width < 1200 || size.height < 800) {
      await page.setViewportSize({ width: 1400, height: 900 });
    }
  } catch {
    /* viewport may be null in some contexts */
  }

  if (!/#tenderdocuments/i.test(page.url())) {
    await page
      .evaluate(() => {
        location.hash = "tenderdocuments";
      })
      .catch(() => undefined);
    await page.waitForTimeout(300).catch(() => undefined);
  }

  const header = await tenderDocumentsHeader(page);
  if (!header) {
    return false;
  }

  await header
    .evaluate((el) => {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    })
    .catch(() => undefined);
  await header.scrollIntoViewIfNeeded().catch(() => undefined);
  const downloadAll = page.getByText(DOWNLOAD_ALL_PHRASE).first();
  const alreadyVisible = await downloadAll.isVisible().catch(() => false);
  if (!alreadyVisible) {
    const expanded = await header.getAttribute("aria-expanded").catch(() => null);
    if (expanded !== "true") {
      await header.click({ timeout: 5_000 }).catch(() => undefined);
    }
    await downloadAll
      .evaluate((el) => {
        el.scrollIntoView({ block: "center", inline: "nearest" });
      })
      .catch(() => undefined);
    await downloadAll.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
  }
  logger.info("T247_TENDER_DOCUMENTS_SECTION_FOUND=true");
  return true;
}

async function probeTenderDocumentListCount(options: {
  detailPage: Page;
  context: BrowserContext;
  t247Id: string;
  logger: Logger;
}): Promise<number | null> {
  const route = parseTender247DetailRoute(options.detailPage.url());
  const securityCode = route?.securityCode;
  if (!securityCode) return null;
  try {
    const envelope = await postJson<unknown>(
      options.context.request,
      tenderDocumentListUrl(options.t247Id),
      { guest_user_id: 0, security_code: securityCode, ip: "" },
      options.logger,
    );
    const data = envelope.Data as unknown;
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === "object") {
      const rows =
        (data as { documents?: unknown }).documents ??
        (data as { DocumentList?: unknown }).DocumentList ??
        (data as { list?: unknown }).list;
      if (Array.isArray(rows)) return rows.length;
    }
    return null;
  } catch (error) {
    options.logger.warn(
      `T247_DOCUMENT_LIST_PROBE_FAILED=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

async function downloadAllDocumentsOnce(options: {
  detailPage: Page;
  context: BrowserContext;
  documentsDir: string;
  t247Id: string;
  timeoutMs: number;
  logger: Logger;
}): Promise<{
  path: string | null;
  attempted: boolean;
  controlFound: boolean;
  failureKind?: DownloadedFileRecord["failureKind"] | null;
  portalAlert?: string | null;
  responseStatus?: number | null;
  downloadEndpoint?: string | null;
  documentListCount?: number | null;
}> {
  const { detailPage, context, documentsDir, t247Id, timeoutMs, logger } =
    options;
  ensureDir(documentsDir);
  const detailUrl = detailPage.url();
  const isGlobal = tender247RegionFromUrl(detailUrl) === "GLOBAL";
  const route = parseTender247DetailRoute(detailUrl);
  if (isGlobal) {
    logger.info(
      `GLOBAL_DOWNLOAD_START id=${t247Id} url=${detailUrl} securityCode=${route?.securityCode || "missing"}`,
    );
    console.log(`GLOBAL_DOWNLOAD_START id=${t247Id}`);
  }

  const documentListCount = await probeTenderDocumentListCount({
    detailPage,
    context,
    t247Id,
    logger,
  });
  if (documentListCount != null) {
    logger.info(`T247_DOCUMENT_LIST_COUNT=${documentListCount}`);
  }
  // Global document-list API often returns [] even when "Download All Documents"
  // works in the UI (manual click succeeds). Never skip the UI click for count=0.
  if (documentListCount === 0) {
    logger.warn(
      `T247_DOCUMENT_LIST_EMPTY_HINT id=${t247Id} — still attempting Download All via UI`,
    );
  }

  let sessionRetried = false;
  for (let attempt = 1; attempt <= ARTIFACT_ATTEMPTS; attempt += 1) {
    try {
      removeInvalidAllDocumentsArtifacts(documentsDir);
      removeInvalidCanonicalZip(documentsDir);
      if (isCanonicalDocumentsZipReady(documentsDir)) {
        return {
          path: canonicalZipPath(documentsDir),
          attempted: true,
          controlFound: true,
          documentListCount,
        };
      }

      await verifyCurrentTenderId(detailPage, t247Id, logger);
      await locateTenderDocumentsSection(detailPage, logger);
      const control = await findDownloadAllDocumentsControl(detailPage);
      if (!control) {
        logger.info("T247_DOWNLOAD_ALL_FOUND=false");
        if (attempt < ARTIFACT_ATTEMPTS) {
          await detailPage
            .waitForTimeout(1500 * attempt)
            .catch(() => undefined);
          continue;
        }
        t247Event(logger, t247Id, "DOWNLOAD_ALL_NOT_AVAILABLE");
        if (isGlobal) {
          logger.info(
            `GLOBAL_DOCUMENT_NOT_AVAILABLE id=${t247Id} reason=download_all_control_missing`,
          );
        }
        return {
          path: null,
          attempted: true,
          controlFound: false,
          failureKind: "DOCUMENT_NOT_AVAILABLE",
          documentListCount,
        };
      }

      logger.info("T247_DOWNLOAD_ALL_FOUND=true");
      logger.info(`T247_DOWNLOAD_ALL_ATTEMPT=${attempt}`);
      t247Event(logger, t247Id, "DOWNLOAD_ALL_LOCATING");
      if (isGlobal) {
        logger.info(
          `GLOBAL_DOWNLOAD_BUTTON_FOUND id=${t247Id} attempt=${attempt}`,
        );
      }
      await control
        .evaluate((el) => {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        })
        .catch(() => undefined);
      await control.scrollIntoViewIfNeeded().catch(() => undefined);
      await control.waitFor({ state: "visible", timeout: 15_000 });

      const record = await clickAndSaveDownload({
        page: detailPage,
        context,
        clickTarget: async () => {
          await control
            .evaluate((el) => {
              el.scrollIntoView({ block: "center", inline: "nearest" });
            })
            .catch(() => undefined);
          await control.scrollIntoViewIfNeeded().catch(() => undefined);
          // force:true helps when zoom/layout leaves the control barely hit-testable
          await control.click({ timeout: 15_000, force: true });
        },
        destinationDir: documentsDir,
        preferredBaseName: "Tender_All_Documents",
        timeoutMs,
        logger,
        kind: "document",
        linkText: "Download All Documents",
        t247Id,
        capturePortalFailures: true,
      });

      if (record.status !== "success" || !record.finalFilename) {
        const failureKind =
          record.failureKind ||
          classifyDocumentDownloadFailure({
            portalAlert: record.portalAlert,
            error: record.error,
            responseStatus: record.responseStatus,
            downloadEndpoint: record.downloadEndpoint,
          });
        if (isGlobal) {
          logger.warn(
            `GLOBAL_DOWNLOAD_FAILED id=${t247Id} attempt=${attempt} kind=${failureKind} status=${record.responseStatus ?? "n/a"} endpoint=${(record.downloadEndpoint || "").slice(0, 180)} error=${(record.error || "").slice(0, 180)}`,
          );
        }

        if (
          failureKind === "AUTH_SESSION" &&
          !sessionRetried
        ) {
          sessionRetried = true;
          logger.warn(
            `T247_DOWNLOAD_SESSION_REFRESH id=${t247Id} attempt=${attempt}`,
          );
          await detailPage
            .reload({ waitUntil: "domcontentloaded", timeout: timeoutMs })
            .catch(() => undefined);
          await dismissTender247Interruptions(detailPage, logger).catch(
            () => undefined,
          );
          continue;
        }

        if (
          failureKind === "DOCUMENT_NOT_AVAILABLE" ||
          (failureKind === "PORTAL_ALERT" &&
            (record.responseStatus ?? 0) >= 500)
        ) {
          if (isGlobal) {
            logger.info(
              `GLOBAL_DOCUMENT_NOT_AVAILABLE id=${t247Id} reason=portal_http_${record.responseStatus ?? "alert"} — advance to next tender`,
            );
          }
          t247Event(logger, t247Id, "DOCUMENT_NOT_AVAILABLE");
          return {
            path: null,
            attempted: true,
            controlFound: true,
            failureKind: "DOCUMENT_NOT_AVAILABLE",
            portalAlert: record.portalAlert,
            responseStatus: record.responseStatus,
            downloadEndpoint: record.downloadEndpoint,
            documentListCount,
          };
        }

        throw Object.assign(
          new Error(record.error || "Download All Documents failed"),
          {
            failureKind,
            portalAlert: record.portalAlert,
            responseStatus: record.responseStatus,
            downloadEndpoint: record.downloadEndpoint,
          },
        );
      }

      // Click is not success — require valid non-empty file.
      logger.info("T247_DOWNLOAD_ALL_EVENT_RECEIVED=true");
      const canonicalPath = path.join(documentsDir, record.finalFilename);
      const size = record.sizeBytes || 0;
      if (!isValidArtifact(canonicalPath) || size <= 0) {
        throw new Error("Download All Documents file empty after save");
      }
      logger.info(`T247_DOWNLOAD_ALL_COMPLETED=true`);
      logger.info(
        `T247_DOWNLOAD_ALL_FILE filename=${record.finalFilename} size=${size}`,
      );
      if (isGlobal) {
        logger.info(
          `GLOBAL_DOWNLOAD_SUCCESS id=${t247Id} filename=${record.finalFilename} size=${size} url=${detailUrl}`,
        );
      }
      return {
        path: canonicalPath,
        attempted: true,
        controlFound: true,
        documentListCount,
        responseStatus: record.responseStatus,
        downloadEndpoint: record.downloadEndpoint,
      };
    } catch (error) {
      if (
        error instanceof AutomationError &&
        error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
      ) {
        throw error;
      }
      const errObj = error as {
        message?: string;
        failureKind?: DownloadedFileRecord["failureKind"];
        portalAlert?: string | null;
        responseStatus?: number | null;
        downloadEndpoint?: string | null;
      };
      const failureKind =
        errObj.failureKind ||
        classifyDocumentDownloadFailure({
          portalAlert: errObj.portalAlert,
          error: errObj.message || String(error),
          responseStatus: errObj.responseStatus,
          downloadEndpoint: errObj.downloadEndpoint,
        });
      logger.warn(
        `Download All Documents attempt ${attempt}/${ARTIFACT_ATTEMPTS}: ${
          error instanceof Error ? error.message : String(error)
        } kind=${failureKind}`,
      );
      logger.info("T247_DOWNLOAD_ALL_NO_EVENT_OR_SAVE_FAILED=true");
      if (isGlobal) {
        logger.warn(
          `GLOBAL_DOWNLOAD_FAILED id=${t247Id} attempt=${attempt} kind=${failureKind}`,
        );
      }

      if (
        failureKind === "DOCUMENT_NOT_AVAILABLE" ||
        (failureKind === "PORTAL_ALERT" &&
          (errObj.responseStatus ?? 0) >= 500)
      ) {
        if (isGlobal) {
          logger.info(
            `GLOBAL_DOCUMENT_NOT_AVAILABLE id=${t247Id} reason=portal_http_${errObj.responseStatus ?? "alert"} — advance to next tender`,
          );
        }
        t247Event(logger, t247Id, "DOCUMENT_NOT_AVAILABLE");
        return {
          path: null,
          attempted: true,
          controlFound: true,
          failureKind: "DOCUMENT_NOT_AVAILABLE",
          portalAlert: errObj.portalAlert ?? null,
          responseStatus: errObj.responseStatus ?? null,
          downloadEndpoint: errObj.downloadEndpoint ?? null,
          documentListCount,
        };
      }

      if (
        failureKind === "AUTH_SESSION" &&
        !sessionRetried
      ) {
        sessionRetried = true;
        logger.warn(`T247_DOWNLOAD_SESSION_REFRESH id=${t247Id}`);
        // Soft navigate reload of detail to refresh cookies.
        await detailPage
          .reload({ waitUntil: "domcontentloaded", timeout: timeoutMs })
          .catch(() => undefined);
        await dismissTender247Interruptions(detailPage, logger).catch(
          () => undefined,
        );
      }

      await dismissTender247Interruptions(detailPage, logger).catch((err) => {
        if (
          err instanceof AutomationError &&
          err.code === "TENDER247_REMINDER_MODAL_BLOCKING"
        ) {
          throw err;
        }
      });
      if (attempt >= ARTIFACT_ATTEMPTS) {
        // DOCUMENT_NOT_AVAILABLE already returned above; remaining kinds retry out.
        const finalKind =
          documentListCount === 0
            ? "DOCUMENT_NOT_AVAILABLE"
            : failureKind === "PORTAL_ALERT"
              ? "TEMPORARY_FAILURE"
              : failureKind;
        if (finalKind === "DOCUMENT_NOT_AVAILABLE" && isGlobal) {
          logger.info(
            `GLOBAL_DOCUMENT_NOT_AVAILABLE id=${t247Id} reason=retries_exhausted`,
          );
          t247Event(logger, t247Id, "DOCUMENT_NOT_AVAILABLE");
        }
        return {
          path: null,
          attempted: true,
          controlFound: true,
          failureKind: finalKind,
          portalAlert: errObj.portalAlert ?? null,
          responseStatus: errObj.responseStatus ?? null,
          downloadEndpoint: errObj.downloadEndpoint ?? null,
          documentListCount,
        };
      }
      const backoffMs = Math.min(12_000, 1500 * 2 ** (attempt - 1));
      await detailPage.waitForTimeout(backoffMs).catch(() => undefined);
    }
  }
  return {
    path: null,
    attempted: true,
    controlFound: false,
    documentListCount,
  };
}

async function controlLabel(locator: Locator): Promise<string> {
  const inner = normalizeControlLabel((await locator.innerText().catch(() => "")) || "");
  if (inner) return inner;
  const text = normalizeControlLabel((await locator.textContent().catch(() => "")) || "");
  if (text) return text;
  const aria = normalizeControlLabel(
    (await locator.getAttribute("aria-label").catch(() => "")) || "",
  );
  if (aria) return aria;
  return normalizeControlLabel((await locator.getAttribute("title").catch(() => "")) || "");
}

export async function findDownloadAllDocumentsControl(
  page: Page,
): Promise<Locator | null> {
  const scopes: Array<Page | Frame> = [page, ...page.frames()];

  for (const scope of scopes) {
    const header = await tenderDocumentsHeader(scope);
    if (header) {
      await header.scrollIntoViewIfNeeded().catch(() => undefined);
    }

    const groups = [
      scope.getByRole("link", { name: DOWNLOAD_ALL_PHRASE }),
      scope.getByRole("button", { name: DOWNLOAD_ALL_PHRASE }),
      scope.getByText("Download All Documents", { exact: true }),
      scope.getByText(DOWNLOAD_ALL_PHRASE),
      scope.locator("a, button, [role='link'], [role='button'], u, span").filter({
        hasText: DOWNLOAD_ALL_PHRASE,
      }),
    ];

    for (const group of groups) {
      const count = await group.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const locator = group.nth(i);
        const label = await controlLabel(locator);
        if (!isDownloadAllDocumentsLabel(label)) continue;
        await locator.scrollIntoViewIfNeeded().catch(() => undefined);
        await locator.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
        if (await locator.isVisible().catch(() => false)) {
          return locator;
        }
      }
    }
  }
  return null;
}

async function downloadIndividualDocumentsOnce(options: {
  detailPage: Page;
  context: BrowserContext;
  documentsDir: string;
  t247Id: string;
  timeoutMs: number;
  logger: Logger;
}): Promise<{
  found: number;
  successCount: number;
  failed: string[];
  savedPaths: string[];
}> {
  const { detailPage, context, documentsDir, t247Id, timeoutMs, logger } =
    options;
  const items = await findIndividualDocumentControls(detailPage);
  logger.info(`T247_INDIVIDUAL_DOC_COUNT=${items.length}`);
  logger.info(`INDIVIDUAL_DOCS_FOUND=${items.length}`);
  const failed: string[] = [];
  const savedPaths: string[] = [];
  let successCount = 0;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    logger.info(`T247_DOC_${i + 1}_START`);
    logger.info(`T247_DOCUMENT_ITEM_START=${i}`);
    let saved = false;
    for (let attempt = 1; attempt <= ARTIFACT_ATTEMPTS; attempt += 1) {
      try {
        const baseName = documentBaseNameFromLinkText(item.linkText, i + 1);
        const record = await clickAndSaveDownload({
          page: detailPage,
          context,
          clickTarget: async () => {
            await item.locator.scrollIntoViewIfNeeded().catch(() => undefined);
            await item.locator.click({ timeout: 15_000 });
          },
          destinationDir: documentsDir,
          preferredBaseName: baseName,
          timeoutMs,
          logger,
          kind: "document",
          linkText: item.linkText,
          t247Id,
        });
        if (record.status === "success" && record.finalFilename) {
          const dest = path.join(documentsDir, record.finalFilename);
          if (isValidArtifact(dest)) {
            savedPaths.push(dest);
            successCount += 1;
            saved = true;
            logger.info(`T247_DOC_${i + 1}_SUCCESS`);
            break;
          }
        }
        throw new Error(record.error || "individual document download failed");
      } catch (error) {
        if (
          error instanceof AutomationError &&
          error.code === "TENDER247_REMINDER_MODAL_BLOCKING"
        ) {
          throw error;
        }
        logger.warn(
          `Document "${item.linkText}" attempt ${attempt}/${ARTIFACT_ATTEMPTS}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await dismissTender247Interruptions(detailPage, logger).catch(() => undefined);
        if (attempt >= ARTIFACT_ATTEMPTS) {
          failed.push(item.linkText);
        } else {
          await detailPage.waitForTimeout(800 * attempt).catch(() => undefined);
        }
      }
    }
    logger.info(`T247_DOCUMENT_ITEM_DONE=${i} success=${saved}`);
  }

  return { found: items.length, successCount, failed, savedPaths };
}

export async function findIndividualDocumentControls(
  page: Page,
): Promise<Array<{ linkText: string; locator: Locator }>> {
  const root = await tenderDocumentsCardRoot(page);
  const controls = root.getByRole("link").or(root.getByRole("button"));
  const count = await controls.count().catch(() => 0);
  const items: Array<{ linkText: string; locator: Locator }> = [];

  for (let i = 0; i < count; i += 1) {
    const locator = controls.nth(i);
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    const linkText = normalizeControlLabel(
      (await locator.innerText().catch(() => "")) ||
        (await locator.getAttribute("aria-label").catch(() => "")) ||
        "",
    );
    if (!linkText) continue;
    if (isDownloadAllDocumentsLabel(linkText)) continue;
    if (/ai\s*(generated\s*)?(tender\s*)?summary/i.test(linkText)) continue;
    items.push({ linkText, locator });
  }
  return items;
}

async function tenderDocumentsCardRoot(page: Page): Promise<Locator> {
  const heading = page.getByRole("heading", { name: /Tender\s*Documents/i }).first();
  if ((await heading.count().catch(() => 0)) > 0) {
    let best: Locator | null = null;
    let bestScore = -1;
    for (let depth = 1; depth <= 12; depth += 1) {
      const ancestor = heading
        .locator(
          `xpath=ancestor::*[self::div or self::section or self::article][${depth}]`,
        )
        .first();
      if ((await ancestor.count().catch(() => 0)) === 0) {
        break;
      }
      const text = (await ancestor.innerText().catch(() => "")) || "";
      const linkCount = await ancestor.getByRole("link").count().catch(() => 0);
      const hasDownloadAll = /download\s*all\s*documents/i.test(text);
      const score = (hasDownloadAll ? 100 : 0) + linkCount;
      if (score > bestScore) {
        bestScore = score;
        best = ancestor;
      }
    }
    if (best) {
      return best;
    }
    return heading.locator("xpath=ancestor::*[1]");
  }

  const card = page
    .locator("section, article, div")
    .filter({ hasText: /Tender\s*Documents/i })
    .filter({ has: page.locator("a") })
    .first();
  if ((await card.count().catch(() => 0)) > 0) {
    return card;
  }
  return page.locator("body");
}

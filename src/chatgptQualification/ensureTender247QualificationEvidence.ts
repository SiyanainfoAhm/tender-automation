/**
 * Tender247 GPT qualification evidence — partial evidence allowed.
 * At least one real artifact (metadata, documents, or AI Summary) → GPT ready.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import {
  ensureCanonicalTenderArchive,
  isNonEmptyRegularFile,
  listDocumentSourceFiles,
} from "../tender247Batch/canonicalTenderArchive.js";
import { downloadRequiredTenderFiles } from "../tender247Batch/downloadRequiredTenderFiles.js";
import { resolveTender247Tender } from "../tender247Batch/resolveTender247Tender.js";
import { requestedDateFromDateFolderSafe } from "../tender247Batch/tender247RunContext.js";
import { ensureGptMetadataReady } from "./ensureGptMetadataReady.js";
import { findTenderAllDocumentsZip } from "./readiness.js";
import {
  clearNotReadyManifestEntry,
  clearRecoverableNotReadyState,
} from "./chatgptState.js";
import {
  buildFinalEvidenceState,
  loadEvidenceState,
  writeFinalEvidenceState,
} from "../tender247Batch/tender247EvidenceState.js";

export type QualificationEvidenceMode =
  | "FULL"
  | "STRONG_PARTIAL"
  | "PARTIAL"
  | "NONE";

export type Tender247EvidenceReport = {
  t247Id: string;
  requestedDate: string;
  tenderDir: string;
  metadata: {
    available: boolean;
    path?: string;
    source?: "supabase" | "local_repair";
  };
  documents: {
    available: boolean;
    canonicalZipPath?: string;
    sourceFiles: string[];
  };
  aiSummary: {
    available: boolean;
    path?: string;
    fileName?: string;
  };
  evidenceCount: number;
  evidenceMode: QualificationEvidenceMode;
  readiness: "FULL" | "PARTIAL" | "NONE";
  gptReady: boolean;
  availableFiles: string[];
  missingFiles: string[];
  downloadAttempted: boolean;
  downloadSuccess: boolean;
  metadataRepairAttempted: boolean;
  documentsCreatedLocally: boolean;
  localDocumentCount: number;
  notReadyReason: string | null;
};

export type EvidenceArtifactStatus = {
  attempted: boolean;
  available: boolean;
  status: "complete" | "unavailable" | "failed" | "missing" | "not_attempted";
  path?: string;
};

export type EvidenceStateFile = {
  t247Id?: string;
  metadata: EvidenceArtifactStatus;
  aiSummary: EvidenceArtifactStatus;
  documents: {
    attempted: boolean;
    available: boolean;
    status: "complete" | "unavailable" | "failed" | "missing" | "partial" | "not_attempted";
    path?: string;
    downloadAllAttempted: boolean;
    individualFallbackUsed: boolean;
  };
  evidenceMode: QualificationEvidenceMode;
  availableFiles: string[];
  missingFiles: string[];
  downloadAttempted: boolean;
  downloadSuccess: boolean;
  metadataRepairAttempted: boolean;
  documentsCreatedLocally: boolean;
  localDocumentCount: number;
  evidenceCount: number;
  updatedAt: string;
};

type ReadinessLogger = {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
};

/** Find non-empty AI Summary PDF (supports ChatGPT duplicate suffix variants). */
export function findAiSummaryPdf(tenderDir: string): {
  path: string;
  fileName: string;
} | null {
  if (!fs.existsSync(tenderDir)) return null;
  const candidates = fs
    .readdirSync(tenderDir)
    .filter((name) => /^AI[_\s-]*Summary.*\.pdf$/i.test(name))
    .map((name) => path.join(tenderDir, name))
    .filter((p) => isNonEmptyRegularFile(p));
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs,
  );
  const chosen = candidates[0]!;
  return { path: path.resolve(chosen), fileName: path.basename(chosen) };
}

export function countLocalMeaningfulDocuments(documentsDir: string): number {
  return listDocumentSourceFiles(documentsDir).length;
}

export function loadEvidenceStateFile(
  tenderDir: string,
): EvidenceStateFile | null {
  return loadEvidenceState(tenderDir) as EvidenceStateFile | null;
}

export function saveEvidenceStateFile(
  tenderDir: string,
  report: Tender247EvidenceReport,
  extras?: {
    downloadAllAttempted?: boolean;
    individualFallbackUsed?: boolean;
  },
): void {
  const prior = loadEvidenceState(tenderDir);
  const downloadAllAttempted =
    extras?.downloadAllAttempted ??
    prior?.documents.downloadAllAttempted ??
    false;
  const individualFallbackUsed =
    extras?.individualFallbackUsed ??
    prior?.documents.individualFallbackUsed ??
    false;
  const documentsAttempted =
    prior?.documents.attempted ||
    downloadAllAttempted ||
    individualFallbackUsed ||
    report.documents.available;
  const metadataAttempted =
    prior?.metadata.attempted || report.metadata.available;
  const aiAttempted = prior?.aiSummary.attempted || report.aiSummary.available;

  const merged = buildFinalEvidenceState({
    t247Id: report.t247Id,
    metadataAttempted,
    metadataAvailable: report.metadata.available,
    metadataStatus: report.metadata.available
      ? "complete"
      : metadataAttempted
        ? "failed"
        : "not_attempted",
    aiAttempted,
    aiAvailable: report.aiSummary.available,
    aiStatus: report.aiSummary.available
      ? "complete"
      : aiAttempted
        ? prior?.aiSummary.status === "unavailable"
          ? "unavailable"
          : "failed"
        : "not_attempted",
    aiPath: report.aiSummary.path,
    documentsAttempted,
    documentsAvailable: report.documents.available,
    documentsStatus: report.documents.available
      ? "complete"
      : documentsAttempted
        ? "failed"
        : "not_attempted",
    documentsPath: report.documents.canonicalZipPath,
    downloadAllAttempted,
    downloadAllSuccess: prior?.documents.downloadAllSuccess ?? false,
    individualFallbackUsed,
    individualDocsFound: prior?.individualDocsFound,
    individualDocsSuccess: prior?.individualDocsSuccess,
    individualDocsFailed: prior?.individualDocsFailed,
    canonicalZipReady: prior?.canonicalZipReady,
  });
  writeFinalEvidenceState(tenderDir, merged);
}

function computeEvidenceMode(
  meta: boolean,
  docs: boolean,
  ai: boolean,
): QualificationEvidenceMode {
  if (meta && docs && ai) return "FULL";
  if (meta && docs) return "STRONG_PARTIAL";
  if (meta || docs || ai) return "PARTIAL";
  return "NONE";
}

function logEvidenceReport(report: Tender247EvidenceReport, logger?: ReadinessLogger): void {
  const log = (msg: string) => {
    console.log(msg);
    logger?.info(msg);
  };
  log(`T247_ID=${report.t247Id}`);
  log(`LOCAL_METADATA_AVAILABLE=${report.metadata.available}`);
  log(`SUPABASE_METADATA_AVAILABLE=${report.metadata.source === "supabase" || report.metadata.source === "local_repair"}`);
  log(`LOCAL_DOCUMENT_COUNT=${report.localDocumentCount}`);
  log(`AI_SUMMARY_AVAILABLE=${report.aiSummary.available}`);
  log(`DOCUMENT_DOWNLOAD_ATTEMPTED=${report.downloadAttempted}`);
  log(`DOCUMENT_DOWNLOAD_SUCCESS=${report.downloadSuccess}`);
  log(`METADATA_REPAIR_ATTEMPTED=${report.metadataRepairAttempted}`);
  log(`QUALIFICATION_EVIDENCE_COUNT=${report.evidenceCount}`);
  log(`QUALIFICATION_EVIDENCE_MODE=${report.evidenceMode}`);
  log(`CHATGPT_READY=${report.gptReady}`);
  log(
    `QUALIFICATION_EVIDENCE_AVAILABLE=${JSON.stringify(report.availableFiles)}`,
  );
  log(
    `QUALIFICATION_EVIDENCE_MISSING=${JSON.stringify(report.missingFiles)}`,
  );
}

/**
 * Local inspect + repair. No browser download unless caller passes acquisition options.
 */
export async function ensureTender247QualificationEvidence(options: {
  dateFolder: string;
  t247Id: string;
  logger?: ReadinessLogger;
  /** When true, may attempt one bounded Tender247 document download. */
  attemptDocumentDownload?: boolean;
  browserContext?: BrowserContext;
  listPage?: Page;
  config?: AppConfig;
  fullLogger?: Logger;
}): Promise<Tender247EvidenceReport> {
  const t247Id = String(options.t247Id).replace(/^T247-/i, "");
  const dateFolder = path.resolve(options.dateFolder);
  const requestedDate =
    requestedDateFromDateFolderSafe(dateFolder) || path.basename(dateFolder);
  const tenderDir = path.join(dateFolder, `T247-${t247Id}`);
  const documentsDir = path.join(tenderDir, "documents");
  const logger = options.logger;

  logger?.info(`T247_EVIDENCE_ACQUISITION_START=${t247Id}`);

  const priorState = loadEvidenceStateFile(tenderDir);
  let downloadAttempted = priorState?.downloadAttempted ?? false;
  let downloadSuccess = priorState?.downloadSuccess ?? false;
  let downloadAllAttempted = priorState?.documents?.downloadAllAttempted ?? false;
  let individualFallbackUsed = priorState?.documents?.individualFallbackUsed ?? false;

  let localDocumentCount = countLocalMeaningfulDocuments(documentsDir);

  // --- documents: local ZIP repair first ---
  let archive = await ensureCanonicalTenderArchive({
    tenderDir,
    documentsDir,
    sourceTenderId: t247Id,
    logger,
  });
  localDocumentCount = Math.max(
    localDocumentCount,
    archive.sourceFiles.length,
  );

  const metadataProbe = await ensureGptMetadataReady({
    tenderFolder: tenderDir,
    t247Id,
    logger,
  });
  const aiExisting = findAiSummaryPdf(tenderDir);

  const needsAcquisition =
    options.attemptDocumentDownload === true &&
    (!archive.ready || !aiExisting || !metadataProbe.ready);

  logger?.info(`T247_DOCUMENT_DOWNLOAD_REQUIRED=${needsAcquisition}`);
  logger?.info(
    "T247_ACQUISITION_NO_SHORT_CIRCUIT=true (try metadata + AI summary + documents)",
  );

  if (
    needsAcquisition &&
    options.browserContext &&
    options.listPage &&
    options.config &&
    options.fullLogger
  ) {
    downloadAttempted = true;
    logger?.info("T247_DOCUMENT_DOWNLOAD_ATTEMPT=1");
    try {
      const resolved = await resolveTender247Tender({
        listPage: options.listPage,
        context: options.browserContext,
        tenderId: t247Id,
        config: options.config,
        logger: options.fullLogger,
      });
      const dl = await downloadRequiredTenderFiles({
        detailPage: resolved.detailPage,
        context: options.browserContext,
        tenderFolder: tenderDir,
        t247Id,
        timeoutMs: options.config.downloadTimeoutMs,
        maxRetries: 1,
        logger: options.fullLogger,
        skipAiSummary: Boolean(aiExisting),
        skipAllDocuments: archive.ready,
      });
      downloadSuccess = Boolean(
        dl.allDocumentsDownloaded ||
          dl.canonicalZipReady ||
          dl.individualDocsSuccess > 0,
      );
      downloadAllAttempted = dl.downloadAllAttempted;
      individualFallbackUsed = dl.individualFallbackUsed;
      logger?.info(`T247_DOCUMENT_DOWNLOAD_SUCCESS=${downloadSuccess}`);
      logger?.info(`DOWNLOAD_ALL_ATTEMPTED=${dl.downloadAllAttempted}`);
      logger?.info(`DOWNLOAD_ALL_SUCCESS=${dl.downloadAllSuccess}`);
      logger?.info(`INDIVIDUAL_DOC_FALLBACK_USED=${dl.individualFallbackUsed}`);
      await resolved.detailPage.close().catch(() => undefined);

      archive = await ensureCanonicalTenderArchive({
        tenderDir,
        documentsDir,
        sourceTenderId: t247Id,
        logger,
      });
      localDocumentCount = Math.max(
        countLocalMeaningfulDocuments(documentsDir),
        archive.sourceFiles.length,
      );
    } catch (error) {
      downloadSuccess = false;
      logger?.warn?.(
        `T247_DOCUMENT_DOWNLOAD_FAILED=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const metadata = await ensureGptMetadataReady({
    tenderFolder: tenderDir,
    t247Id,
    logger,
  });

  const aiSummary = findAiSummaryPdf(tenderDir);
  const zipPath = archive.ready
    ? archive.canonicalZipPath || findTenderAllDocumentsZip(tenderDir)
    : findTenderAllDocumentsZip(tenderDir);

  const metaAvailable = metadata.ready;
  const docsAvailable = Boolean(zipPath && isNonEmptyRegularFile(zipPath));
  const aiAvailable = Boolean(aiSummary);

  const evidenceCount =
    (metaAvailable ? 1 : 0) + (docsAvailable ? 1 : 0) + (aiAvailable ? 1 : 0);
  const evidenceMode = computeEvidenceMode(
    metaAvailable,
    docsAvailable,
    aiAvailable,
  );
  const gptReady = evidenceCount >= 1;
  const readiness: Tender247EvidenceReport["readiness"] = gptReady
    ? evidenceMode === "FULL"
      ? "FULL"
      : "PARTIAL"
    : "NONE";

  const availableFiles: string[] = [];
  const missingFiles: string[] = [];
  if (metaAvailable) {
    availableFiles.push("metadata");
  } else {
    missingFiles.push("metadata");
  }
  if (docsAvailable && zipPath) {
    availableFiles.push(path.basename(zipPath));
  } else {
    missingFiles.push("Tender_All_Documents.zip");
  }
  if (aiAvailable && aiSummary) {
    availableFiles.push(aiSummary.fileName);
  } else {
    missingFiles.push("AI_Summary.pdf");
  }

  const report: Tender247EvidenceReport = {
    t247Id,
    requestedDate,
    tenderDir,
    metadata: {
      available: metaAvailable,
      source: metadata.repaired ? "local_repair" : metaAvailable ? "supabase" : undefined,
    },
    documents: {
      available: docsAvailable,
      canonicalZipPath: docsAvailable ? zipPath ?? undefined : undefined,
      sourceFiles: archive.sourceFiles,
    },
    aiSummary: {
      available: aiAvailable,
      path: aiSummary?.path,
      fileName: aiSummary?.fileName,
    },
    evidenceCount,
    evidenceMode,
    readiness,
    gptReady,
    availableFiles,
    missingFiles: gptReady
      ? missingFiles.filter((m) => !availableFiles.some((a) => a.includes(m.replace(/\.pdf|\.zip/i, "")) || m === "metadata" && metaAvailable))
      : missingFiles,
    downloadAttempted,
    downloadSuccess,
    metadataRepairAttempted: metadata.repaired || !metadata.supabaseFound,
    documentsCreatedLocally: archive.created,
    localDocumentCount,
    notReadyReason: gptReady ? null : "NO_USABLE_QUALIFICATION_EVIDENCE",
  };

  // When partial, missingFiles should only list unavailable (not blocking) items
  if (gptReady) {
    report.missingFiles = [];
    if (!metaAvailable) report.missingFiles.push("metadata");
    if (!docsAvailable) report.missingFiles.push("Tender_All_Documents.zip");
    if (!aiAvailable) report.missingFiles.push("AI_Summary.pdf");
  }

  saveEvidenceStateFile(tenderDir, report, {
    downloadAllAttempted,
    individualFallbackUsed,
  });
  logEvidenceReport(report, logger);

  if (gptReady) {
    clearRecoverableNotReadyState(tenderDir);
    clearNotReadyManifestEntry(dateFolder, requestedDate, t247Id);
  }

  return report;
}

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

export type EvidenceStateFile = {
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

const EVIDENCE_STATE_FILE = "qualification-evidence-state.json";

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
  const filePath = path.join(tenderDir, EVIDENCE_STATE_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as EvidenceStateFile;
  } catch {
    return null;
  }
}

export function saveEvidenceStateFile(
  tenderDir: string,
  report: Tender247EvidenceReport,
): void {
  const payload: EvidenceStateFile = {
    evidenceMode: report.evidenceMode,
    availableFiles: report.availableFiles,
    missingFiles: report.missingFiles,
    downloadAttempted: report.downloadAttempted,
    downloadSuccess: report.downloadSuccess,
    metadataRepairAttempted: report.metadataRepairAttempted,
    documentsCreatedLocally: report.documentsCreatedLocally,
    localDocumentCount: report.localDocumentCount,
    evidenceCount: report.evidenceCount,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(tenderDir, EVIDENCE_STATE_FILE),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
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

  const needsDownload =
    options.attemptDocumentDownload === true &&
    !archive.ready &&
    localDocumentCount === 0 &&
    !downloadAttempted;

  logger?.info(`T247_DOCUMENT_DOWNLOAD_REQUIRED=${needsDownload}`);

  if (
    needsDownload &&
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
      const aiExisting = findAiSummaryPdf(tenderDir);
      const dl = await downloadRequiredTenderFiles({
        detailPage: resolved.detailPage,
        context: options.browserContext,
        tenderFolder: tenderDir,
        t247Id,
        timeoutMs: options.config.downloadTimeoutMs,
        maxRetries: options.config.documentDownloadMaxRetries,
        logger: options.fullLogger,
        skipAiSummary: Boolean(aiExisting),
        skipAllDocuments: false,
      });
      downloadSuccess = Boolean(
        dl.allDocumentsDownloaded || dl.allDocumentsSkipped,
      );
      logger?.info(`T247_DOCUMENT_DOWNLOAD_SUCCESS=${downloadSuccess}`);
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

  saveEvidenceStateFile(tenderDir, report);
  logEvidenceReport(report, logger);

  if (gptReady) {
    clearRecoverableNotReadyState(tenderDir);
    clearNotReadyManifestEntry(dateFolder, requestedDate, t247Id);
  }

  return report;
}

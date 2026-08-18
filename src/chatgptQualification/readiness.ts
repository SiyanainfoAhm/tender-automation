import fs from "node:fs";
import path from "node:path";
import { loadManifest } from "../tender247Batch/batchManifest.js";
import { isMetadataResumeReady } from "../tender247Batch/resumeArtifacts.js";
import { materializeTempMetadataJson } from "../supabase/tenderMetadataStore.js";
import {
  isReadableZipArchive as zipLooksLikeZip,
} from "../tender247Batch/canonicalTenderArchive.js";
import {
  ensureTender247QualificationEvidence,
  type Tender247EvidenceReport,
} from "./ensureTender247QualificationEvidence.js";
import {
  inspectTenderArtifactState,
} from "../tender247Batch/tenderArtifactState.js";
import type { GptReadinessReport } from "./types.js";

export { isReadableZipArchive } from "../tender247Batch/canonicalTenderArchive.js";

function isNonEmptyFile(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function isTempOrIncompleteName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".tmp") ||
    lower.endsWith(".download") ||
    lower.endsWith(".crdownload") ||
    lower.endsWith(".part") ||
    lower.includes(".tmp") ||
    /^~\$/.test(name)
  );
}

/** True when file size is stable across a short interval (not still writing). */
export function isFileWriteSettled(
  filePath: string,
  settleMs = 750,
): boolean {
  try {
    if (!isNonEmptyFile(filePath)) {
      return false;
    }
    const size1 = fs.statSync(filePath).size;
    const mtime1 = fs.statSync(filePath).mtimeMs;
    const end = Date.now() + settleMs;
    while (Date.now() < end) {
      // intentional short spin for settle check
    }
    const st2 = fs.statSync(filePath);
    return st2.size === size1 && st2.size > 0 && st2.mtimeMs === mtime1;
  } catch {
    return false;
  }
}

export function isValidMetadataJson(filePath: string): boolean {
  try {
    if (!isNonEmptyFile(filePath)) {
      return false;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Boolean(parsed && typeof parsed === "object");
  } catch {
    return false;
  }
}

/** ZIP exists, size > 0, and central directory / local headers are readable. */
function isReadableZipArchiveLocal(filePath: string): boolean {
  return zipLooksLikeZip(filePath);
}

/**
 * Prefer Tender_All_Documents.zip; else first valid Tender_All_Documents*.zip
 * under documents/. Ignore temps and prefer canonical over _2/_3 when both exist.
 */
export function findTenderAllDocumentsZip(tenderFolder: string): string | null {
  const documentsDir = path.join(tenderFolder, "documents");
  if (!fs.existsSync(documentsDir) || !fs.statSync(documentsDir).isDirectory()) {
    return null;
  }

  const candidates = fs
    .readdirSync(documentsDir)
    .filter((name) => /^Tender_All_Documents.*\.zip$/i.test(name))
    .filter((name) => !isTempOrIncompleteName(name))
    .map((name) => path.join(documentsDir, name))
    .filter((p) => isNonEmptyFile(p) && isReadableZipArchiveLocal(p));

  if (candidates.length === 0) {
    return null;
  }

  const canonical = candidates.find(
    (p) => path.basename(p).toLowerCase() === "tender_all_documents.zip",
  );
  if (canonical) {
    return path.resolve(canonical);
  }

  const withoutDupSuffix = candidates.find(
    (p) => !/_\d+\.zip$/i.test(path.basename(p)),
  );
  if (withoutDupSuffix) {
    return path.resolve(withoutDupSuffix);
  }

  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return path.resolve(candidates[0]!);
}

export interface Phase1UploadFiles {
  metadataPath: string;
  /** null when AI Summary is unavailable */
  aiSummaryPath: string | null;
  documentZipPath: string;
  aiSummaryAvailable: boolean;
  /** Call after ChatGPT upload finishes to remove temporary metadata.json */
  cleanupMetadata?: () => void;
}

export type Phase1ReadinessPrepareResult = {
  t247Id: string;
  requestedDate: string;
  tenderDir: string;
  localDocumentsFound: string[];
  canonicalZipExisted: boolean;
  canonicalZipCreated: boolean;
  metadataSupabaseFound: boolean;
  metadataRepaired: boolean;
  gptReady: boolean;
  evidenceMode: Tender247EvidenceReport["evidenceMode"];
  evidenceCount: number;
  readiness: Tender247EvidenceReport["readiness"];
  availableFiles: string[];
  notReadyReason: string | null;
  missingFiles: string[];
};

type ReadinessLogger = {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

/**
 * Normalize local documents + repair metadata BEFORE declaring NOT_READY.
 * GPT may proceed with partial evidence (metadata, documents, or AI Summary).
 */
export async function preparePhase1TenderReadiness(options: {
  dateFolder: string;
  t247Id: string;
  logger?: ReadinessLogger;
}): Promise<Phase1ReadinessPrepareResult> {
  const evidence = await ensureTender247QualificationEvidence({
    dateFolder: options.dateFolder,
    t247Id: options.t247Id,
    logger: options.logger,
  });

  return {
    t247Id: evidence.t247Id,
    requestedDate: evidence.requestedDate,
    tenderDir: evidence.tenderDir,
    localDocumentsFound: evidence.documents.sourceFiles,
    canonicalZipExisted:
      evidence.documents.available && !evidence.documentsCreatedLocally,
    canonicalZipCreated: evidence.documentsCreatedLocally,
    metadataSupabaseFound: evidence.metadata.available,
    metadataRepaired: evidence.metadataRepairAttempted,
    gptReady: evidence.gptReady,
    evidenceMode: evidence.evidenceMode,
    evidenceCount: evidence.evidenceCount,
    readiness: evidence.readiness,
    availableFiles: evidence.availableFiles,
    notReadyReason: evidence.notReadyReason,
    missingFiles: evidence.gptReady ? evidence.missingFiles : ["NO_USABLE_QUALIFICATION_EVIDENCE"],
  };
}

/**
 * Phase 1 readiness: Supabase/legacy metadata available + Tender_All_Documents*.zip
 * AI_Summary.pdf is optional. Permanent metadata.json is no longer required.
 * Normalizes local PDFs/docs into the canonical ZIP before scoring readiness.
 */
export async function buildGptReadinessReport(
  dateFolder: string,
  dateIso: string,
  logger?: ReadinessLogger,
): Promise<GptReadinessReport> {
  const manifestPath = path.join(dateFolder, "crawl-manifest.json");
  const manifest = loadManifest(manifestPath);

  const expected =
    manifest?.expectedCount && manifest.expectedCount > 0
      ? manifest.expectedCount
      : 0;

  const candidateIds = new Set<string>();
  if (manifest?.tenders) {
    for (const id of Object.keys(manifest.tenders)) {
      candidateIds.add(id);
    }
  }

  if (fs.existsSync(dateFolder)) {
    for (const name of fs.readdirSync(dateFolder)) {
      if (isTempOrIncompleteName(name)) {
        continue;
      }
      const folderMatch = name.match(/^T247-(\d+)$/i);
      if (folderMatch) {
        candidateIds.add(folderMatch[1]!);
        continue;
      }
      const zipMatch = name.match(/^T247-(\d+)\.zip$/i);
      if (zipMatch) {
        candidateIds.add(zipMatch[1]!);
      }
    }
  }

  const readyIds: string[] = [];
  const readyFullIds: string[] = [];
  const readyPartialIds: string[] = [];
  const missingTenderIds: string[] = [];

  for (const id of [...candidateIds].sort()) {
    const prepared = await preparePhase1TenderReadiness({
      dateFolder,
      t247Id: id,
      logger,
    });
    if (prepared.gptReady) {
      const artifacts = inspectTenderArtifactState(
        path.join(dateFolder, `T247-${id}`),
        id,
      );
      if (!artifacts.complete) {
        missingTenderIds.push(id);
        continue;
      }
      readyIds.push(id);
      if (prepared.evidenceMode === "FULL") {
        readyFullIds.push(id);
      } else {
        readyPartialIds.push(id);
      }
    } else {
      missingTenderIds.push(id);
    }
  }

  if (
    expected > readyIds.length &&
    missingTenderIds.length < expected - readyIds.length
  ) {
    const deficit = expected - readyIds.length - missingTenderIds.length;
    for (let i = 0; i < deficit; i += 1) {
      missingTenderIds.push(`unknown-missing-${i + 1}`);
    }
  }

  missingTenderIds.sort();

  return {
    expected,
    ready: readyIds.length,
    readyFull: readyFullIds.length,
    readyPartial: readyPartialIds.length,
    notReadyZeroEvidence: missingTenderIds.length,
    missingTenderIds,
    readyTenderIds: readyIds,
    readyFullTenderIds: readyFullIds,
    readyPartialTenderIds: readyPartialIds,
    readyForQualification:
      expected > 0
        ? readyIds.length === expected
        : readyIds.length > 0 && missingTenderIds.length === 0,
    date: dateIso,
    checkedAt: new Date().toISOString(),
  };
}

export function saveGptReadinessReport(
  dateFolder: string,
  report: GptReadinessReport,
): string {
  const outPath = path.join(dateFolder, "gpt-readiness.json");
  fs.mkdirSync(dateFolder, { recursive: true });
  const publicReport = {
    expected: report.expected,
    ready: report.ready,
    readyFull: report.readyFull,
    readyPartial: report.readyPartial,
    notReadyZeroEvidence: report.notReadyZeroEvidence,
    missingTenderIds: report.missingTenderIds,
    readyTenderIds: report.readyTenderIds,
    readyFullTenderIds: report.readyFullTenderIds,
    readyPartialTenderIds: report.readyPartialTenderIds,
    readyForQualification: report.readyForQualification,
    note: "Ready = at least one usable artifact (metadata, Tender_All_Documents.zip, or AI_Summary.pdf)",
    checkedAt: report.checkedAt,
  };
  fs.writeFileSync(outPath, JSON.stringify(publicReport, null, 2), "utf8");
  return outPath;
}

/**
 * Metadata is ready when the Supabase sync marker (or legacy metadata.json) exists.
 * Does not create a permanent metadata.json.
 */
export function hasMetadataForChatGpt(options: {
  dateFolder: string;
  t247Id: string;
}): boolean {
  const tenderFolder = path.join(options.dateFolder, `T247-${options.t247Id}`);
  return isMetadataResumeReady(tenderFolder);
}

export async function ensureTempMetadataForChatGpt(options: {
  dateFolder: string;
  t247Id: string;
  logger?: { info: (msg: string) => void };
}): Promise<{ metadataPath: string; cleanup: () => void } | null> {
  const { dateFolder, t247Id, logger } = options;
  return materializeTempMetadataJson({
    dateFolder,
    t247Id,
    logger: logger
      ? {
          info: (msg: string) => logger.info(msg),
          error: () => undefined,
          warn: () => undefined,
        }
      : undefined,
  });
}

export function tryResolvePhase1TenderUploadFiles(
  dateFolder: string,
  t247Id: string,
  _logger?: { info: (msg: string) => void },
): Phase1UploadFiles | null {
  const tenderFolder = path.join(dateFolder, `T247-${t247Id}`);
  if (!fs.existsSync(tenderFolder) || !fs.statSync(tenderFolder).isDirectory()) {
    return null;
  }

  if (isTempOrIncompleteName(path.basename(tenderFolder))) {
    return null;
  }

  const artifacts = inspectTenderArtifactState(tenderFolder, t247Id);
  if (!artifacts.complete) {
    return null;
  }

  const documentZipPath = artifacts.documentsZipPath;
  if (!documentZipPath) {
    return null;
  }

  return {
    metadataPath: artifacts.metadataPath,
    aiSummaryPath: artifacts.aiSummaryPath,
    documentZipPath,
    aiSummaryAvailable: true,
  };
}

/** List unavailable evidence (informational when partial-ready). */
export function getMissingPhase1Files(
  dateFolder: string,
  t247Id: string,
): string[] {
  const tenderFolder = path.join(dateFolder, `T247-${t247Id}`);
  const missing: string[] = [];
  const documentZipPath = findTenderAllDocumentsZip(tenderFolder);
  const aiSummary = findAiSummaryPdfLocal(tenderFolder);

  if (!documentZipPath) {
    missing.push("Tender_All_Documents.zip");
  }
  if (!hasMetadataForChatGpt({ dateFolder, t247Id })) {
    missing.push("metadata");
  }
  if (!aiSummary) {
    missing.push("AI_Summary.pdf");
  }
  return missing;
}

function findAiSummaryPdfLocal(tenderDir: string): string | null {
  if (!fs.existsSync(tenderDir)) return null;
  for (const name of fs.readdirSync(tenderDir)) {
    if (/^AI[_\s-]*Summary.*\.pdf$/i.test(name)) {
      const p = path.join(tenderDir, name);
      if (isNonEmptyFile(p)) return p;
    }
  }
  return null;
}

export function hasAnyQualificationEvidence(
  dateFolder: string,
  t247Id: string,
): boolean {
  const tenderFolder = path.join(dateFolder, `T247-${t247Id}`);
  const hasMeta = hasMetadataForChatGpt({ dateFolder, t247Id });
  const hasZip = Boolean(findTenderAllDocumentsZip(tenderFolder));
  const hasAi = Boolean(findAiSummaryPdfLocal(tenderFolder));
  return hasMeta || hasZip || hasAi;
}

/** Normalize artifacts, then list remaining missing Phase-1 files. */
export async function prepareAndGetMissingPhase1Files(
  dateFolder: string,
  t247Id: string,
  logger?: ReadinessLogger,
): Promise<string[]> {
  const prepared = await preparePhase1TenderReadiness({
    dateFolder,
    t247Id,
    logger,
  });
  return prepared.missingFiles;
}

/** All numeric T247 folder IDs under the day folder. */
export function listDownloadedTenderIds(dateFolder: string): string[] {
  if (!fs.existsSync(dateFolder)) {
    return [];
  }
  const ids: string[] = [];
  for (const name of fs.readdirSync(dateFolder)) {
    if (isTempOrIncompleteName(name)) {
      continue;
    }
    const folderMatch = name.match(/^T247-(\d+)$/i);
    if (folderMatch) {
      ids.push(folderMatch[1]!);
    }
  }
  return ids.sort((a, b) => Number(a) - Number(b));
}

/** Resolve Phase-1 upload files, materializing temporary metadata.json from Supabase. */
export async function resolvePhase1TenderUploadFiles(
  dateFolder: string,
  t247Id: string,
  logger?: { info: (msg: string) => void },
): Promise<Phase1UploadFiles> {
  const base = tryResolvePhase1TenderUploadFiles(dateFolder, t247Id, logger);
  if (!base) {
    throw new Error(
      `T247-${t247Id} not ready: need Supabase/legacy metadata and Tender_All_Documents*.zip`,
    );
  }

  const materialized = await ensureTempMetadataForChatGpt({
    dateFolder,
    t247Id,
    logger,
  });
  if (!materialized || !isValidMetadataJson(materialized.metadataPath)) {
    throw new Error(
      `T247-${t247Id} not ready: could not materialize metadata from Supabase`,
    );
  }

  return {
    ...base,
    metadataPath: materialized.metadataPath,
    cleanupMetadata: materialized.cleanup,
  };
}

/**
 * Ready tenders that still need qualification work (no valid completed result).
 */
export function listNewReadyTenderIds(
  dateFolder: string,
  readyTenderIds: string[],
  isComplete: (resultPath: string) => boolean,
): string[] {
  return readyTenderIds.filter((id) => {
    const resultPath = path.join(
      dateFolder,
      `T247-${id}`,
      "qualification-result.json",
    );
    return !isComplete(resultPath);
  });
}

/** Repair canonical ZIP + metadata for selected (or all downloaded) tenders. */
export async function repairDateFolderGptReadiness(options: {
  dateFolder: string;
  t247Ids?: string[];
  logger?: ReadinessLogger;
}): Promise<Phase1ReadinessPrepareResult[]> {
  const ids =
    options.t247Ids && options.t247Ids.length > 0
      ? options.t247Ids
      : listDownloadedTenderIds(options.dateFolder);
  const reports: Phase1ReadinessPrepareResult[] = [];
  for (const id of ids) {
    reports.push(
      await preparePhase1TenderReadiness({
        dateFolder: options.dateFolder,
        t247Id: id,
        logger: options.logger,
      }),
    );
  }
  return reports;
}

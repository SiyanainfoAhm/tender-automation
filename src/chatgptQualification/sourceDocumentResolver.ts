import fs from "node:fs";
import path from "node:path";
import { AutomationError } from "../browserUtils.js";
import {
  materializeTenderMetadata,
  type SourcePortal,
} from "../supabase/materializeTenderMetadata.js";
import { getTenderMetadata } from "../supabase/tenderMetadataStore.js";

export type AttachmentKind = "METADATA" | "AI_SUMMARY" | "DOCUMENT_ARCHIVE";

export type QualificationAttachmentFile = {
  kind: AttachmentKind;
  filePath: string;
  fileName: string;
  required: boolean;
};

export type QualificationAttachmentBundle = {
  sourcePortal: SourcePortal;
  sourceTenderId: string;
  localFolderPath: string;
  files: QualificationAttachmentFile[];
  metadataPath: string;
  documentArchivePath: string;
  aiSummaryPath: string | null;
  uploadFiles: string[];
  aiSummaryAvailable: boolean;
  expectedAttachmentCount: number;
  cleanup: () => void;
};

function isNonEmptyFile(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function assertNonEmptyFile(filePath: string, label: string): void {
  if (!isNonEmptyFile(filePath)) {
    throw new AutomationError(
      "CHATGPT_REQUIRED_ATTACHMENT_MISSING",
      `CHATGPT_REQUIRED_ATTACHMENT_MISSING=${label} path=${filePath}`,
    );
  }
}

function listNonEmptyZips(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((p) => p.toLowerCase().endsWith(".zip") && isNonEmptyFile(p));
}

function readDownloadStateZipName(localFolderPath: string): string | null {
  const statePath = path.join(localFolderPath, "download-state.json");
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      originalZipFile?: string | null;
    };
    return state.originalZipFile ? String(state.originalZipFile).trim() : null;
  } catch {
    return null;
  }
}

function resolveBidassistOriginalZip(
  localFolderPath: string,
  rawMetadata: Record<string, unknown> | null,
): string {
  const originalDir = path.join(localFolderPath, "original");

  const fromMeta =
    rawMetadata && typeof rawMetadata.originalZipFile === "string"
      ? String(rawMetadata.originalZipFile).trim()
      : "";
  if (fromMeta) {
    const candidate = path.isAbsolute(fromMeta)
      ? fromMeta
      : path.join(originalDir, fromMeta);
    if (isNonEmptyFile(candidate)) {
      return path.resolve(candidate);
    }
  }

  const fromState = readDownloadStateZipName(localFolderPath);
  if (fromState) {
    const candidate = path.isAbsolute(fromState)
      ? fromState
      : path.join(originalDir, fromState);
    if (isNonEmptyFile(candidate)) {
      return path.resolve(candidate);
    }
  }

  const zips = listNonEmptyZips(originalDir);
  if (zips.length === 1) {
    return path.resolve(zips[0]!);
  }
  if (zips.length === 0) {
    throw new AutomationError(
      "CHATGPT_REQUIRED_ATTACHMENT_MISSING",
      `CHATGPT_REQUIRED_ATTACHMENT_MISSING=BidAssist original ZIP under ${originalDir}`,
    );
  }
  throw new AutomationError(
    "CHATGPT_REQUIRED_ATTACHMENT_MISSING",
    `Ambiguous BidAssist ZIPs in ${originalDir}: ${zips
      .map((z) => path.basename(z))
      .join(", ")}`,
  );
}

function resolveTender247DocumentZip(localFolderPath: string): string {
  const archivePath = path.join(
    localFolderPath,
    "documents",
    "Tender_All_Documents.zip",
  );
  if (isNonEmptyFile(archivePath)) {
    return path.resolve(archivePath);
  }
  throw new AutomationError(
    "CHATGPT_REQUIRED_ATTACHMENT_MISSING",
    `CHATGPT_REQUIRED_ATTACHMENT_MISSING=Tender_All_Documents.zip path=${archivePath}`,
  );
}

/**
 * Resolve and validate qualification attachments before opening ChatGPT.
 * Temporary metadata.json comes from Supabase only (never the tender folder).
 */
export async function resolveQualificationFiles(
  sourcePortal: SourcePortal,
  sourceTenderId: string,
  localFolderPath: string,
): Promise<QualificationAttachmentBundle> {
  const tempMetadata = await materializeTenderMetadata(
    sourcePortal,
    sourceTenderId,
  );

  try {
    let rawMetadata: Record<string, unknown> | null = null;
    if (sourcePortal === "BIDASSIST") {
      const row = await getTenderMetadata(sourcePortal, sourceTenderId);
      rawMetadata =
        row?.raw_metadata && typeof row.raw_metadata === "object"
          ? (row.raw_metadata as Record<string, unknown>)
          : null;
    }

    const bundle = assembleQualificationAttachmentBundle({
      sourcePortal,
      sourceTenderId,
      localFolderPath,
      metadataPath: tempMetadata.filePath,
      cleanup: tempMetadata.cleanup,
      rawMetadata,
    });

    console.log(
      `CHATGPT_UPLOAD_SOURCE_METADATA=${path.resolve(bundle.metadataPath)}`,
    );
    if (sourcePortal === "TENDER247") {
      if (bundle.aiSummaryPath) {
        console.log(
          `CHATGPT_UPLOAD_SOURCE_AI_SUMMARY=${path.resolve(bundle.aiSummaryPath)}`,
        );
      } else {
        console.log("CHATGPT_UPLOAD_SOURCE_AI_SUMMARY=NOT_AVAILABLE");
      }
    }
    console.log(
      `CHATGPT_UPLOAD_SOURCE_DOCUMENTS=${path.resolve(bundle.documentArchivePath)}`,
    );
    for (const file of bundle.files) {
      console.log(`CHATGPT_UPLOAD_FILE=${file.fileName}`);
    }
    console.log(
      `CHATGPT_EXPECTED_ATTACHMENT_COUNT=${bundle.expectedAttachmentCount}`,
    );

    return bundle;
  } catch (error) {
    tempMetadata.cleanup();
    throw error;
  }
}

/**
 * Build a validated attachment bundle from an already-materialized metadata.json.
 * Used by tests and by resolveQualificationFiles after Supabase materialization.
 */
export function assembleQualificationAttachmentBundle(options: {
  sourcePortal: SourcePortal;
  sourceTenderId: string;
  localFolderPath: string;
  metadataPath: string;
  cleanup: () => void;
  rawMetadata?: Record<string, unknown> | null;
}): QualificationAttachmentBundle {
  const {
    sourcePortal,
    sourceTenderId,
    localFolderPath,
    metadataPath,
    cleanup,
    rawMetadata = null,
  } = options;

  assertNonEmptyFile(metadataPath, "metadata.json");

  const files: QualificationAttachmentFile[] = [
    {
      kind: "METADATA",
      filePath: path.resolve(metadataPath),
      fileName: "metadata.json",
      required: true,
    },
  ];

  let documentArchivePath: string;
  let aiSummaryPath: string | null = null;
  let aiSummaryAvailable = false;

  if (sourcePortal === "TENDER247") {
    documentArchivePath = resolveTender247DocumentZip(localFolderPath);
    assertNonEmptyFile(documentArchivePath, "Tender_All_Documents.zip");

    const aiCandidate = path.join(localFolderPath, "AI_Summary.pdf");
    if (isNonEmptyFile(aiCandidate)) {
      aiSummaryPath = path.resolve(aiCandidate);
      aiSummaryAvailable = true;
      files.push({
        kind: "AI_SUMMARY",
        filePath: aiSummaryPath,
        fileName: "AI_Summary.pdf",
        required: true,
      });
    }

    files.push({
      kind: "DOCUMENT_ARCHIVE",
      filePath: path.resolve(documentArchivePath),
      fileName: path.basename(documentArchivePath),
      required: true,
    });
  } else {
    documentArchivePath = resolveBidassistOriginalZip(
      localFolderPath,
      rawMetadata,
    );
    assertNonEmptyFile(
      documentArchivePath,
      path.basename(documentArchivePath),
    );
    files.push({
      kind: "DOCUMENT_ARCHIVE",
      filePath: path.resolve(documentArchivePath),
      fileName: path.basename(documentArchivePath),
      required: true,
    });
  }

  const uploadFiles = files.map((f) => f.filePath);
  return {
    sourcePortal,
    sourceTenderId,
    localFolderPath: path.resolve(localFolderPath),
    files,
    metadataPath: path.resolve(metadataPath),
    documentArchivePath: path.resolve(documentArchivePath),
    aiSummaryPath,
    uploadFiles,
    aiSummaryAvailable,
    expectedAttachmentCount: uploadFiles.length,
    cleanup,
  };
}

/** ChatGPT display suffixes: (1), (8), (20260812-084008), (20260812-084...). */
export const CHATGPT_CHIP_DISPLAY_SUFFIX_RE = /\([^)]*\)(?=\.[^.]+$)/;

function attachmentChipBasename(chipText: string): string {
  const chip = chipText.replace(/\s+/g, " ").trim();
  return chip.split(/[/\\]/).pop()?.trim() || chip;
}

/** Logical metadata: starts with "metadata" and ends with ".json". */
export function isLogicalMetadataAttachmentName(chipText: string): boolean {
  const base = attachmentChipBasename(chipText);
  return /^metadata/i.test(base) && /\.json$/i.test(base);
}

/** Logical AI Summary: starts with "AI_Summary" (flexible separators) and ends with ".pdf". */
export function isLogicalAiSummaryAttachmentName(chipText: string): boolean {
  const base = attachmentChipBasename(chipText);
  return /^AI[_\s-]*Summary/i.test(base) && /\.pdf$/i.test(base);
}

/** Logical Tender ZIP: starts with "Tender_All_Documents" and ends with ".zip". */
export function isLogicalTenderZipAttachmentName(chipText: string): boolean {
  const base = attachmentChipBasename(chipText);
  return (
    /^Tender[_\s-]*All[_\s-]*Documents/i.test(base) && /\.zip$/i.test(base)
  );
}

/** Match ChatGPT attachment chip names including (1) and timestamped suffixes. */
export function matchesAttachmentChipName(
  chipText: string,
  expectedFileName: string,
): boolean {
  const chip = chipText.replace(/\s+/g, " ").trim();
  const base = expectedFileName.trim();
  if (!chip || !base) {
    return false;
  }

  if (/^metadata\.json$/i.test(base)) {
    return isLogicalMetadataAttachmentName(chip);
  }
  if (/^AI[_\s-]*Summary\.pdf$/i.test(base)) {
    return isLogicalAiSummaryAttachmentName(chip);
  }
  if (/^Tender[_\s-]*All[_\s-]*Documents.*\.zip$/i.test(base)) {
    return isLogicalTenderZipAttachmentName(chip);
  }

  // BidAssist / generic: strip ChatGPT display suffix from chip and compare
  const stripDup = (name: string): string =>
    name.replace(CHATGPT_CHIP_DISPLAY_SUFFIX_RE, "");
  return (
    stripDup(chip).toLowerCase() === stripDup(base).toLowerCase() ||
    new RegExp(
      `^${stripDup(base).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "[\\\\s_-]*")}(?:\\([^)]*\\))?$`,
      "i",
    ).test(chip)
  );
}

export function assertRequiredAttachmentsReady(options: {
  sourcePortal: SourcePortal;
  sourceTenderId: string;
  metadataDetected: boolean;
  tenderArchiveDetected: boolean;
  bidassistArchiveDetected: boolean;
  aiSummaryDetected: boolean;
  aiSummaryRequired: boolean;
}): void {
  const {
    sourcePortal,
    sourceTenderId,
    metadataDetected,
    tenderArchiveDetected,
    bidassistArchiveDetected,
    aiSummaryDetected,
    aiSummaryRequired,
  } = options;

  const requiredAttachmentsReady =
    sourcePortal === "TENDER247"
      ? metadataDetected && tenderArchiveDetected
      : metadataDetected && bidassistArchiveDetected;

  if (!requiredAttachmentsReady) {
    throw new AutomationError(
      "CHATGPT_REQUIRED_ATTACHMENTS_NOT_READY",
      `CHATGPT_REQUIRED_ATTACHMENTS_NOT_READY=${sourcePortal}-${sourceTenderId}`,
    );
  }

  if (sourcePortal === "TENDER247" && aiSummaryRequired && !aiSummaryDetected) {
    throw new AutomationError(
      "CHATGPT_REQUIRED_ATTACHMENTS_NOT_READY",
      `CHATGPT_REQUIRED_ATTACHMENTS_NOT_READY=${sourcePortal}-${sourceTenderId} missing=AI_Summary.pdf`,
    );
  }
}

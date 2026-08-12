import fs from "node:fs";
import path from "node:path";
import { AutomationError } from "../browserUtils.js";
import type { QualificationAttachmentFile } from "./sourceDocumentResolver.js";
import {
  isLogicalAiSummaryAttachmentName,
  isLogicalMetadataAttachmentName,
  isLogicalTenderZipAttachmentName,
  matchesAttachmentChipName,
} from "./sourceDocumentResolver.js";

export const TENDER247_MAX_TOP_LEVEL_ATTACHMENTS = 3;

export type AttachmentManifestEntry = {
  kind: QualificationAttachmentFile["kind"];
  originalLocalPath: string;
  expectedFileName: string;
  sizeBytes: number;
  required: boolean;
};

export type Tender247ExpectedManifest = {
  expectedCount: number;
  expectedPaths: string[];
  entries: AttachmentManifestEntry[];
  aiSummaryRequired: boolean;
};

export type AttachmentManifestFileAudit = {
  originalLocalPath: string;
  displayedChatGptFilename: string | null;
  sizeBytes: number;
  required: boolean;
  uploaded: boolean;
  verifiedVisible: boolean;
};

export type AttachmentManifestAudit = {
  sourcePortal: "TENDER247";
  sourceTenderId: string;
  expectedCount: number;
  visibleCount: number;
  filesAssignedCount: number;
  uploadLimitWarningSeen: boolean;
  staleAttachmentsFound: number;
  staleAttachmentsCleared: boolean;
  validationPassed: boolean;
  sendBlocked: boolean;
  files: AttachmentManifestFileAudit[];
  failureReason?: string;
};

export function buildTender247ExpectedManifest(
  files: QualificationAttachmentFile[],
): Tender247ExpectedManifest {
  const entries: AttachmentManifestEntry[] = files.map((file) => {
    const absolute = path.resolve(file.filePath);
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(absolute).size;
    } catch {
      sizeBytes = 0;
    }
    return {
      kind: file.kind,
      originalLocalPath: absolute,
      expectedFileName: file.fileName,
      sizeBytes,
      required: file.required,
    };
  });

  const aiSummaryRequired = entries.some((e) => e.kind === "AI_SUMMARY");
  return {
    expectedCount: entries.length,
    expectedPaths: entries.map((e) => e.originalLocalPath),
    entries,
    aiSummaryRequired,
  };
}

export function logTender247ExpectedManifest(
  manifest: Tender247ExpectedManifest,
  log: (message: string) => void,
): void {
  log(`CHATGPT_EXPECTED_ATTACHMENT_COUNT=${manifest.expectedCount}`);
  manifest.entries.forEach((entry, index) => {
    log(`CHATGPT_EXPECTED_ATTACHMENT_${index + 1}=${entry.expectedFileName}`);
  });
}

/** Hard abort when Tender247 would upload more than three top-level files. */
export function assertTender247AttachmentCountSafe(
  manifest: Tender247ExpectedManifest,
  sourceTenderId: string,
): void {
  if (manifest.expectedCount > TENDER247_MAX_TOP_LEVEL_ATTACHMENTS) {
    throw new AutomationError(
      "CHATGPT_ATTACHMENT_SET_INVALID",
      `CHATGPT_ATTACHMENT_SET_INVALID=true CHATGPT_ATTACHMENT_COUNT=${manifest.expectedCount} tender=T247-${sourceTenderId}`,
    );
  }
}

/**
 * Reject extracted ZIP contents or other nested document files.
 * Tender247 uploads only metadata.json, optional AI_Summary.pdf, and Tender_All_Documents.zip.
 */
export function assertTender247UploadPathsTopLevelOnly(filePaths: string[]): void {
  for (const filePath of filePaths) {
    const normalized = path.resolve(filePath).replace(/\\/g, "/");
    const base = path.basename(normalized);

    if (/\/documents\/extracted\//i.test(normalized)) {
      throw new AutomationError(
        "CHATGPT_ATTACHMENT_SET_INVALID",
        `ZIP contents must not be uploaded individually: ${base}`,
      );
    }

    if (/\/documents\//i.test(normalized) && !/^Tender_All_Documents/i.test(base)) {
      throw new AutomationError(
        "CHATGPT_ATTACHMENT_SET_INVALID",
        `Individual documents must not be uploaded; use Tender_All_Documents.zip: ${base}`,
      );
    }

    if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
      throw new AutomationError(
        "CHATGPT_ATTACHMENT_SET_INVALID",
        `Directories must not be assigned to the upload input: ${normalized}`,
      );
    }
  }
}

export function filterAttachmentChipCandidates(candidates: string[]): string[] {
  return candidates.filter((value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }
    if (/^remove file\b/i.test(trimmed)) {
      return false;
    }
    if (/^delete file\b/i.test(trimmed)) {
      return false;
    }
    return true;
  });
}

export type DisplayedAttachmentValidation = {
  ok: boolean;
  visibleCount: number;
  metadataCount: number;
  aiSummaryCount: number;
  archiveCount: number;
  failureReason?: string;
};

/** Verify each required attachment appears exactly once in visible chip names. */
export function validateDisplayedAttachmentNames(options: {
  manifest: Tender247ExpectedManifest;
  displayedNames: string[];
}): DisplayedAttachmentValidation {
  const { manifest, displayedNames } = options;
  const chips = filterAttachmentChipCandidates(displayedNames);

  // Logical types — accept timestamped/suffixed display names (not exact basenames).
  const metadataCount = chips.filter((chip) =>
    isLogicalMetadataAttachmentName(chip),
  ).length;
  const aiSummaryCount = chips.filter((chip) =>
    isLogicalAiSummaryAttachmentName(chip),
  ).length;
  const archiveCount = chips.filter((chip) =>
    isLogicalTenderZipAttachmentName(chip),
  ).length;

  const requiredVisible =
    metadataCount +
    (manifest.aiSummaryRequired ? aiSummaryCount : 0) +
    archiveCount;

  if (metadataCount !== 1) {
    return {
      ok: false,
      visibleCount: requiredVisible,
      metadataCount,
      aiSummaryCount,
      archiveCount,
      failureReason:
        metadataCount === 0
          ? "metadata_missing"
          : "duplicate_metadata",
    };
  }

  if (manifest.aiSummaryRequired && aiSummaryCount !== 1) {
    return {
      ok: false,
      visibleCount: requiredVisible,
      metadataCount,
      aiSummaryCount,
      archiveCount,
      failureReason:
        aiSummaryCount === 0
          ? "ai_summary_missing"
          : "duplicate_ai_summary",
    };
  }

  if (!manifest.aiSummaryRequired && aiSummaryCount > 0) {
    return {
      ok: false,
      visibleCount: requiredVisible,
      metadataCount,
      aiSummaryCount,
      archiveCount,
      failureReason: "unexpected_ai_summary",
    };
  }

  if (archiveCount !== 1) {
    return {
      ok: false,
      visibleCount: requiredVisible,
      metadataCount,
      aiSummaryCount,
      archiveCount,
      failureReason:
        archiveCount === 0 ? "archive_missing" : "duplicate_archive",
    };
  }

  if (requiredVisible !== manifest.expectedCount) {
    return {
      ok: false,
      visibleCount: requiredVisible,
      metadataCount,
      aiSummaryCount,
      archiveCount,
      failureReason: "visible_count_mismatch",
    };
  }

  return {
    ok: true,
    visibleCount: requiredVisible,
    metadataCount,
    aiSummaryCount,
    archiveCount,
  };
}

export function buildAttachmentManifestAudit(options: {
  manifest: Tender247ExpectedManifest;
  sourceTenderId: string;
  displayedNames: string[];
  filesAssignedCount: number;
  uploadLimitWarningSeen: boolean;
  staleAttachmentsFound: number;
  staleAttachmentsCleared: boolean;
  validation: DisplayedAttachmentValidation;
  sendBlocked: boolean;
}): AttachmentManifestAudit {
  const chips = filterAttachmentChipCandidates(options.displayedNames);

  const findDisplayed = (expectedFileName: string): string | null => {
    const match = chips.find((chip) =>
      matchesAttachmentChipName(chip, expectedFileName),
    );
    return match ?? null;
  };

  const files: AttachmentManifestFileAudit[] = options.manifest.entries.map(
    (entry) => {
      const displayed = findDisplayed(entry.expectedFileName);
      return {
        originalLocalPath: entry.originalLocalPath,
        displayedChatGptFilename: displayed,
        sizeBytes: entry.sizeBytes,
        required: entry.required,
        uploaded: options.filesAssignedCount > 0,
        verifiedVisible: Boolean(displayed),
      };
    },
  );

  return {
    sourcePortal: "TENDER247",
    sourceTenderId: options.sourceTenderId,
    expectedCount: options.manifest.expectedCount,
    visibleCount: options.validation.visibleCount,
    filesAssignedCount: options.filesAssignedCount,
    uploadLimitWarningSeen: options.uploadLimitWarningSeen,
    staleAttachmentsFound: options.staleAttachmentsFound,
    staleAttachmentsCleared: options.staleAttachmentsCleared,
    validationPassed: options.validation.ok && !options.sendBlocked,
    sendBlocked: options.sendBlocked,
    files,
    failureReason: options.validation.failureReason,
  };
}

export function assertTender247AttachmentValidationPassed(options: {
  manifest: Tender247ExpectedManifest;
  validation: DisplayedAttachmentValidation;
  uploadLimitWarningSeen: boolean;
  sourceTenderId: string;
}): void {
  if (options.uploadLimitWarningSeen) {
    throw new AutomationError(
      "CHATGPT_UPLOAD_LIMIT_WARNING",
      `CHATGPT_UPLOAD_LIMIT_WARNING=true CHATGPT_ATTACHMENT_VALIDATION_FAILED=true CHATGPT_SEND_BLOCKED=true tender=T247-${options.sourceTenderId}`,
    );
  }

  if (!options.validation.ok) {
    throw new AutomationError(
      "CHATGPT_ATTACHMENT_VALIDATION_FAILED",
      `CHATGPT_ATTACHMENT_VALIDATION_FAILED=true CHATGPT_SEND_BLOCKED=true expected=${options.manifest.expectedCount} visible=${options.validation.visibleCount} reason=${options.validation.failureReason || "unknown"} tender=T247-${options.sourceTenderId}`,
    );
  }

  if (options.validation.visibleCount !== options.manifest.expectedCount) {
    throw new AutomationError(
      "CHATGPT_ATTACHMENT_VALIDATION_FAILED",
      `CHATGPT_ATTACHMENT_VALIDATION_FAILED=true CHATGPT_SEND_BLOCKED=true expected=${options.manifest.expectedCount} visible=${options.validation.visibleCount} tender=T247-${options.sourceTenderId}`,
    );
  }
}

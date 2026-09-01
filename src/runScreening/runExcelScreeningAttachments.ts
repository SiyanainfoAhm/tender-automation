/**
 * Daily Excel screening upload manifest, local validation, and composer attachment checks.
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { AutomationError } from "../browserUtils.js";
import type { Logger } from "../logger.js";

function normalizeComposerBasename(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\([^)]*\)(?=\.[^.]+$)/, "")
    .toLowerCase();
}

export type ScreeningUploadStatus =
  | "selected"
  | "uploading"
  | "uploaded"
  | "failed"
  | "attached"
  | "processing";

export type ScreeningUploadFileSpec = {
  localId: string;
  originalName: string;
  absolutePath: string;
  size: number;
  mimeType: string;
  extension: string;
  uploadStatus: ScreeningUploadStatus;
  remoteFileId: string | null;
  error: string | null;
};

export type ScreeningAttachmentManifest = {
  requestId: string;
  inputFiles: Array<{
    originalName: string;
    size: number;
    extension: string;
  }>;
  expectedCount: number;
};

const ACCEPTED_EXTENSIONS = new Set([
  ".xlsx",
  ".xls",
  ".csv",
  ".md",
  ".txt",
  ".pdf",
  ".docx",
]);

const MIME_BY_EXTENSION: Record<string, string[]> = {
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".xls": ["application/vnd.ms-excel"],
  ".csv": ["text/csv", "application/csv", "text/plain"],
  ".md": ["text/markdown", "text/plain"],
  ".txt": ["text/plain"],
  ".pdf": ["application/pdf"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

export function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[ext]?.[0] || "application/octet-stream";
}

export function buildScreeningUploadSpecs(filePaths: string[]): ScreeningUploadFileSpec[] {
  return filePaths.map((filePath, index) => {
    const absolutePath = path.resolve(filePath);
    const originalName = path.basename(absolutePath);
    const extension = path.extname(originalName).toLowerCase();
    const stat = fs.statSync(absolutePath);
    return {
      localId: `screening-${index + 1}-${originalName}`,
      originalName,
      absolutePath,
      size: stat.size,
      mimeType: inferMimeType(absolutePath),
      extension,
      uploadStatus: "selected" as const,
      remoteFileId: null,
      error: null,
    };
  });
}

export function composerAttachmentMatchesExpected(
  displayName: string,
  expectedBasename: string,
): boolean {
  const display = normalizeComposerBasename(displayName);
  const expected = normalizeComposerBasename(expectedBasename);
  if (!display || !expected) return false;
  if (display === expected) return true;
  const displayStem = display.replace(/\.[^.]+$/, "");
  const expectedStem = expected.replace(/\.[^.]+$/, "");
  return displayStem === expectedStem && display.endsWith(path.extname(expected));
}

export function screeningComposerCandidatesInclude(
  candidates: string[],
  expectedBasename: string,
): boolean {
  return candidates.some((name) =>
    composerAttachmentMatchesExpected(name, expectedBasename),
  );
}

function assertAcceptedExtension(spec: ScreeningUploadFileSpec): void {
  if (!ACCEPTED_EXTENSIONS.has(spec.extension)) {
    throw new AutomationError(
      "FILE_ATTACHMENT_ERROR",
      `Unsupported file type for screening upload: ${spec.originalName} (${spec.extension || "no extension"})`,
    );
  }
}

function validateExcelWorkbook(spec: ScreeningUploadFileSpec, logger: Logger): void {
  assertAcceptedExtension(spec);
  if (spec.size <= 0) {
    throw new AutomationError(
      "FILE_ATTACHMENT_ERROR",
      `Excel file is empty: ${spec.originalName}`,
    );
  }
  const header = fs.readFileSync(spec.absolutePath).subarray(0, 4);
  if (header.length < 2 || header[0] !== 0x50 || header[1] !== 0x4b) {
    throw new AutomationError(
      "FILE_ATTACHMENT_ERROR",
      `Excel file is not a valid XLSX/ZIP workbook: ${spec.originalName}`,
    );
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(spec.absolutePath, { bookSheets: true });
  } catch (error) {
    throw new AutomationError(
      "FILE_ATTACHMENT_ERROR",
      `Excel file is corrupted or unreadable: ${spec.originalName} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!workbook.SheetNames.length) {
    throw new AutomationError(
      "FILE_ATTACHMENT_ERROR",
      `Excel workbook has no worksheets: ${spec.originalName}`,
    );
  }
  const sheetNamesLower = workbook.SheetNames.map((s) => s.toLowerCase());
  const hasTenderSheets =
    sheetNamesLower.some((s) => s.includes("non-gem")) ||
    sheetNamesLower.some((s) => s.includes("gem"));
  logger.info(
    `CHATGPT_SCREENING_INPUT_XLSX_SHEETS=${workbook.SheetNames.join("|")} tenderSheets=${hasTenderSheets}`,
  );
  if (!hasTenderSheets) {
    logger.warn(
      `CHATGPT_SCREENING_INPUT_XLSX_NO_TENDER_SHEETS=${spec.originalName} sheets=${workbook.SheetNames.join(",")}`,
    );
  }
}

function validateTextLikeFile(spec: ScreeningUploadFileSpec): void {
  assertAcceptedExtension(spec);
  if (spec.size <= 0) {
    throw new AutomationError(
      "FILE_ATTACHMENT_ERROR",
      `Text file is empty: ${spec.originalName}`,
    );
  }
  const sample = fs.readFileSync(spec.absolutePath, "utf8").slice(0, 32);
  if (!sample.trim()) {
    throw new AutomationError(
      "FILE_ATTACHMENT_ERROR",
      `Text file has no readable content: ${spec.originalName}`,
    );
  }
}

/** Local pre-upload validation for screening attachments. */
export function validateScreeningInputFiles(
  specs: ScreeningUploadFileSpec[],
  logger: Logger,
): void {
  logger.info(`[Files] Selected count=${specs.length}`);
  for (const spec of specs) {
    logger.info(
      `[Files] Selected name=${spec.originalName} size=${spec.size} mimeType=${spec.mimeType} ext=${spec.extension}`,
    );
    if (!fs.existsSync(spec.absolutePath) || !fs.statSync(spec.absolutePath).isFile()) {
      throw new AutomationError(
        "FILE_ATTACHMENT_ERROR",
        `Selected file does not exist: ${spec.originalName}`,
      );
    }
    if (spec.extension === ".xlsx" || spec.extension === ".xls") {
      validateExcelWorkbook(spec, logger);
    } else if (spec.extension === ".md" || spec.extension === ".txt") {
      validateTextLikeFile(spec);
    } else {
      assertAcceptedExtension(spec);
      if (spec.size <= 0) {
        throw new AutomationError(
          "FILE_ATTACHMENT_ERROR",
          `File is empty: ${spec.originalName}`,
        );
      }
    }
  }
}

export function buildScreeningAttachmentManifestForPrompt(options: {
  requestId: string;
  specs: ScreeningUploadFileSpec[];
}): string {
  const lines = [
    "FILES ATTACHED TO THIS REQUEST:",
    "",
  ];
  options.specs.forEach((spec, index) => {
    const type =
      spec.extension === ".xlsx" || spec.extension === ".xls"
        ? "Excel"
        : spec.extension === ".md"
          ? "Markdown"
          : spec.extension === ".txt"
            ? "Text"
            : spec.extension.slice(1).toUpperCase() || "File";
    lines.push(`${index + 1}. ${spec.originalName}`);
    lines.push(`   type: ${type}`);
    lines.push(`   size: ${spec.size} bytes`);
    lines.push("");
  });
  lines.push(`Expected files: ${options.specs.length}`);
  lines.push("");
  lines.push(
    "Before analysis, verify that all expected attachments listed above are accessible in this chat.",
  );
  lines.push(
    "If any expected file cannot be accessed, STOP and return FILE_ATTACHMENT_ERROR with the missing filename(s).",
  );
  lines.push(
    "Do not invent a local /mnt/data path for input files. Use only the attachments present in this chat.",
  );
  return lines.join("\n");
}

export function buildScreeningAttachmentManifest(
  requestId: string,
  specs: ScreeningUploadFileSpec[],
): ScreeningAttachmentManifest {
  return {
    requestId,
    inputFiles: specs.map((spec) => ({
      originalName: spec.originalName,
      size: spec.size,
      extension: spec.extension,
    })),
    expectedCount: specs.length,
  };
}

/** Validate downloaded screening XLSX bytes on disk. */
export function validateDownloadedScreeningXlsx(
  filePath: string,
  logger: Logger,
): void {
  if (!fs.existsSync(filePath)) {
    throw new AutomationError(
      "SCREENING_OUTPUT_INVALID",
      `Downloaded workbook missing: ${filePath}`,
    );
  }
  const size = fs.statSync(filePath).size;
  if (size <= 0) {
    throw new AutomationError(
      "SCREENING_OUTPUT_INVALID",
      `Downloaded workbook is empty: ${filePath}`,
    );
  }
  const header = fs.readFileSync(filePath).subarray(0, 4);
  if (header.length < 2 || header[0] !== 0x50 || header[1] !== 0x4b) {
    throw new AutomationError(
      "SCREENING_OUTPUT_INVALID",
      `Downloaded workbook is not a valid XLSX file: ${filePath}`,
    );
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(filePath, { bookSheets: true });
  } catch (error) {
    throw new AutomationError(
      "SCREENING_OUTPUT_INVALID",
      `Downloaded workbook is corrupted: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!workbook.SheetNames.length) {
    throw new AutomationError(
      "SCREENING_OUTPUT_INVALID",
      "Downloaded workbook has no worksheets",
    );
  }
  logger.info(
    `[Result File] path=${filePath} size=${size} sheets=${workbook.SheetNames.length} downloadable=true`,
  );
}

export function isUnsafeGeneratedFileHref(href: string): boolean {
  const lower = href.toLowerCase();
  if (!href || href === "#" || href.startsWith("javascript:")) return true;
  if (lower.includes("/api/library/files/") && lower.includes("libfile_")) {
    return true;
  }
  if (lower.includes("sandbox:/mnt/data/")) {
    return true;
  }
  return false;
}

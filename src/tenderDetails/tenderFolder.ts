import fs from "node:fs";
import path from "node:path";
import {
  ensureTender247DateScopedDir,
  getActiveTender247RunContext,
  requestedDateFromDateFolder,
} from "../tender247Batch/tender247RunContext.js";
import { ensureDir } from "../fileUtils.js";

export interface TenderFolderPaths {
  root: string;
  documents: string;
  corrigenda: string;
  screenshots: string;
  metadataPath: string;
}

/**
 * Create downloads/YYYY-MM-DD/T247-{id}/ with documents/, corrigenda/, screenshots/.
 * Prevents path traversal via sanitized ID.
 * Uses the active Tender247 run date when set (never invents today).
 */
export function createTenderFolder(
  dateFolder: string,
  t247Id: string,
): TenderFolderPaths {
  const safeId = sanitizeT247Id(t247Id);
  const root = path.resolve(dateFolder, `T247-${safeId}`);
  if (!root.startsWith(path.resolve(dateFolder))) {
    throw new Error(`Refusing unsafe tender folder path for id=${t247Id}`);
  }

  const requestedDate =
    getActiveTender247RunContext()?.requestedDate ??
    requestedDateFromDateFolder(dateFolder);
  const documents = path.join(root, "documents");
  const corrigenda = path.join(root, "corrigenda");
  const screenshots = path.join(root, "screenshots");
  ensureTender247DateScopedDir(documents, requestedDate);
  ensureTender247DateScopedDir(corrigenda, requestedDate);
  ensureTender247DateScopedDir(screenshots, requestedDate);

  return {
    root,
    documents,
    corrigenda,
    screenshots,
    metadataPath: path.join(root, "metadata.json"),
  };
}

export function sanitizeT247Id(t247Id: string): string {
  const digits = t247Id.replace(/\D/g, "");
  if (!digits) {
    throw new Error(`Invalid T247 ID: ${t247Id}`);
  }
  return digits;
}

/** Safe filename component — no path separators / reserved characters. */
export function sanitizeFileName(name: string): string {
  const base = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .slice(0, 160);
  return base || "file";
}

/**
 * Unique destination under a directory (no silent overwrite).
 * Example: Tender_Document_1.pdf → Tender_Document_1_2.pdf
 */
export function uniqueFilePath(
  directory: string,
  baseName: string,
  extension: string,
): string {
  ensureDir(directory);
  const ext = extension.startsWith(".") ? extension : extension ? `.${extension}` : "";
  const safeBase = sanitizeFileName(baseName);
  let candidate = path.join(directory, `${safeBase}${ext}`);
  assertInside(directory, candidate);
  if (!fs.existsSync(candidate)) {
    return candidate;
  }
  let index = 2;
  while (true) {
    candidate = path.join(directory, `${safeBase}_${index}${ext}`);
    assertInside(directory, candidate);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

export function assertInside(parentDir: string, filePath: string): void {
  const parent = path.resolve(parentDir);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(parent + path.sep) && resolved !== parent) {
    throw new Error(`Path traversal blocked: ${filePath}`);
  }
}

export function extensionFromFilename(fileName: string): string {
  const ext = path.extname(fileName);
  return ext ? ext.slice(1).toLowerCase() : "";
}

export function guessExtensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).replace(".", "").toLowerCase();
    if (ext && ext.length <= 5) {
      return ext;
    }
  } catch {
    // ignore
  }
  return "";
}

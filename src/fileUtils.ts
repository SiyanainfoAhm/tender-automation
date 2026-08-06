import fs from "node:fs";
import path from "node:path";
import { getTodayIsoDate } from "./dateUtils.js";

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function resolveProjectPath(...segments: string[]): string {
  return path.resolve(process.cwd(), ...segments);
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function getFileSizeBytes(filePath: string): number {
  return fs.statSync(filePath).size;
}

export function isSpreadsheetExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xls");
}

/**
 * Build a non-overwriting destination path.
 * First file: Tender247_YYYY-MM-DD.xlsx
 * Collisions: Tender247_YYYY-MM-DD_2.xlsx, _3, ...
 */
export function uniqueDestinationPath(
  directory: string,
  baseName: string,
  extension: string,
): string {
  ensureDir(directory);
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  let candidate = path.join(directory, `${baseName}${ext}`);
  if (!fs.existsSync(candidate)) {
    return candidate;
  }

  let index = 2;
  while (true) {
    candidate = path.join(directory, `${baseName}_${index}${ext}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

export function downloadDirForToday(downloadRoot: string, date = new Date()): string {
  return path.join(resolveProjectPath(downloadRoot), getTodayIsoDate(date));
}

export function screenshotDirForToday(screenshotRoot: string, date = new Date()): string {
  return path.join(resolveProjectPath(screenshotRoot), getTodayIsoDate(date));
}

export function moveDownloadToDestination(
  tempPath: string,
  destinationPath: string,
): void {
  ensureDir(path.dirname(destinationPath));
  fs.renameSync(tempPath, destinationPath);
}

/** Copy then unlink when rename fails across drives (common on Windows). */
export function relocateFile(sourcePath: string, destinationPath: string): void {
  ensureDir(path.dirname(destinationPath));
  try {
    fs.renameSync(sourcePath, destinationPath);
  } catch {
    fs.copyFileSync(sourcePath, destinationPath);
    fs.unlinkSync(sourcePath);
  }
}

import fs from "node:fs";
import path from "node:path";
import { getTodayIsoDate } from "../dateUtils.js";
import { ensureDir, resolveProjectPath } from "../fileUtils.js";
import { ExcelConversionError } from "./types.js";

export interface SourceFiles {
  dateFolder: string;
  dateIso: string;
  tender247Path?: string;
  bidAssistPath?: string;
}

/**
 * Locate newest Tender247_*.xlsx / BidAssist_*.xlsx workbooks
 * in downloads/YYYY-MM-DD.
 */
export function findSourceFiles(
  downloadRoot: string,
  date: Date = new Date(),
): SourceFiles {
  const dateIso = getTodayIsoDate(date);
  const dateFolder = path.join(resolveProjectPath(downloadRoot), dateIso);
  ensureDir(dateFolder);

  const tender247Path = findNewestMatching(
    dateFolder,
    new RegExp(`^Tender247_${escapeRegex(dateIso)}(?:_\\d+)?\\.xlsx$`, "i"),
  );
  const bidAssistPath = findNewestMatching(
    dateFolder,
    new RegExp(`^BidAssist_${escapeRegex(dateIso)}(?:_\\d+)?\\.xlsx$`, "i"),
  );

  return { dateFolder, dateIso, tender247Path, bidAssistPath };
}

function findNewestMatching(
  directory: string,
  pattern: RegExp,
): string | undefined {
  if (!fs.existsSync(directory)) {
    return undefined;
  }

  const matches = fs
    .readdirSync(directory)
    .filter((name) => {
      if (name.startsWith("Tender_App_Import_")) {
        return false;
      }
      if (name.startsWith("~$")) {
        return false;
      }
      return pattern.test(name);
    })
    .map((name) => {
      const fullPath = path.join(directory, name);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return matches[0]?.fullPath;
}

export function requireTender247Source(files: SourceFiles): string {
  if (!files.tender247Path) {
    throw new ExcelConversionError(
      "TENDER247_SOURCE_FILE_NOT_FOUND",
      `No Tender247_*.xlsx found in ${files.dateFolder}`,
    );
  }
  return files.tender247Path;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

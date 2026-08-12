/**
 * Write human-review Excel outputs for the Tender247 Excel financial dry-run.
 * Local files only — never touches Supabase.
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import {
  ensureTender247DateScopedDir,
  getActiveTender247RunContext,
  requestedDateFromDateFolderSafe,
} from "../tender247Batch/tender247RunContext.js";
import {
  formatInrReviewDisplay,
  type ExcelEarlyFilterSummary,
  type ExcelFilterDecision,
} from "../tender247Batch/excelEarlyFinancialFilter.js";

export type ExcelFilterReviewPaths = {
  reviewDir: string;
  originalPath: string | null;
  originalReferenced: string;
  keptPath: string;
  droppedPath: string;
  summaryPath: string;
};

function decisionToKeptRow(d: ExcelFilterDecision): Record<string, unknown> {
  return {
    "Tender247 ID": d.sourceTenderId,
    "Tender Name": d.title,
    "Estimated Cost Raw": d.rawTenderValue ?? "",
    "Parsed Tender Value INR": d.parsedTenderValueInr ?? "",
    "Tender Value Display": formatInrReviewDisplay(d.parsedTenderValueInr),
    "EMD Raw": d.rawEmd ?? "",
    "Parsed EMD INR": d.parsedEmdInr ?? "",
    "EMD Display": formatInrReviewDisplay(d.parsedEmdInr),
    Deadline: d.deadline ?? "",
    "Tender Value Available": d.excelTenderValueUnavailable ? "false" : "true",
    "EMD Available": d.excelEmdUnavailable ? "false" : "true",
    "Excel Filter Status": d.status,
    "Excel Filter Reason": d.reasonCode,
  };
}

function decisionToDroppedRow(d: ExcelFilterDecision): Record<string, unknown> {
  return {
    "Tender247 ID": d.sourceTenderId,
    "Tender Name": d.title,
    "Estimated Cost Raw": d.rawTenderValue ?? "",
    "Parsed Tender Value INR": d.parsedTenderValueInr ?? "",
    "Tender Value Display": formatInrReviewDisplay(d.parsedTenderValueInr),
    "EMD Raw": d.rawEmd ?? "",
    "Parsed EMD INR": d.parsedEmdInr ?? "",
    "EMD Display": formatInrReviewDisplay(d.parsedEmdInr),
    Deadline: d.deadline ?? "",
    "Excel Filter Status": d.status,
    "Excel Filter Reason": d.reasonCode,
  };
}

function writeSheet(
  filePath: string,
  sheetName: string,
  rows: Record<string, unknown>[],
): void {
  const wb = XLSX.utils.book_new();
  const ws =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([["(no rows)"]]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filePath);
}

export function writeExcelFilterReviewOutputs(options: {
  dateFolder: string;
  dateIso: string;
  excelPath: string;
  summary: ExcelEarlyFilterSummary;
}): ExcelFilterReviewPaths {
  const reviewDir = path.join(options.dateFolder, "excel-filter-review");
  const requestedDate =
    getActiveTender247RunContext()?.requestedDate ??
    options.dateIso ??
    requestedDateFromDateFolderSafe(options.dateFolder) ??
    undefined;
  ensureTender247DateScopedDir(reviewDir, requestedDate);

  const originalDest = path.join(reviewDir, "01-original.xlsx");
  let originalPath: string | null = null;
  const excelAbs = path.resolve(options.excelPath);
  const dateFolderAbs = path.resolve(options.dateFolder);

  if (excelAbs.startsWith(dateFolderAbs) && fs.existsSync(excelAbs)) {
    // Already in the date folder — reference instead of mandatory duplicate.
    originalPath = null;
  } else if (fs.existsSync(excelAbs)) {
    fs.copyFileSync(excelAbs, originalDest);
    originalPath = originalDest;
  }

  const kept = options.summary.decisions
    .filter((d) => d.status === "KEEP")
    .map(decisionToKeptRow);
  const dropped = options.summary.decisions
    .filter((d) => d.status === "DROP")
    .map(decisionToDroppedRow);

  const keptPath = path.join(reviewDir, "02-kept.xlsx");
  const droppedPath = path.join(reviewDir, "03-dropped.xlsx");
  const summaryPath = path.join(reviewDir, "04-filter-summary.json");

  writeSheet(keptPath, "KEEP", kept);
  writeSheet(droppedPath, "DROP", dropped);

  const payload = {
    dryRun: true,
    supabaseWrites: false,
    detailCrawl: false,
    documentDownload: false,
    chatgpt: false,
    date: options.dateIso,
    excelPath: options.excelPath,
    generatedAt: new Date().toISOString(),
    excelRows: options.summary.excelRows,
    keep: {
      total:
        options.summary.keptWithinLimits +
        options.summary.keptBecauseUnavailable,
      withinFinancialLimits: options.summary.keptWithinLimits,
      financialDataUnavailable: options.summary.keptBecauseUnavailable,
    },
    drop: {
      total:
        options.summary.droppedByTenderValue +
        options.summary.droppedByEmd +
        options.summary.droppedByBoth,
      tenderValueAboveLimit: options.summary.droppedByTenderValue,
      emdAboveLimit: options.summary.droppedByEmd,
      bothOverLimits: options.summary.droppedByBoth,
    },
    survivingTenderIds: options.summary.survivingTenderIds,
    decisions: options.summary.decisions,
    review: {
      original: originalPath || options.excelPath,
      kept: keptPath,
      dropped: droppedPath,
    },
  };
  fs.writeFileSync(summaryPath, JSON.stringify(payload, null, 2), "utf8");

  return {
    reviewDir,
    originalPath,
    originalReferenced: options.excelPath,
    keptPath,
    droppedPath,
    summaryPath,
  };
}

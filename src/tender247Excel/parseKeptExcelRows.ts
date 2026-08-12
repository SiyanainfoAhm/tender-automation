/**
 * Read ALL financial-survivor rows from excel-filter-review/02-kept.xlsx.
 * Downstream --limit applies only after IT relevance filtering — not here.
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

export type KeptExcelCandidate = {
  sourceTenderId: string;
  title: string;
  estimatedCostRaw: string | null;
  parsedTenderValueInr: number | null;
  emdRaw: string | null;
  parsedEmdInr: number | null;
  deadline: string | null;
  excelFilterStatus: string;
  excelFilterReason: string | null;
  rowIndex: number; // 1-based data row (after header)
};

export type FinancialFilterSummaryCounts = {
  excelRows: number;
  financialKeep: number;
  financialDrop: number;
};

function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\u00a0/g, " ").trim();
  return text || null;
}

function cellNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = cellText(value);
  if (!text) return null;
  const n = Number.parseFloat(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeTenderId(raw: unknown): string | null {
  const text = cellText(raw);
  if (!text) return null;
  const stripped = text.replace(/^T247-?/i, "").trim();
  if (!/^\d+$/.test(stripped)) return null;
  return stripped;
}

function rowToCandidate(
  row: Record<string, unknown>,
  rowIndex: number,
): KeptExcelCandidate | null {
  const sourceTenderId = normalizeTenderId(
    row["Tender247 ID"] ?? row["Tender247ID"] ?? row["tender247_id"],
  );
  if (!sourceTenderId) return null;
  return {
    sourceTenderId,
    title:
      cellText(row["Tender Name"] ?? row["title"]) || `T247-${sourceTenderId}`,
    estimatedCostRaw: cellText(
      row["Estimated Cost Raw"] ?? row["Estimated Cost"],
    ),
    parsedTenderValueInr: cellNumber(row["Parsed Tender Value INR"]),
    emdRaw: cellText(row["EMD Raw"] ?? row["EMD"]),
    parsedEmdInr: cellNumber(row["Parsed EMD INR"]),
    deadline: cellText(row["Deadline"]),
    excelFilterStatus: cellText(row["Excel Filter Status"]) || "KEEP",
    excelFilterReason: cellText(row["Excel Filter Reason"]),
    rowIndex,
  };
}

/**
 * Read every financial KEEP row. Does not apply the downstream IT candidate --limit.
 */
export function readAllKeptCandidatesFromExcel(
  filePath: string,
): KeptExcelCandidate[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`KEPT_EXCEL_NOT_FOUND=${filePath}`);
  }

  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error(`KEPT_EXCEL_EMPTY=${filePath}`);
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets[sheetName]!,
    { defval: null },
  );

  const out: KeptExcelCandidate[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const candidate = rowToCandidate(rows[i]!, i + 1);
    if (candidate) out.push(candidate);
  }
  return out;
}

/**
 * @deprecated Prefer readAllKeptCandidatesFromExcel + IT relevance selection.
 * Kept for callers that still want a raw Excel row slice.
 */
export function readKeptCandidatesFromExcel(
  filePath: string,
  limit: number,
): KeptExcelCandidate[] {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`Invalid --limit=${limit}; expected positive integer`);
  }
  return readAllKeptCandidatesFromExcel(filePath).slice(0, limit);
}

export function resolveDefaultKeptExcelPath(
  downloadRoot: string,
  dateIso: string,
): string {
  return path.join(
    downloadRoot,
    dateIso,
    "excel-filter-review",
    "02-kept.xlsx",
  );
}

export function resolveExcelFilterReviewDir(
  downloadRoot: string,
  dateIso: string,
): string {
  return path.join(downloadRoot, dateIso, "excel-filter-review");
}

/**
 * Load financial filter counts from 04-filter-summary.json when present.
 */
export function loadFinancialFilterSummaryCounts(
  reviewDir: string,
  financialKeepFallback: number,
): FinancialFilterSummaryCounts {
  const summaryPath = path.join(reviewDir, "04-filter-summary.json");
  if (!fs.existsSync(summaryPath)) {
    return {
      excelRows: financialKeepFallback,
      financialKeep: financialKeepFallback,
      financialDrop: 0,
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
      excelRows?: number;
      keep?: { total?: number };
      drop?: { total?: number };
    };
    return {
      excelRows: Number(raw.excelRows) || financialKeepFallback,
      financialKeep: Number(raw.keep?.total) || financialKeepFallback,
      financialDrop: Number(raw.drop?.total) || 0,
    };
  } catch {
    return {
      excelRows: financialKeepFallback,
      financialKeep: financialKeepFallback,
      financialDrop: 0,
    };
  }
}

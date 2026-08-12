/**
 * Persist Excel early-filter audit (local only — never Supabase).
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../fileUtils.js";
import type { ExcelEarlyFilterSummary } from "./excelEarlyFinancialFilter.js";

export const EXCEL_FILTER_AUDIT_FILENAME = "tender247-excel-filter-results.json";

export function writeExcelFilterAudit(
  dateFolder: string,
  summary: ExcelEarlyFilterSummary,
): string {
  ensureDir(dateFolder);
  const outPath = path.join(dateFolder, EXCEL_FILTER_AUDIT_FILENAME);
  const payload = {
    generatedAt: new Date().toISOString(),
    excelRows: summary.excelRows,
    droppedByTenderValue: summary.droppedByTenderValue,
    droppedByEmd: summary.droppedByEmd,
    droppedByBoth: summary.droppedByBoth,
    keptWithinLimits: summary.keptWithinLimits,
    keptBecauseUnavailable: summary.keptBecauseUnavailable,
    detailCrawlsRequired: summary.detailCrawlsRequired,
    survivingTenderIds: summary.survivingTenderIds,
    rows: summary.decisions.map((d) => ({
      sourceTenderId: d.sourceTenderId,
      title: d.title,
      rawTenderValue: d.rawTenderValue,
      parsedTenderValueInr: d.parsedTenderValueInr,
      rawEmd: d.rawEmd,
      parsedEmdInr: d.parsedEmdInr,
      status: d.status,
      reasonCode: d.reasonCode,
      excelTenderValueUnavailable: d.excelTenderValueUnavailable,
      excelEmdUnavailable: d.excelEmdUnavailable,
    })),
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  return outPath;
}

export function readExcelFilterAudit(
  dateFolder: string,
): ExcelEarlyFilterSummary | null {
  const filePath = path.join(dateFolder, EXCEL_FILTER_AUDIT_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      excelRows?: number;
      droppedByTenderValue?: number;
      droppedByEmd?: number;
      keptWithinLimits?: number;
      keptBecauseUnavailable?: number;
      detailCrawlsRequired?: number;
      survivingTenderIds?: string[];
      rows?: ExcelEarlyFilterSummary["decisions"];
    };
    return {
      excelRows: parsed.excelRows ?? 0,
      droppedByTenderValue: parsed.droppedByTenderValue ?? 0,
      droppedByEmd: parsed.droppedByEmd ?? 0,
      droppedByBoth: (parsed as { droppedByBoth?: number }).droppedByBoth ?? 0,
      keptWithinLimits: parsed.keptWithinLimits ?? 0,
      keptBecauseUnavailable: parsed.keptBecauseUnavailable ?? 0,
      detailCrawlsRequired:
        parsed.detailCrawlsRequired ??
        (parsed.survivingTenderIds?.length ?? 0),
      survivingTenderIds: parsed.survivingTenderIds ?? [],
      decisions: parsed.rows ?? [],
    };
  } catch {
    return null;
  }
}

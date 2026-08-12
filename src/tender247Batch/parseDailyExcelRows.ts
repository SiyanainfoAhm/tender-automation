/**
 * Parse Tender247 daily Excel into lightweight rows for the early financial gate.
 * Headers are matched by normalized name — never by column letter.
 */
import fs from "node:fs";
import XLSX from "xlsx";
import type { Logger } from "../logger.js";
import {
  buildHeaderMap,
  cleanCell,
  formatIdAsText,
  getField,
  hasAnyHeaders,
  normalizeHeaderKey,
} from "../excel/types.js";
import type { ExcelFinancialRowInput } from "./excelEarlyFinancialFilter.js";

const ID_HEADERS = [
  "T247 ID",
  "Tender247 ID",
  "Tender 247 ID",
  "Tender Id",
  "Tender ID",
  "Tender No",
  "Bid No",
];

const TITLE_HEADERS = [
  "TENDER BRIEF",
  "Summary",
  "Tender Name",
  "Title",
  "Description",
  "Items",
];

const VALUE_HEADERS = [
  "ESTIMATED COST",
  "Estimated Cost",
  "Estimate Cost",
  "Tender Amount",
  "Tender Value",
  "Estimated Value",
  "Estimated Bid Value",
  "Value",
  "Contract Value",
];

const EMD_HEADERS = [
  "EMD",
  "EMD Amount",
  "Earnest Money Deposit",
  "Earnest Money",
  "Bid Security",
];

const DEADLINE_HEADERS = [
  "Deadline",
  "Closing Date",
  "End Date",
  "Bid End Date",
  "Last Date",
];

const SHEET_MARKERS = [
  "T247 ID",
  "Tender Id",
  "ESTIMATED COST",
  "Tender Amount",
  "EMD",
  "Deadline",
  "Closing Date",
  "TENDER BRIEF",
  "Summary",
];

export type ParsedDailyExcel = {
  excelPath: string;
  rows: ExcelFinancialRowInput[];
  sheetsUsed: string[];
};

function sheetLooksLikeTender247(
  headerMap: Map<string, string>,
): boolean {
  return (
    hasAnyHeaders(headerMap, SHEET_MARKERS, 3) ||
    headerMap.has(normalizeHeaderKey("T247 ID")) ||
    headerMap.has(normalizeHeaderKey("Tender Id"))
  );
}

function extractId(raw: Record<string, unknown>, headerMap: Map<string, string>): string {
  const value = getField(raw, headerMap, ...ID_HEADERS);
  const id = formatIdAsText(value).replace(/^T247[-\s]*/i, "");
  // Digits-only Tender247 IDs are canonical in the live crawler.
  const digits = id.replace(/\D/g, "");
  return digits || id;
}

function extractTitle(
  raw: Record<string, unknown>,
  headerMap: Map<string, string>,
): string {
  return cleanCell(getField(raw, headerMap, ...TITLE_HEADERS));
}

function extractRawValue(
  raw: Record<string, unknown>,
  headerMap: Map<string, string>,
): unknown {
  return getField(raw, headerMap, ...VALUE_HEADERS);
}

function extractRawEmd(
  raw: Record<string, unknown>,
  headerMap: Map<string, string>,
): unknown {
  return getField(raw, headerMap, ...EMD_HEADERS);
}

function extractDeadline(
  raw: Record<string, unknown>,
  headerMap: Map<string, string>,
): string | null {
  const value = getField(raw, headerMap, ...DEADLINE_HEADERS);
  const text = cleanCell(value);
  return text || null;
}

/**
 * Read all recognizable Tender247 sheets and return deduplicated financial rows.
 */
export function parseTender247DailyExcelRows(
  excelPath: string,
  logger?: Logger,
): ParsedDailyExcel {
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Tender247 Excel not found: ${excelPath}`);
  }

  const workbook = XLSX.readFile(excelPath, { cellDates: true });
  const byId = new Map<string, ExcelFinancialRowInput>();
  const sheetsUsed: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
    });
    if (matrix.length < 2) continue;

    const headers = (matrix[0] ?? []).map((h) => String(h ?? "").trim());
    const headerMap = buildHeaderMap(headers);
    if (!sheetLooksLikeTender247(headerMap)) {
      continue;
    }

    const objects = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: true,
    });

    let mappedOnSheet = 0;
    for (const raw of objects) {
      const sourceTenderId = extractId(raw, headerMap);
      if (!sourceTenderId) continue;

      const row: ExcelFinancialRowInput = {
        sourceTenderId,
        title: extractTitle(raw, headerMap),
        rawTenderValue: extractRawValue(raw, headerMap) as
          | string
          | number
          | null
          | undefined,
        rawEmd: extractRawEmd(raw, headerMap) as
          | string
          | number
          | null
          | undefined,
        deadline: extractDeadline(raw, headerMap),
      };

      // First occurrence wins (stable across Non-GeM then GeM sheets).
      if (!byId.has(sourceTenderId)) {
        byId.set(sourceTenderId, row);
        mappedOnSheet += 1;
      }
    }

    if (mappedOnSheet > 0) {
      sheetsUsed.push(sheetName);
      logger?.info(
        `TENDER247_DAILY_EXCEL_SHEET=${sheetName} rows=${mappedOnSheet}`,
      );
    }
  }

  const rows = [...byId.values()];
  logger?.info(`TENDER247_DAILY_EXCEL_ROWS=${rows.length}`);

  return { excelPath, rows, sheetsUsed };
}

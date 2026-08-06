import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { ensureDir, resolveProjectPath, uniqueDestinationPath } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import {
  ExcelConversionError,
  IMPORT_HEADERS,
  tenderImportRowToArray,
  type TenderImportRow,
} from "./types.js";

const TEMPLATE_SHEET_NAME = "Tenders";
const TEMPLATE_RELATIVE_PATH = path.join("templates", "tender-import-template.xlsx");

/**
 * Write mapped tender rows into a copy of the import template.
 * Preserves sheet name and recreates freeze/autofilter/widths (community SheetJS
 * does not fully round-trip Excel styling).
 */
export function writeImportWorkbook(
  rows: TenderImportRow[],
  outputDirectory: string,
  dateIso: string,
  logger: Logger,
): string {
  const templatePath = resolveProjectPath(TEMPLATE_RELATIVE_PATH);
  if (!fs.existsSync(templatePath)) {
    throw new ExcelConversionError(
      "IMPORT_TEMPLATE_NOT_FOUND",
      `Import template not found at ${templatePath}`,
    );
  }

  if (rows.length === 0) {
    throw new ExcelConversionError(
      "NO_TENDERS_MAPPED",
      "No tender rows were mapped; refusing to write an empty import workbook",
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(templatePath, { cellStyles: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExcelConversionError(
      "IMPORT_TEMPLATE_NOT_FOUND",
      `Failed to read import template: ${message}`,
    );
  }

  const sheetName =
    workbook.SheetNames.find((name) => name === TEMPLATE_SHEET_NAME) ??
    workbook.SheetNames[0];
  if (!sheetName || sheetName !== TEMPLATE_SHEET_NAME) {
    throw new ExcelConversionError(
      "IMPORT_TEMPLATE_NOT_FOUND",
      `Template must contain a sheet named "${TEMPLATE_SHEET_NAME}"`,
    );
  }

  const templateSheet = workbook.Sheets[sheetName];
  if (!templateSheet) {
    throw new ExcelConversionError(
      "IMPORT_TEMPLATE_NOT_FOUND",
      `Template sheet "${TEMPLATE_SHEET_NAME}" is missing`,
    );
  }

  validateTemplateHeaders(templateSheet);

  const dataRows = rows.map((row) => {
    const arr = tenderImportRowToArray(row);
    if (arr.length !== IMPORT_HEADERS.length) {
      throw new ExcelConversionError(
        "IMPORT_WORKBOOK_WRITE_FAILED",
        `Row does not contain exactly ${IMPORT_HEADERS.length} columns (got ${arr.length})`,
      );
    }
    return arr;
  });

  const aoa: unknown[][] = [Array.from(IMPORT_HEADERS), ...dataRows];
  const newSheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false });

  // Preserve / set useful sheet metadata
  const lastCol = XLSX.utils.encode_col(IMPORT_HEADERS.length - 1);
  const lastRow = rows.length + 1;
  newSheet["!ref"] = `A1:${lastCol}${lastRow}`;
  newSheet["!autofilter"] = { ref: `A1:${lastCol}${lastRow}` };
  newSheet["!freeze"] = {
    xSplit: 0,
    ySplit: 1,
    topLeftCell: "A2",
    activePane: "bottomLeft",
    state: "frozen",
  };
  newSheet["!cols"] = buildColumnWidths();

  // Prefer template widths when present
  if (templateSheet["!cols"] && templateSheet["!cols"].length > 0) {
    newSheet["!cols"] = templateSheet["!cols"];
  }

  workbook.Sheets[sheetName] = newSheet;
  // Ensure sheet name remains Tenders
  if (workbook.SheetNames[0] !== TEMPLATE_SHEET_NAME) {
    workbook.SheetNames = [
      TEMPLATE_SHEET_NAME,
      ...workbook.SheetNames.filter((n) => n !== TEMPLATE_SHEET_NAME),
    ];
  }

  ensureDir(outputDirectory);
  const outputPath = uniqueDestinationPath(
    outputDirectory,
    `Tender_App_Import_${dateIso}`,
    ".xlsx",
  );

  try {
    XLSX.writeFile(workbook, outputPath, { bookType: "xlsx", compression: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExcelConversionError(
      "IMPORT_WORKBOOK_WRITE_FAILED",
      `Failed to write import workbook: ${message}`,
    );
  }

  logger.info(
    `Import workbook written: ${path.relative(process.cwd(), outputPath)} (${rows.length} data rows)`,
  );
  return outputPath;
}

function validateTemplateHeaders(sheet: XLSX.WorkSheet): void {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });
  const headers = (matrix[0] ?? []).map((h) => String(h ?? "").trim());
  if (headers.length < IMPORT_HEADERS.length) {
    throw new ExcelConversionError(
      "IMPORT_TEMPLATE_NOT_FOUND",
      `Template header row has ${headers.length} columns; expected ${IMPORT_HEADERS.length}`,
    );
  }
  for (let i = 0; i < IMPORT_HEADERS.length; i += 1) {
    if (headers[i] !== IMPORT_HEADERS[i]) {
      throw new ExcelConversionError(
        "IMPORT_TEMPLATE_NOT_FOUND",
        `Template header mismatch at column ${i + 1}: expected "${IMPORT_HEADERS[i]}", found "${headers[i]}"`,
      );
    }
  }
}

function buildColumnWidths(): XLSX.ColInfo[] {
  return [
    { wch: 14 },
    { wch: 18 },
    { wch: 42 },
    { wch: 28 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 24 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
    { wch: 36 },
    { wch: 36 },
  ];
}

/**
 * Apply Phase-1 JSON screening decisions onto the original Tender247 workbook.
 * Preserves all sheets/rows/columns; only updates Screening Status / Reason.
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import type { ScreeningDecision } from "./screeningDecisionSchema.js";
import { digitsTenderId } from "./screeningDecisionSchema.js";

const STATUS_HEADERS = ["Screening Status", "Status"];
const REASON_HEADERS = ["Screening Reason", "Reason"];
const ID_HEADERS = [
  "T247 ID",
  "Tender247 ID",
  "Tender 247 ID",
  "Tender Id",
  "Tender ID",
  "Canonical ID",
];

export type WorkbookInventory = {
  sheetNames: string[];
  tenderSheetNames: string[];
  totalRows: number;
  tenderIds: string[];
};

export type ApplyScreeningResult = {
  outputPath: string;
  inputTotalRows: number;
  outputTotalRows: number;
  inputTenderIds: string[];
  outputTenderIds: string[];
  updatedRows: number;
  missingTenderIds: string[];
  extraDecisionIds: string[];
};

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function headerIndex(headers: string[], candidates: string[]): number {
  const wanted = candidates.map((c) => normalizeHeader(c));
  return headers.findIndex((h) => wanted.includes(normalizeHeader(h)));
}

function isLikelyTenderSheet(sheetName: string, headers: string[]): boolean {
  const name = sheetName.toLowerCase();
  if (/summary|classification|audit|cover|index/i.test(name)) return false;
  if (/gem|tender/i.test(name)) return true;
  return headerIndex(headers, ID_HEADERS) >= 0;
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "object" && value && "text" in value) {
    return String((value as { text?: string }).text ?? "");
  }
  if (typeof value === "object" && value && "result" in value) {
    return String((value as { result?: unknown }).result ?? "");
  }
  return String(value);
}

function readSheetHeaders(sheet: ExcelJS.Worksheet): {
  headers: string[];
  headerRowNumber: number;
} {
  const headerRowNumber = 1;
  const row = sheet.getRow(headerRowNumber);
  const headers: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellText(cell).trim();
  });
  // Trim trailing empties but keep column alignment
  while (headers.length > 0 && !headers[headers.length - 1]) {
    headers.pop();
  }
  return { headers, headerRowNumber };
}

function ensureColumn(
  sheet: ExcelJS.Worksheet,
  headers: string[],
  headerRowNumber: number,
  preferredName: string,
  aliases: string[],
): number {
  let idx = headerIndex(headers, [preferredName, ...aliases]);
  if (idx >= 0) return idx + 1; // 1-based
  const newCol = headers.length + 1;
  sheet.getRow(headerRowNumber).getCell(newCol).value = preferredName;
  headers.push(preferredName);
  return newCol;
}

/**
 * Inventory tender sheets/rows/IDs from an on-disk workbook (original structure).
 */
export async function inventoryTenderWorkbook(
  workbookPath: string,
): Promise<WorkbookInventory> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheetNames = workbook.worksheets.map((s) => s.name);
  const tenderSheetNames: string[] = [];
  const tenderIds: string[] = [];
  let totalRows = 0;

  for (const sheet of workbook.worksheets) {
    const { headers, headerRowNumber } = readSheetHeaders(sheet);
    if (!isLikelyTenderSheet(sheet.name, headers)) continue;
    const idCol = headerIndex(headers, ID_HEADERS);
    if (idCol < 0) continue;
    tenderSheetNames.push(sheet.name);
    for (let r = headerRowNumber + 1; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const id = digitsTenderId(cellText(row.getCell(idCol + 1)));
      if (!id) continue;
      totalRows += 1;
      tenderIds.push(id);
    }
  }

  return {
    sheetNames,
    tenderSheetNames,
    totalRows,
    tenderIds: [...new Set(tenderIds)],
  };
}

/**
 * Patch Screening Status / Reason on the original workbook and write output.
 * Rows without a GPT decision are kept and marked VERIFY.
 */
export async function applyScreeningDecisionsToWorkbook(options: {
  sourceWorkbookPath: string;
  outputPath: string;
  decisions: ScreeningDecision[];
  logger?: Logger;
}): Promise<ApplyScreeningResult> {
  const { sourceWorkbookPath, outputPath, decisions, logger } = options;
  if (!fs.existsSync(sourceWorkbookPath)) {
    throw new Error(`Source workbook missing: ${sourceWorkbookPath}`);
  }

  const inventory = await inventoryTenderWorkbook(sourceWorkbookPath);
  log(logger, `SCREENING_INPUT_ROWS=${inventory.totalRows}`);
  log(logger, `INPUT_TOTAL_ROWS=${inventory.totalRows}`);
  log(logger, `INPUT_SHEETS=${JSON.stringify(inventory.sheetNames)}`);

  const decisionById = new Map(decisions.map((d) => [d.t247Id, d]));
  const seenIds = new Set<string>();
  let updatedRows = 0;
  let outputTotalRows = 0;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourceWorkbookPath);

  for (const sheet of workbook.worksheets) {
    const { headers, headerRowNumber } = readSheetHeaders(sheet);
    if (!isLikelyTenderSheet(sheet.name, headers)) continue;
    const idCol = headerIndex(headers, ID_HEADERS);
    if (idCol < 0) continue;

    const statusCol = ensureColumn(
      sheet,
      headers,
      headerRowNumber,
      "Screening Status",
      STATUS_HEADERS,
    );
    const reasonCol = ensureColumn(
      sheet,
      headers,
      headerRowNumber,
      "Screening Reason",
      REASON_HEADERS,
    );

    for (let r = headerRowNumber + 1; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const id = digitsTenderId(cellText(row.getCell(idCol + 1)));
      if (!id) continue;
      outputTotalRows += 1;
      seenIds.add(id);
      const decision = decisionById.get(id);
      if (decision) {
        row.getCell(statusCol).value = decision.screeningStatus;
        row.getCell(reasonCol).value = decision.screeningReason;
        updatedRows += 1;
      } else {
        row.getCell(statusCol).value = "VERIFY";
        row.getCell(reasonCol).value = "AI response missing tender mapping";
        updatedRows += 1;
      }
    }
  }

  const missingTenderIds = inventory.tenderIds.filter((id) => !seenIds.has(id));
  const extraDecisionIds = decisions
    .map((d) => d.t247Id)
    .filter((id) => !inventory.tenderIds.includes(id));

  if (
    inventory.totalRows !== outputTotalRows ||
    missingTenderIds.length > 0
  ) {
    const err = new Error(
      `SCREENING_OUTPUT_INVALID INPUT_TOTAL_ROWS=${inventory.totalRows} OUTPUT_TOTAL_ROWS=${outputTotalRows} missing_rows=${JSON.stringify(missingTenderIds)} extra_rows=${JSON.stringify(extraDecisionIds)}`,
    );
    (err as Error & { code?: string }).code = "SCREENING_OUTPUT_INVALID";
    throw err;
  }

  ensureDir(path.dirname(outputPath));
  await workbook.xlsx.writeFile(outputPath);

  log(logger, `SCREENING_OUTPUT_ROWS=${outputTotalRows}`);
  log(logger, `SCREENING_UPDATED_ROWS=${updatedRows}`);
  log(
    logger,
    `SCREENING_MISSING_TENDER_IDS=${JSON.stringify(
      decisions.length < inventory.tenderIds.length
        ? inventory.tenderIds.filter((id) => !decisionById.has(id))
        : [],
    )}`,
  );

  return {
    outputPath,
    inputTotalRows: inventory.totalRows,
    outputTotalRows,
    inputTenderIds: inventory.tenderIds,
    outputTenderIds: [...seenIds],
    updatedRows,
    missingTenderIds: inventory.tenderIds.filter((id) => !decisionById.has(id)),
    extraDecisionIds,
  };
}

/**
 * Write server-side DUPLICATE marks into the GPT upload workbook so ChatGPT
 * can skip pre-handled rows (Status=DUPLICATE + Decision Reason).
 * Row order must match parseSourceWorkbook / annotateImportDuplicates.
 */
export async function markDuplicateRowsInGptWorkbook(options: {
  workbookPath: string;
  annotatedRows: Array<{
    duplicateMark?: { reason: string };
  }>;
  logger?: Logger;
}): Promise<{ marked: number; enumeratedRows: number }> {
  const { workbookPath, annotatedRows, logger } = options;
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`GPT input workbook missing: ${workbookPath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  let importIndex = 0;
  let marked = 0;

  for (const sheet of workbook.worksheets) {
    const { headers, headerRowNumber } = readSheetHeaders(sheet);
    if (!isLikelyTenderSheet(sheet.name, headers)) continue;
    const idCol = headerIndex(headers, ID_HEADERS);
    if (idCol < 0) continue;

    const statusCol = ensureColumn(
      sheet,
      headers,
      headerRowNumber,
      "Screening Status",
      STATUS_HEADERS,
    );
    const reasonCol = ensureColumn(
      sheet,
      headers,
      headerRowNumber,
      "Screening Reason",
      REASON_HEADERS,
    );

    for (let r = headerRowNumber + 1; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const id = digitsTenderId(cellText(row.getCell(idCol + 1)));
      if (!id) continue;
      const annotated = annotatedRows[importIndex];
      if (!annotated) {
        throw new Error(
          `DUPLICATE_MARK_ROW_MISMATCH sheet=${sheet.name} row=${r} importIndex=${importIndex} annotated=${annotatedRows.length}`,
        );
      }
      if (annotated.duplicateMark) {
        row.getCell(statusCol).value = "DUPLICATE";
        row.getCell(reasonCol).value = annotated.duplicateMark.reason;
        marked += 1;
      }
      importIndex += 1;
    }
  }

  if (importIndex !== annotatedRows.length) {
    throw new Error(
      `DUPLICATE_MARK_ROW_MISMATCH enumerated=${importIndex} annotated=${annotatedRows.length}`,
    );
  }

  await workbook.xlsx.writeFile(workbookPath);
  log(logger, `SCREENING_DUPLICATE_MARKED_IN_GPT_INPUT=${marked}`);
  log(logger, `SCREENING_GPT_INPUT_ENUMERATED_ROWS=${importIndex}`);
  return { marked, enumeratedRows: importIndex };
}

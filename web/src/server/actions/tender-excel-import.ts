"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";

import { parseInrInput } from "@/lib/format-inr";
import { requirePermissionStrict } from "@/server/auth/permissions";
import {
  type ExcelTenderImportRow,
  upsertExcelTenders,
} from "@/server/repositories/tenderExcelImportRepository";

type ImportResult =
  | { ok: true; upserted: number; skipped: number; sheets: number }
  | { ok: false; error: string };

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function text(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return "";
  if (typeof value === "object" && "text" in value) return String(value.text || "").trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findColumn(headers: Map<string, number>, aliases: string[]): number | null {
  for (const alias of aliases) {
    const exact = headers.get(normalizedHeader(alias));
    if (exact != null) return exact;
  }
  for (const [header, index] of headers) {
    if (aliases.some((alias) => header.includes(normalizedHeader(alias)))) return index;
  }
  return null;
}

function cellText(row: ExcelJS.Row, column: number | null): string {
  return column == null ? "" : text(row.getCell(column).value);
}

function dateOnly(value: string): string | null {
  const match = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!match) return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const month = Number(match[2]);
  const day = Number(match[1]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function locationParts(location: string): { city: string | null; state: string | null } {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  return { city: parts[0] || null, state: parts[1] || null };
}

function rawRow(row: ExcelJS.Row, columns: Array<{ header: string; index: number }>): Record<string, string> {
  return Object.fromEntries(
    columns
      .map(({ header, index }) => [header, cellText(row, index)] as const)
      .filter(([, value]) => value),
  );
}

function readSheet(sheet: ExcelJS.Worksheet, scrapedDate: string): { rows: ExcelTenderImportRow[]; skipped: number } {
  const headers = new Map<string, number>();
  const columns: Array<{ header: string; index: number }> = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, index) => {
    const header = text(cell.value);
    if (!header) return;
    headers.set(normalizedHeader(header), index);
    columns.push({ header, index });
  });

  const idColumn = findColumn(headers, ["t247 id", "tender247 id"]);
  const titleColumn = findColumn(headers, ["tender brief", "tender title", "title"]);
  if (idColumn == null || titleColumn == null) return { rows: [], skipped: Math.max(0, sheet.rowCount - 1) };

  const referenceColumn = findColumn(headers, ["reference no", "reference number"]);
  const valueColumn = findColumn(headers, ["estimated cost", "estimated bid value", "tender value", "value"]);
  const deadlineColumn = findColumn(headers, ["deadline", "closing date"]);
  const openingColumn = findColumn(headers, ["bid opening date", "pre bid meeting date"]);
  const locationColumn = findColumn(headers, ["location"]);
  const organizationColumn = findColumn(headers, ["organization", "organisation"]);
  const emdColumn = findColumn(headers, ["emd"]);
  const categoryColumn = findColumn(headers, ["similar category", "category"]);

  const rows: ExcelTenderImportRow[] = [];
  let skipped = 0;
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const sourceTenderId = cellText(row, idColumn).replace(/\D/g, "");
    const title = cellText(row, titleColumn);
    if (!sourceTenderId || !title) {
      if (row.cellCount > 0) skipped += 1;
      continue;
    }
    const locationText = cellText(row, locationColumn) || null;
    const location = locationParts(locationText || "");
    const tenderValueText = cellText(row, valueColumn) || null;
    const emdText = cellText(row, emdColumn) || null;
    const titleCell = row.getCell(titleColumn).value;
    const sourceUrl = typeof titleCell === "object" && titleCell && "hyperlink" in titleCell
      ? String(titleCell.hyperlink || "") || null
      : null;
    rows.push({
      sourceTenderId,
      referenceNo: cellText(row, referenceColumn) || null,
      title,
      organization: cellText(row, organizationColumn) || null,
      locationText,
      city: location.city,
      state: location.state,
      closingDate: dateOnly(cellText(row, deadlineColumn)),
      openingDate: dateOnly(cellText(row, openingColumn)),
      tenderValue: tenderValueText ? parseInrInput(tenderValueText) : null,
      tenderValueText,
      emdAmount: emdText ? parseInrInput(emdText) : null,
      emdText,
      sourceUrl,
      category: cellText(row, categoryColumn) || null,
      rawMetadata: {
        importedFromExcel: true,
        excelSheetName: sheet.name,
        excelRowNumber: index,
        scrapedDate,
        excelColumns: rawRow(row, columns),
      },
    });
  }
  return { rows, skipped };
}

export async function importTendersFromExcelAction(input: {
  fileName: string;
  fileBase64: string;
  scrapedDate: string;
}): Promise<ImportResult> {
  try {
    await requirePermissionStrict("tenders.import");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scrapedDate)) {
      return { ok: false, error: "Choose the scraped date for this Excel batch." };
    }
    const bytes = Buffer.from(input.fileBase64, "base64");
    if (!input.fileName.toLowerCase().endsWith(".xlsx") || bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) {
      return { ok: false, error: "Upload an .xlsx file no larger than 8 MB." };
    }
    const workbook = new ExcelJS.Workbook();
    // ExcelJS types predate Node's resizable ArrayBuffer generics.
    await workbook.xlsx.load(bytes as never);
    const parsed = workbook.worksheets.map((sheet) => readSheet(sheet, input.scrapedDate));
    const byIdentity = new Map<string, ExcelTenderImportRow>();
    for (const row of parsed.flatMap((result) => result.rows)) {
      byIdentity.set(row.sourceTenderId, row);
    }
    const rows = [...byIdentity.values()];
    if (rows.length === 0) {
      return { ok: false, error: "No Tender247 rows were found. The file needs T247 ID and Tender Brief columns." };
    }
    const result = await upsertExcelTenders(rows, input.scrapedDate);
    revalidatePath("/tenders", "layout");
    revalidatePath("/dashboard");
    return {
      ok: true,
      upserted: result.upserted,
      skipped: parsed.reduce((count, result) => count + result.skipped, 0),
      sheets: parsed.filter((result) => result.rows.length > 0).length,
    };
  } catch (error) {
    console.error("[tender-excel-import]", error);
    return { ok: false, error: "The Excel import could not be completed. Check the file and try again." };
  }
}

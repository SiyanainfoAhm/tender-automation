import ExcelJS from "exceljs";

import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

import {
  exportMoneyCellValue,
  formatExemptionExport,
  tenderExportReason,
  tenderExportStatusLabel,
  toExcelDate,
} from "./tender-export-utils";

const CURRENCY_FMT = '"₹"#,##0';
const DATE_FMT = "dd-mm-yyyy";
const TEXT_FMT = "@";

export async function buildTenderExportWorkbookBuffer(
  rows: WebTenderListRow[],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tenderflow";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Tenders");

  worksheet.columns = [
    { header: "Title", key: "title", width: 55 },
    { header: "Source", key: "source", width: 14 },
    { header: "Reference No.", key: "referenceNo", width: 38 },
    { header: "Organization", key: "organization", width: 32 },
    { header: "Category", key: "category", width: 22 },
    { header: "Status", key: "status", width: 18 },
    { header: "Reason", key: "reason", width: 65 },
    { header: "MSME Exemption", key: "msme", width: 18 },
    { header: "Startup Exemption", key: "startup", width: 18 },
    { header: "Scraped Date", key: "scrapedDate", width: 16 },
    { header: "Created At", key: "createdAt", width: 18 },
    { header: "Closing Date", key: "closingDate", width: 18 },
    { header: "Value", key: "value", width: 20 },
    { header: "EMD", key: "emd", width: 18 },
    { header: "Tender ID", key: "tenderId", width: 18 },
  ];

  for (const row of rows) {
    const added = worksheet.addRow({
      title: row.title ?? "",
      source: row.source_portal ?? "",
      referenceNo: row.reference_no ?? "",
      organization: row.organization ?? "",
      category: row.project_category || row.category || "",
      status: tenderExportStatusLabel(row.effective_qualification_status),
      reason: tenderExportReason(row),
      msme: formatExemptionExport(row.msme_exemption),
      startup: formatExemptionExport(row.startup_exemption),
      scrapedDate: toExcelDate(row.scraped_date),
      createdAt: toExcelDate(row.created_at),
      closingDate: toExcelDate(row.closing_date),
      value: exportMoneyCellValue(row.tender_value, row.tender_value_text),
      emd: exportMoneyCellValue(row.emd_amount, row.emd_text),
      tenderId: String(row.source_tender_id ?? ""),
    });

    const refCell = added.getCell("referenceNo");
    refCell.value = String(row.reference_no ?? "");
    refCell.numFmt = TEXT_FMT;

    const idCell = added.getCell("tenderId");
    idCell.value = String(row.source_tender_id ?? "");
    idCell.numFmt = TEXT_FMT;

    for (const key of ["scrapedDate", "createdAt", "closingDate"] as const) {
      const cell = added.getCell(key);
      if (cell.value instanceof Date) {
        cell.numFmt = DATE_FMT;
      }
    }

    for (const key of ["value", "emd"] as const) {
      const cell = added.getCell(key);
      if (typeof cell.value === "number") {
        cell.numFmt = CURRENCY_FMT;
      }
    }

    added.alignment = { vertical: "top", wrapText: true };
  }

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true,
  };
  headerRow.height = 26;

  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

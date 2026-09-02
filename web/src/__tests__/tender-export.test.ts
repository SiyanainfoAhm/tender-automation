import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildTenderExportWorkbookBuffer } from "@/lib/tender-export-xlsx";
import {
  buildTenderExportAllFilename,
  buildTenderPageExportFilename,
  exportDateStamp,
  exportMoneyCellValue,
  formatExemptionExport,
  tenderExportReason,
  tenderExportStatusLabel,
  toExcelDate,
  TENDER_EXPORT_COLUMN_HEADERS,
} from "@/lib/tender-export-utils";
import type { WebTenderListRow } from "@/server/repositories/tenderRepository";

function sampleRow(
  overrides: Partial<WebTenderListRow> = {},
): WebTenderListRow {
  return {
    id: "uuid-1",
    source_portal: "TENDER247",
    source_tender_id: "103894240",
    folder_id: "103894240",
    reference_no: "GEM/2026/B/7979620",
    title: "Sample tender",
    organization: "Dept A",
    department: null,
    authority: null,
    category: "Website",
    project_category: "Website / Web Portal",
    city: null,
    state: null,
    location_text: "Mumbai",
    published_date: null,
    opening_date: null,
    closing_date: "2026-09-30",
    bid_submission_date: null,
    tender_value: 1000000,
    tender_value_text: null,
    emd_amount: 25000,
    emd_text: null,
    currency: "INR",
    source_url: null,
    download_status: "DISCOVERED",
    qualification_status: "NO_GO",
    prescreen_status: null,
    prescreen_reason_code: null,
    prescreen_reason: null,
    chatgpt_eligible: null,
    decision_source: null,
    prescreened_at: null,
    prescreen_rules_version: null,
    decision_label: null,
    verdict: null,
    reason: "Outside preferred geography",
    screening_reason: "EMD exceeds limit",
    required_action: null,
    confidence: null,
    manual_review_required: null,
    qualified_at: null,
    crawled_at: null,
    created_at: "2026-08-31T00:00:00.000Z",
    scraped_date: "2026-08-31",
    first_seen_at: null,
    updated_at: "2026-08-31T00:00:00.000Z",
    effective_qualification_status: "NO_GO",
    chat_url: null,
    msme_exemption: true,
    startup_exemption: false,
    ...overrides,
  };
}

describe("tender export utils", () => {
  it("includes reason and exemption columns", () => {
    expect(TENDER_EXPORT_COLUMN_HEADERS).toEqual(
      expect.arrayContaining([
        "Reason",
        "MSME Exemption",
        "Startup Exemption",
        "Reference No.",
        "Closing Date",
      ]),
    );
  });

  it("prefers screening_reason over qualification reason", () => {
    expect(
      tenderExportReason(
        sampleRow({
          screening_reason: "Screening text",
          reason: "Qual text",
        }),
      ),
    ).toBe("Screening text");
  });

  it("formats exemption blanks", () => {
    expect(formatExemptionExport(null)).toBe("");
    expect(formatExemptionExport(true)).toBe("Yes");
    expect(formatExemptionExport(false)).toBe("No");
  });

  it("maps status to UI labels", () => {
    expect(tenderExportStatusLabel("NO_GO")).toBe("No Bid");
    expect(tenderExportStatusLabel("CONDITIONAL_GO")).toBe("May Bid");
  });

  it("exportMoneyCellValue distinguishes zero from not disclosed", () => {
    expect(exportMoneyCellValue(0, null)).toBe(0);
    expect(exportMoneyCellValue(null, null)).toBe("Not disclosed");
    expect(exportMoneyCellValue(48000, null)).toBe(48000);
  });

  it("toExcelDate parses ISO dates without timezone shift", () => {
    const date = toExcelDate("2026-08-31");
    expect(date).toBeInstanceOf(Date);
    expect((date as Date).getFullYear()).toBe(2026);
    expect((date as Date).getMonth()).toBe(7);
    expect((date as Date).getDate()).toBe(31);
  });

  it("buildTenderExportAllFilename uses dd-mm-yyyy", () => {
    expect(buildTenderExportAllFilename()).toBe(
      `tenders-${exportDateStamp()}.xlsx`,
    );
    expect(buildTenderPageExportFilename(1)).toMatch(
      /^tenders-page-1-\d{2}-\d{2}-\d{4}\.xlsx$/,
    );
  });
});

describe("tender export xlsx", () => {
  it("writes tender id and reference as text with proper formatting", async () => {
    const buffer = await buildTenderExportWorkbookBuffer([sampleRow()]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.getWorksheet("Tenders");
    expect(sheet).toBeDefined();

    const dataRow = sheet!.getRow(2);
    const tenderIdCell = dataRow.getCell(15);
    const referenceCell = dataRow.getCell(3);
    const emdCell = dataRow.getCell(14);
    const valueCell = dataRow.getCell(13);
    const statusCell = dataRow.getCell(6);
    const msmeCell = dataRow.getCell(8);
    const closingCell = dataRow.getCell(12);

    expect(tenderIdCell.value).toBe("103894240");
    expect(tenderIdCell.numFmt).toBe("@");
    expect(referenceCell.value).toBe("GEM/2026/B/7979620");
    expect(referenceCell.numFmt).toBe("@");
    expect(emdCell.value).toBe(25000);
    expect(emdCell.numFmt).toBe('"₹"#,##0');
    expect(valueCell.value).toBe(1000000);
    expect(statusCell.value).toBe("No Bid");
    expect(msmeCell.value).toBe("Yes");
    expect(closingCell.value).toBeInstanceOf(Date);
    expect(closingCell.numFmt).toBe("dd-mm-yyyy");

    expect(sheet!.views?.[0]?.state).toBe("frozen");
    expect(sheet!.autoFilter).toBeDefined();
    expect(sheet!.getRow(1).font?.bold).toBe(true);
  });

  it("exports not disclosed value and zero emd correctly", async () => {
    const buffer = await buildTenderExportWorkbookBuffer([
      sampleRow({
        tender_value: null,
        tender_value_text: "Not disclosed",
        emd_amount: 0,
        emd_text: null,
      }),
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Tenders")!;
    const row = sheet.getRow(2);

    expect(row.getCell(13).value).toBe("Not disclosed");
    expect(row.getCell(14).value).toBe(0);
    expect(row.getCell(14).numFmt).toBe('"₹"#,##0');
  });
});

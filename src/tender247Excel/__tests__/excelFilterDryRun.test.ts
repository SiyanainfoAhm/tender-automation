import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import XLSX from "xlsx";
import {
  applyExcelEarlyFinancialFilter,
  evaluateExcelFinancialGate,
  formatInrReviewDisplay,
  resolveExcelEmd,
  resolveExcelTenderValue,
} from "../../tender247Batch/excelEarlyFinancialFilter.js";
import {
  assertDryRunModuleHasNoSideEffectImports,
  parseExcelFilterDryRunArgs,
  runExcelFilterDryRunOnFile,
} from "../testTender247ExcelFilter.js";

const THRESHOLDS = {
  tenderValueMaxInr: 50_000_000,
  tender247EmdMaxInr: 1_500_000,
};

test("dry-run thresholds: value boundaries", () => {
  assert.equal(
    evaluateExcelFinancialGate(
      { sourceTenderId: "1", title: "t", rawTenderValue: 49_999_999, rawEmd: null },
      THRESHOLDS,
    ).status,
    "KEEP",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      { sourceTenderId: "2", title: "t", rawTenderValue: 50_000_000, rawEmd: null },
      THRESHOLDS,
    ).status,
    "KEEP",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      { sourceTenderId: "3", title: "t", rawTenderValue: 50_000_001, rawEmd: null },
      THRESHOLDS,
    ).status,
    "DROP",
  );
});

test("dry-run thresholds: EMD boundaries", () => {
  assert.equal(
    evaluateExcelFinancialGate(
      { sourceTenderId: "1", title: "t", rawTenderValue: null, rawEmd: 1_499_999 },
      THRESHOLDS,
    ).status,
    "KEEP",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      { sourceTenderId: "2", title: "t", rawTenderValue: null, rawEmd: 1_500_000 },
      THRESHOLDS,
    ).status,
    "KEEP",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      { sourceTenderId: "3", title: "t", rawTenderValue: null, rawEmd: 1_500_001 },
      THRESHOLDS,
    ).status,
    "DROP",
  );
});

test("dry-run missing financials keep; both over uses BOTH reason", () => {
  assert.equal(
    evaluateExcelFinancialGate(
      { sourceTenderId: "a", title: "t", rawTenderValue: "", rawEmd: "" },
      THRESHOLDS,
    ).reasonCode,
    "FINANCIAL_DATA_UNAVAILABLE_CONTINUE",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      {
        sourceTenderId: "b",
        title: "t",
        rawTenderValue: "Refer Documents",
        rawEmd: "Not Required",
      },
      THRESHOLDS,
    ).status,
    "KEEP",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      {
        sourceTenderId: "c",
        title: "t",
        rawTenderValue: 135_000_000,
        rawEmd: 2_700_000,
      },
      THRESHOLDS,
    ).reasonCode,
    "BOTH_VALUE_AND_EMD_ABOVE_LIMIT",
  );
});

test("Indian amount parsing for dry-run", () => {
  assert.equal(resolveExcelTenderValue("₹25 Lac").amountInr, 2_500_000);
  assert.equal(resolveExcelTenderValue("₹5 Cr").amountInr, 50_000_000);
  assert.equal(resolveExcelEmd("₹15 Lakh").amountInr, 1_500_000);
  assert.equal(formatInrReviewDisplay(40_392_530), "₹4.04 Cr");
  assert.equal(formatInrReviewDisplay(1_600_000), "₹16.00 L");
});

test("parseExcelFilterDryRunArgs reads date and file", () => {
  const parsed = parseExcelFilterDryRunArgs([
    "--date=2026-08-12",
    "--file=C:\\tmp\\a.xlsx",
  ]);
  assert.equal(parsed.date, "2026-08-12");
  assert.equal(parsed.file, "C:\\tmp\\a.xlsx");
});

test("dry-run on file writes review artifacts and never needs Supabase", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "excel-dry-"));
  const excelPath = path.join(dir, "Tender247_2026-08-12.xlsx");
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["T247 ID", "TENDER BRIEF", "ESTIMATED COST", "EMD", "Deadline"],
    ["111", "Keep within", 40_392_530, 807_900, "2026-08-20"],
    ["222", "Drop value", 50_000_001, "", "2026-08-21"],
    ["333", "Drop emd", "", 1_500_001, "2026-08-22"],
    ["444", "Drop both", 135_000_000, 2_700_000, "2026-08-23"],
    ["555", "Unavailable", "Refer Documents", "Not Required", "2026-08-24"],
  ]);
  XLSX.utils.book_append_sheet(wb, sheet, "Non-GeM Tenders");
  XLSX.writeFile(wb, excelPath);

  const { summary, review } = runExcelFilterDryRunOnFile({
    dateIso: "2026-08-12",
    excelPath,
    dateFolder: dir,
  });

  assert.equal(summary.excelRows, 5);
  assert.equal(summary.survivingTenderIds.sort().join(","), "111,555");
  assert.equal(summary.droppedByTenderValue, 1);
  assert.equal(summary.droppedByEmd, 1);
  assert.equal(summary.droppedByBoth, 1);
  assert.equal(fs.existsSync(review.keptPath), true);
  assert.equal(fs.existsSync(review.droppedPath), true);
  assert.equal(fs.existsSync(review.summaryPath), true);

  const summaryJson = JSON.parse(
    fs.readFileSync(review.summaryPath, "utf8"),
  ) as { supabaseWrites: boolean; detailCrawl: boolean; chatgpt: boolean };
  assert.equal(summaryJson.supabaseWrites, false);
  assert.equal(summaryJson.detailCrawl, false);
  assert.equal(summaryJson.chatgpt, false);
});

test("dry-run module source has no Supabase/ChatGPT write imports", () => {
  const src = fs.readFileSync(
    path.resolve("src/tender247Excel/testTender247ExcelFilter.ts"),
    "utf8",
  );
  assert.doesNotThrow(() => assertDryRunModuleHasNoSideEffectImports(src));
});

test("applyExcelEarlyFinancialFilter counts BOTH drops separately", () => {
  const summary = applyExcelEarlyFinancialFilter(
    [
      {
        sourceTenderId: "1",
        title: "both",
        rawTenderValue: 90_000_000,
        rawEmd: 2_000_000,
      },
    ],
    THRESHOLDS,
  );
  assert.equal(summary.droppedByBoth, 1);
  assert.equal(summary.droppedByTenderValue, 0);
  assert.equal(summary.droppedByEmd, 0);
});

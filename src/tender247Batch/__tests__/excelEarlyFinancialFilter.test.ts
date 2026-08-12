import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import XLSX from "xlsx";
import {
  applyExcelEarlyFinancialFilter,
  evaluateExcelFinancialGate,
  shouldDetailCrawlExcelSurvivor,
} from "../excelEarlyFinancialFilter.js";
import { writeExcelFilterAudit, readExcelFilterAudit } from "../excelFilterAudit.js";
import { parseTender247DailyExcelRows } from "../parseDailyExcelRows.js";

const THRESHOLDS = {
  tenderValueMaxInr: 50_000_000,
  tender247EmdMaxInr: 1_500_000,
};

test("Excel examples A–I financial gate", () => {
  const cases = [
    {
      id: "A",
      value: 40_392_530,
      emd: 807_900,
      status: "KEEP",
      reason: "WITHIN_FINANCIAL_LIMITS",
    },
    {
      id: "B",
      value: 29_000_000,
      emd: 100_000,
      status: "KEEP",
      reason: "WITHIN_FINANCIAL_LIMITS",
    },
    {
      id: "C",
      value: 16_000_000,
      emd: 1_600_000,
      status: "DROP",
      reason: "EMD_ABOVE_LIMIT",
    },
    {
      id: "D",
      value: 1_350_000_000,
      emd: 27_000_000,
      status: "DROP",
      reason: "BOTH_VALUE_AND_EMD_ABOVE_LIMIT",
    },
    {
      id: "E",
      value: "",
      emd: "",
      status: "KEEP",
      reason: "FINANCIAL_DATA_UNAVAILABLE_CONTINUE",
    },
    {
      id: "F",
      value: "Refer Documents",
      emd: "Not Required",
      status: "KEEP",
      reason: "FINANCIAL_DATA_UNAVAILABLE_CONTINUE",
    },
    {
      id: "G",
      value: 50_000_000,
      emd: 1_500_000,
      status: "KEEP",
      reason: "WITHIN_FINANCIAL_LIMITS",
    },
    {
      id: "H",
      value: 50_000_001,
      emd: "",
      status: "DROP",
      reason: "TENDER_VALUE_ABOVE_LIMIT",
    },
    {
      id: "I",
      value: "",
      emd: 1_500_001,
      status: "DROP",
      reason: "EMD_ABOVE_LIMIT",
    },
  ] as const;

  for (const c of cases) {
    const d = evaluateExcelFinancialGate(
      {
        sourceTenderId: c.id,
        title: `Tender ${c.id}`,
        rawTenderValue: c.value,
        rawEmd: c.emd,
      },
      THRESHOLDS,
    );
    assert.equal(d.status, c.status, `case ${c.id} status`);
    assert.equal(d.reasonCode, c.reason, `case ${c.id} reason`);
  }
});

test("exact ₹5 crore and ₹15 lakh continue; one over is enough to drop", () => {
  assert.equal(
    evaluateExcelFinancialGate(
      {
        sourceTenderId: "1",
        title: "t",
        rawTenderValue: "₹5 Cr",
        rawEmd: "₹15 Lakh",
      },
      THRESHOLDS,
    ).status,
    "KEEP",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      {
        sourceTenderId: "2",
        title: "t",
        rawTenderValue: "₹5.01 Cr",
        rawEmd: null,
      },
      THRESHOLDS,
    ).reasonCode,
    "TENDER_VALUE_ABOVE_LIMIT",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      {
        sourceTenderId: "3",
        title: "t",
        rawTenderValue: null,
        rawEmd: "₹20 Lac",
      },
      THRESHOLDS,
    ).reasonCode,
    "EMD_ABOVE_LIMIT",
  );
});

test("missing value + excessive EMD drops; excessive value + missing EMD drops", () => {
  assert.equal(
    evaluateExcelFinancialGate(
      {
        sourceTenderId: "mv",
        title: "t",
        rawTenderValue: "Not Disclosed",
        rawEmd: 2_000_000,
      },
      THRESHOLDS,
    ).status,
    "DROP",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      {
        sourceTenderId: "me",
        title: "t",
        rawTenderValue: 80_000_000,
        rawEmd: "As per RFP",
      },
      THRESHOLDS,
    ).status,
    "DROP",
  );
});

test("dropped IDs never enter detail crawl set; kept IDs do", () => {
  const summary = applyExcelEarlyFinancialFilter(
    [
      {
        sourceTenderId: "100",
        title: "keep",
        rawTenderValue: 10_000_000,
        rawEmd: 100_000,
      },
      {
        sourceTenderId: "200",
        title: "drop-emd",
        rawTenderValue: 10_000_000,
        rawEmd: 2_000_000,
      },
      {
        sourceTenderId: "300",
        title: "drop-value",
        rawTenderValue: 90_000_000,
        rawEmd: 100_000,
      },
    ],
    THRESHOLDS,
  );

  const survivors = new Set(summary.survivingTenderIds);
  assert.deepEqual([...survivors], ["100"]);
  assert.equal(shouldDetailCrawlExcelSurvivor("100", survivors), true);
  assert.equal(shouldDetailCrawlExcelSurvivor("200", survivors), false);
  assert.equal(shouldDetailCrawlExcelSurvivor("300", survivors), false);

  // Contract: DROP never reaches detail / docs / supabase / chatgpt callers
  // that gate on survivingTenderIds.
  const detailCalls: string[] = [];
  const downloadCalls: string[] = [];
  const supabaseCalls: string[] = [];
  const chatgptCalls: string[] = [];

  for (const id of ["100", "200", "300"]) {
    if (!shouldDetailCrawlExcelSurvivor(id, survivors)) {
      continue;
    }
    detailCalls.push(id);
    downloadCalls.push(id);
    supabaseCalls.push(id);
    // ChatGPT still requires detailed PASSED + chatgpt_eligible later.
    chatgptCalls.push(id);
  }

  assert.deepEqual(detailCalls, ["100"]);
  assert.deepEqual(downloadCalls, ["100"]);
  assert.deepEqual(supabaseCalls, ["100"]);
  assert.ok(!detailCalls.includes("200"));
  assert.ok(!supabaseCalls.includes("300"));
});

test("audit file records KEEP/DROP without tender folders", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "excel-audit-"));
  const summary = applyExcelEarlyFinancialFilter(
    [
      {
        sourceTenderId: "1",
        title: "ok",
        rawTenderValue: 1_000_000,
        rawEmd: 10_000,
      },
      {
        sourceTenderId: "2",
        title: "bad",
        rawTenderValue: 90_000_000,
        rawEmd: 10_000,
      },
    ],
    THRESHOLDS,
  );
  const out = writeExcelFilterAudit(dir, summary);
  assert.equal(fs.existsSync(out), true);
  assert.equal(fs.existsSync(path.join(dir, "T247-2")), false);

  const loaded = readExcelFilterAudit(dir);
  assert.ok(loaded);
  assert.equal(loaded!.excelRows, 2);
  assert.equal(loaded!.droppedByTenderValue, 1);
  assert.equal(loaded!.survivingTenderIds.length, 1);
});

test("parseDailyExcelRows uses header names not column letters", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "excel-parse-"));
  const filePath = path.join(dir, "Tender247_test.xlsx");
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["T247 ID", "TENDER BRIEF", "ESTIMATED COST", "EMD", "Deadline"],
    ["102667034", "Sample keep", 40_392_530, 807_900, "2026-08-20"],
    ["102667099", "Sample drop", "₹8 Cr", "₹20 Lac", "2026-08-21"],
    ["102667100", "Unavailable", "Refer Documents", "Not Required", "2026-08-22"],
  ]);
  XLSX.utils.book_append_sheet(wb, sheet, "Non-GeM Tenders");
  XLSX.writeFile(wb, filePath);

  const parsed = parseTender247DailyExcelRows(filePath);
  assert.equal(parsed.rows.length, 3);

  const filtered = applyExcelEarlyFinancialFilter(parsed.rows, THRESHOLDS);
  assert.equal(filtered.survivingTenderIds.includes("102667034"), true);
  assert.equal(filtered.survivingTenderIds.includes("102667099"), false);
  assert.equal(filtered.survivingTenderIds.includes("102667100"), true);
  assert.equal(
    filtered.droppedByTenderValue +
      filtered.droppedByEmd +
      filtered.droppedByBoth,
    1,
  );
});

test("BidAssist excel early filter module is Tender247-only (no BidAssist import)", () => {
  const filterSrc = fs.readFileSync(
    path.resolve("src/tender247Batch/excelEarlyFinancialFilter.ts"),
    "utf8",
  );
  const batchSrc = fs.readFileSync(
    path.resolve("src/tender247Batch/runDailyBatch.ts"),
    "utf8",
  );
  const bidassistCrawler = fs.readFileSync(
    path.resolve("src/bidassist/bidassistCrawler.ts"),
    "utf8",
  );
  assert.match(batchSrc, /downloadTender247DailyExcel/);
  assert.match(batchSrc, /survivingIds/);
  assert.doesNotMatch(bidassistCrawler, /excelEarlyFinancialFilter/);
  assert.doesNotMatch(filterSrc, /BIDASSIST/);
});

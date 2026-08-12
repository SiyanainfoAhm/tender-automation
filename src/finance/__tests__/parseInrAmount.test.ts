import assert from "node:assert/strict";
import test from "node:test";
import { parseInrAmount } from "../parseInrAmount.js";
import {
  applyExcelEarlyFinancialFilter,
  evaluateExcelFinancialGate,
  resolveExcelEmd,
  resolveExcelTenderValue,
} from "../../tender247Batch/excelEarlyFinancialFilter.js";

const THRESHOLDS = {
  tenderValueMaxInr: 50_000_000,
  tender247EmdMaxInr: 1_500_000,
};

test("parse plain integer strings", () => {
  assert.equal(parseInrAmount("56261544").amountInr, 56_261_544);
  assert.equal(parseInrAmount("135000000").amountInr, 135_000_000);
  assert.equal(parseInrAmount("153400000").amountInr, 153_400_000);
  assert.equal(parseInrAmount("50000000").amountInr, 50_000_000);
});

test("parse numbers and comma forms", () => {
  assert.equal(parseInrAmount(56_261_544).amountInr, 56_261_544);
  assert.equal(parseInrAmount("50,000,000").amountInr, 50_000_000);
  assert.equal(parseInrAmount("5,00,00,000").amountInr, 50_000_000);
  assert.equal(parseInrAmount("56,261,544").amountInr, 56_261_544);
});

test("parse currency-prefixed and unit forms", () => {
  assert.equal(parseInrAmount("₹56,261,544").amountInr, 56_261_544);
  assert.equal(parseInrAmount("Rs. 56,261,544").amountInr, 56_261_544);
  assert.equal(parseInrAmount("INR 56,261,544").amountInr, 56_261_544);
  assert.equal(parseInrAmount("₹5 Cr").amountInr, 50_000_000);
  assert.equal(parseInrAmount("5 Crore").amountInr, 50_000_000);
  assert.equal(parseInrAmount("5.63 Cr").amountInr, 56_300_000);
  assert.equal(parseInrAmount("1.5 Crore").amountInr, 15_000_000);
  assert.equal(parseInrAmount("15 Lakh").amountInr, 1_500_000);
  assert.equal(parseInrAmount("15 Lac").amountInr, 1_500_000);
  assert.equal(parseInrAmount("15 Lacs").amountInr, 1_500_000);
  assert.equal(parseInrAmount("25 Lac").amountInr, 2_500_000);
  assert.equal(parseInrAmount("11.25 Lakh").amountInr, 1_125_000);
});

test("placeholders remain unavailable", () => {
  for (const raw of [null, undefined, "", "N/A", "Not Available", "Not Disclosed", "-"]) {
    const parsed = parseInrAmount(raw as never);
    assert.equal(parsed.valid, false);
    assert.equal(parsed.amountInr, null);
  }
});

test("₹5 Cr and ₹15 L exact boundaries", () => {
  assert.equal(
    evaluateExcelFinancialGate(
      {
        sourceTenderId: "b1",
        title: "t",
        rawTenderValue: 50_000_000,
        rawEmd: 1_500_000,
      },
      THRESHOLDS,
    ).status,
    "KEEP",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      {
        sourceTenderId: "b2",
        title: "t",
        rawTenderValue: 50_000_001,
        rawEmd: null,
      },
      THRESHOLDS,
    ).reasonCode,
    "TENDER_VALUE_ABOVE_LIMIT",
  );
  assert.equal(
    evaluateExcelFinancialGate(
      {
        sourceTenderId: "b3",
        title: "t",
        rawTenderValue: null,
        rawEmd: 1_500_001,
      },
      THRESHOLDS,
    ).reasonCode,
    "EMD_ABOVE_LIMIT",
  );
});

test("103201275 regression: plain string 56261544 drops by tender value", () => {
  const value = resolveExcelTenderValue("56261544");
  const emd = resolveExcelEmd("1125231");
  assert.equal(value.amountInr, 56_261_544);
  assert.equal(value.unavailable, false);
  assert.equal(emd.amountInr, 1_125_231);
  assert.equal(emd.unavailable, false);

  const decision = evaluateExcelFinancialGate(
    {
      sourceTenderId: "103201275",
      title: "hiring of professionals",
      rawTenderValue: "56261544",
      rawEmd: "1125231",
    },
    THRESHOLDS,
  );
  assert.equal(decision.parsedTenderValueInr, 56_261_544);
  assert.equal(decision.parsedEmdInr, 1_125_231);
  assert.equal(decision.status, "DROP");
  assert.equal(decision.reasonCode, "TENDER_VALUE_ABOVE_LIMIT");
  assert.equal(decision.excelTenderValueUnavailable, false);
});

test("unique drop counting does not double-count both-over", () => {
  const summary = applyExcelEarlyFinancialFilter(
    [
      {
        sourceTenderId: "1",
        title: "a",
        rawTenderValue: 60_000_000,
        rawEmd: 2_000_000,
      },
      {
        sourceTenderId: "2",
        title: "b",
        rawTenderValue: 60_000_000,
        rawEmd: 100_000,
      },
      {
        sourceTenderId: "3",
        title: "c",
        rawTenderValue: 10_000_000,
        rawEmd: 2_000_000,
      },
      {
        sourceTenderId: "4",
        title: "d",
        rawTenderValue: 10_000_000,
        rawEmd: 100_000,
      },
    ],
    THRESHOLDS,
  );
  assert.equal(summary.excelRows, 4);
  assert.equal(summary.droppedByBoth, 1);
  assert.equal(summary.droppedByTenderValue, 1);
  assert.equal(summary.droppedByEmd, 1);
  const uniqueDrops =
    summary.droppedByTenderValue +
    summary.droppedByEmd +
    summary.droppedByBoth;
  assert.equal(uniqueDrops, 3);
  assert.equal(summary.detailCrawlsRequired, 1);
});

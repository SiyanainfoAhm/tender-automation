import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTender247ExcelPrescreen,
  dedupeTender247Candidates,
  evaluateDeadlineActionable,
  evaluateExcelScopeExclusions,
  evaluateTender247ExcelPrescreen,
} from "../tender247ExcelPrescreen.js";

const BUSINESS = "2026-08-12";

function row(
  partial: Partial<{
    sourceTenderId: string;
    title: string;
    rawTenderValue: string | number | null;
    rawEmd: string | number | null;
    deadline: string | null;
  }>,
) {
  return {
    sourceTenderId: partial.sourceTenderId ?? "1001",
    title: partial.title ?? "Website development for portal",
    rawTenderValue: partial.rawTenderValue ?? null,
    rawEmd: partial.rawEmd ?? null,
    deadline: partial.deadline ?? null,
  };
}

test("EMD ₹15,00,001 → dropped", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ rawEmd: 1_500_001 }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, false);
  assert.ok(r.reasons.includes("FILTER_EMD_EXCEEDED"));
});

test("EMD ₹15,00,000 → not dropped by EMD threshold", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ rawEmd: 1_500_000 }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, true);
  assert.ok(!r.reasons.includes("FILTER_EMD_EXCEEDED"));
});

test("EMD unknown → not dropped by EMD threshold", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ rawEmd: null }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, true);
  assert.equal(r.normalizedEmd ?? null, null);
});

test("Tender Value ₹5,00,00,001 → dropped", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ rawTenderValue: 50_000_001 }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, false);
  assert.ok(r.reasons.includes("FILTER_VALUE_EXCEEDED"));
});

test("Tender Value ₹5,00,00,000 → not dropped by value threshold", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ rawTenderValue: 50_000_000 }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, true);
});

test("Tender Value not disclosed → not dropped by threshold", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ rawTenderValue: "Not Disclosed" }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, true);
});

test("EOI → dropped", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ title: "EOI for software development services" }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, false);
  assert.ok(r.reasons.includes("FILTER_EOI"));
});

test("Empanelment → dropped", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ title: "Empanelment of IT vendors" }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, false);
  assert.ok(r.reasons.includes("FILTER_EMPANELMENT"));
});

test("Scanning-primary scope → dropped", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ title: "Bulk scanning and digitization of legacy records" }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, false);
  assert.ok(r.reasons.includes("FILTER_SCANNING_DIGITIZATION"));
});

test("digitization platform development is not auto-dropped as scanning", () => {
  const scope = evaluateExcelScopeExclusions(
    "Digitization platform development for citizen services",
  );
  assert.ok(!scope.reasons.includes("FILTER_SCANNING_DIGITIZATION"));
});

test("Internet/bandwidth-only → dropped", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ title: "Leased line bandwidth and internet service" }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, false);
  assert.ok(r.reasons.includes("FILTER_INTERNET_SERVICE"));
});

test("Non-IT → dropped", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ title: "Civil construction of office building" }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, false);
  assert.ok(r.reasons.includes("FILTER_NON_IT"));
});

test("Website development → passed IT relevance", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ title: "Website development for municipal corporation" }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, true);
  assert.equal(r.itRelevant, true);
});

test("Mobile app development → passed", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ title: "Mobile application development for citizen services" }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, true);
  assert.equal(r.itRelevant, true);
});

test("GIS application development → passed", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({ title: "GIS application development for land records" }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, true);
  assert.equal(r.itRelevant, true);
});

test("Hiring agency for IT project milestone basis → not auto-dropped", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({
      title: "Hiring of agency for IT projects – milestone basis",
    }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, true);
});

test("Unknown PQ details → not automatically dropped", () => {
  const r = evaluateTender247ExcelPrescreen(
    row({
      title: "Custom software development",
      rawTenderValue: null,
      rawEmd: null,
      deadline: null,
    }),
    { businessDateIso: BUSINESS },
  );
  assert.equal(r.passed, true);
});

test("Deadline same day / past → FILTER_DEADLINE_NOT_ACTIONABLE", () => {
  const same = evaluateDeadlineActionable("12/08/2026", BUSINESS);
  assert.equal(same.actionable, false);
  assert.equal(same.reason, "FILTER_DEADLINE_NOT_ACTIONABLE");

  const past = evaluateDeadlineActionable("2026-08-01", BUSINESS);
  assert.equal(past.actionable, false);

  const future = evaluateDeadlineActionable("2026-08-20", BUSINESS);
  assert.equal(future.actionable, true);

  const unknown = evaluateDeadlineActionable(null, BUSINESS);
  assert.equal(unknown.actionable, null);
});

test("dedupe removes duplicate Tender247 IDs", () => {
  const { deduped, rawCount, duplicatesRemoved } = dedupeTender247Candidates([
    row({ sourceTenderId: "1001", title: "A" }),
    row({ sourceTenderId: "1001", title: "A duplicate" }),
    row({ sourceTenderId: "1002", title: "B" }),
  ]);
  assert.equal(rawCount, 3);
  assert.equal(deduped.length, 2);
  assert.equal(duplicatesRemoved, 1);
});

test("applyTender247ExcelPrescreen logs aggregate drop counts", () => {
  const summary = applyTender247ExcelPrescreen(
    [
      row({ sourceTenderId: "1", title: "EOI for ERP", rawEmd: 1_600_000 }),
      row({
        sourceTenderId: "2",
        title: "Website development",
        rawTenderValue: 10_000_000,
        rawEmd: 100_000,
        deadline: "2026-09-01",
      }),
    ],
    { businessDateIso: BUSINESS },
  );
  assert.equal(summary.dailyRowsRaw, 2);
  assert.equal(summary.filterDropEoi, 1);
  assert.equal(summary.filterDropEmd, 1);
  assert.equal(summary.filterPassed, 1);
  assert.deepEqual(summary.survivingTenderIds, ["2"]);
});

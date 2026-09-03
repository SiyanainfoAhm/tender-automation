import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  formatIsoToDdMmYyyy,
  formatIsoToDdMmYyyySlash,
  parseIsoDateParts,
  parseMailDateDisplayToIso,
} from "../../dateUtils.js";
import {
  buildFilteredDateLabelRegex,
  evaluateMailDateExcelGate,
  mailDateInputMatchesRequested,
  monthStepsBetween,
  parseFilteredDateTabText,
} from "../selectTender247MailDate.js";

test("format helpers produce Tender247 display forms", () => {
  assert.equal(formatIsoToDdMmYyyy("2026-08-11"), "11-08-2026");
  assert.equal(formatIsoToDdMmYyyySlash("2026-08-11"), "11/08/2026");
  assert.equal(parseMailDateDisplayToIso("11/08/2026"), "2026-08-11");
  assert.equal(parseMailDateDisplayToIso("11-08-2026"), "2026-08-11");
});

test("current 12-Aug + requested 11-Aug → input must match 11-Aug", () => {
  assert.equal(mailDateInputMatchesRequested("12/08/2026", "2026-08-11"), false);
  assert.equal(mailDateInputMatchesRequested("11/08/2026", "2026-08-11"), true);
  const gate = evaluateMailDateExcelGate({
    requestedIso: "2026-08-11",
    selectedMailDateIso: "2026-08-11",
    mailDateInputValue: "11/08/2026",
    todayTendersCardText: "97\nToday Tenders\n(12-08-2026)",
  });
  assert.equal(gate.ok, true);
});

test("Today Tenders card still showing today does NOT override historical selection", () => {
  const gate = evaluateMailDateExcelGate({
    requestedIso: "2026-08-11",
    selectedMailDateIso: "2026-08-11",
    mailDateInputValue: "11/08/2026",
    todayTendersCardText: "Today Tenders (12-08-2026)",
  });
  assert.equal(gate.ok, true);
});

test("selected date mismatch → XLS blocked", () => {
  const gate = evaluateMailDateExcelGate({
    requestedIso: "2026-08-11",
    selectedMailDateIso: "2026-08-12",
    mailDateInputValue: "12/08/2026",
  });
  assert.equal(gate.ok, false);
  assert.match(gate.reason || "", /TENDER247_DATE_MISMATCH/);
  assert.match(gate.reason || "", /requested=2026-08-11/);
  assert.match(gate.reason || "", /selected=2026-08-12/);
});

test("requested date already selected → verify without requiring toggle", () => {
  assert.equal(mailDateInputMatchesRequested("11/08/2026", "2026-08-11"), true);
  const gate = evaluateMailDateExcelGate({
    requestedIso: "2026-08-11",
    selectedMailDateIso: "2026-08-11",
    mailDateInputValue: "11/08/2026",
  });
  assert.equal(gate.ok, true);
});

test("requested previous month → navigate delta is negative", () => {
  const current = { month: 8, year: 2026 };
  const target = parseIsoDateParts("2026-07-15");
  assert.equal(monthStepsBetween(current, target), -1);
});

test("requested next month → navigate delta is positive", () => {
  const current = { month: 8, year: 2026 };
  const target = parseIsoDateParts("2026-09-03");
  assert.equal(monthStepsBetween(current, target), 1);
});

test("historical filtered tab matches requested date only", () => {
  const re = buildFilteredDateLabelRegex("2026-08-11");
  assert.match("11-08-2026 (159)", re);
  assert.doesNotMatch("12-08-2026 (97)", re);
  const parsed = parseFilteredDateTabText("11-08-2026 (159)");
  assert.equal(parsed?.dateLabel, "11-08-2026");
  assert.equal(parsed?.count, 159);
});

test("Fresh tab compact counts parse for list readiness", () => {
  const parsed = parseFilteredDateTabText("Fresh (1.00 K)");
  assert.equal(parsed?.isFresh, true);
  assert.equal(parsed?.count, 1000);
});

test("historical requested date → mail_date remains historical through gate", () => {
  const requested = "2026-08-11";
  const gate = evaluateMailDateExcelGate({
    requestedIso: requested,
    selectedMailDateIso: requested,
    mailDateInputValue: formatIsoToDdMmYyyySlash(requested),
  });
  assert.equal(gate.ok, true);
  assert.equal(requested, "2026-08-11");
  assert.notEqual(requested, "2026-08-12");
});

test("Select Mail Date helper never uses fill() or JS value assignment", () => {
  const src = fs.readFileSync(
    new URL("../selectTender247MailDate.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(src, /\.fill\s*\(/);
  assert.doesNotMatch(src, /input\.value\s*=/);
  assert.match(src, /clickCalendarDay/);
  assert.match(src, /TENDER247_CALENDAR_DAY_CLICKED=/);
});

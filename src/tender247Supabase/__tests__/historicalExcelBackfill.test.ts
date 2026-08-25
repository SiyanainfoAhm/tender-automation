import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDatesFromSheetName,
  shouldSkipSheet,
  normalizeSheetKey,
} from "../excelSheetMeta.js";
import {
  toIsoDateOnly,
  normalizeCurrencyAmount,
  normalizeHistoricalStatus,
} from "../normalizeHistoricalTender.js";
import { parseHistoricalSheet, resolveScrapedDate } from "../excelSheetParser.js";

test("sheet skip logic: final / 24 / 21 22 23", () => {
  assert.equal(shouldSkipSheet("final"), true);
  assert.equal(shouldSkipSheet("Final"), true);
  assert.equal(shouldSkipSheet("24"), true);
  assert.equal(shouldSkipSheet("21 22 23"), true);
  assert.equal(shouldSkipSheet("21 22 23 "), true);
  assert.equal(shouldSkipSheet("21 22 23 aug"), true);
  assert.equal(shouldSkipSheet("18 aug"), false);
  assert.equal(shouldSkipSheet("8 9 10 Aug"), false);
});

test("parseDatesFromSheetName covers combined tabs", () => {
  assert.deepEqual(parseDatesFromSheetName("4 aug"), ["2026-08-04"]);
  assert.deepEqual(parseDatesFromSheetName("13 Aug"), ["2026-08-13"]);
  assert.deepEqual(parseDatesFromSheetName("19 & 20 aug"), [
    "2026-08-19",
    "2026-08-20",
  ]);
  assert.deepEqual(parseDatesFromSheetName("14 15 16 aug"), [
    "2026-08-14",
    "2026-08-15",
    "2026-08-16",
  ]);
  assert.deepEqual(parseDatesFromSheetName("8 9 10 Aug"), [
    "2026-08-08",
    "2026-08-09",
    "2026-08-10",
  ]);
  assert.deepEqual(parseDatesFromSheetName("21 22 23"), [
    "2026-08-21",
    "2026-08-22",
    "2026-08-23",
  ]);
  assert.equal(normalizeSheetKey("19 & 20 aug"), "19 20 aug");
});

test("currency normalization", () => {
  assert.equal(normalizeCurrencyAmount("₹3,72,780").amount, 372780);
  assert.equal(normalizeCurrencyAmount("₹98,10,00,000").amount, 981000000);
  assert.equal(normalizeCurrencyAmount("₹0").amount, 0);
  assert.equal(normalizeCurrencyAmount("").amount, null);
  assert.equal(normalizeCurrencyAmount("-").amount, null);
  assert.equal(normalizeCurrencyAmount("N/A").amount, null);
});

test("date-only normalization never shifts 04-08-2026", () => {
  assert.equal(toIsoDateOnly("04-08-2026"), "2026-08-04");
  assert.equal(toIsoDateOnly("04/08/2026"), "2026-08-04");
  assert.equal(toIsoDateOnly("2026-08-04"), "2026-08-04");
  // Date object near IST end-of-day must stay on calendar day in India
  assert.equal(
    toIsoDateOnly(new Date("2026-08-04T18:29:50.000Z")),
    "2026-08-04",
  );
});

test("status aliases", () => {
  assert.equal(normalizeHistoricalStatus("NO_BID"), "NO_GO");
  assert.equal(normalizeHistoricalStatus("NO GO"), "NO_GO");
  assert.equal(normalizeHistoricalStatus("No_Bid"), "NO_GO");
  assert.equal(normalizeHistoricalStatus("GO"), "GO");
  assert.equal(normalizeHistoricalStatus("VERIFY"), "VERIFY");
});

test("headered sheet parse maps T247 ID2", () => {
  const matrix = [
    [
      "T247 ID2",
      "Portal",
      "Reference No.",
      "Tender Brief",
      "Estimated Value",
      "Deadline",
      "Location",
      "EMD",
      "MSME Exemption",
      "Startup Exemption",
      "Status",
      "Decision Reason",
    ],
    [
      "103085535",
      "Tender247",
      "REF-1",
      "Website redesign",
      "₹13,45,000",
      "20-08-2026",
      "Bangalore",
      "39678",
      "Yes",
      "No",
      "NO_BID",
      "Outside scope",
    ],
  ];
  const parsed = parseHistoricalSheet("18 aug", matrix);
  assert.equal(parsed.skipped, false);
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.validRows[0]!.sourceTenderId, "103085535");
  assert.equal(parsed.validRows[0]!.scrapedDate, "2026-08-18");
  assert.equal(parsed.validRows[0]!.qualificationStatus, "NO_GO");
  assert.equal(parsed.validRows[0]!.closingDate, "2026-08-20");
  assert.equal(parsed.validRows[0]!.tenderValue, 1345000);
});

test("combined sheet with per-row date uses row date when in sheetDates", () => {
  const matrix = [
    [
      "10-08-2026",
      "Non-GeM",
      103153618,
      "REF",
      "RTU work",
      38501291.58,
      "03-09-2026",
      "Sealdah",
      770000,
      "Non-IT",
      "NO GO",
      "Not relevant",
    ],
  ];
  const parsed = parseHistoricalSheet("8 9 10 Aug", matrix);
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.validRows[0]!.scrapedDate, "2026-08-10");
  assert.equal(parsed.validRows[0]!.sourceTenderId, "103153618");
  assert.equal(parsed.validRows[0]!.qualificationStatus, "NO_GO");
});

test("single-date sheet prefers tab date over mismatched row date", () => {
  assert.equal(
    resolveScrapedDate("2026-08-06", ["2026-08-07"]),
    "2026-08-07",
  );
  assert.equal(
    resolveScrapedDate("2026-08-10", ["2026-08-08", "2026-08-09", "2026-08-10"]),
    "2026-08-10",
  );
  assert.equal(
    resolveScrapedDate("2026-08-01", ["2026-08-08", "2026-08-09", "2026-08-10"]),
    "2026-08-08",
  );
});

test("single-date sheet ignores wrong Excel row date column", () => {
  const matrix = [
    [
      "T247 ID",
      "Portal",
      "Reference No.",
      "Tender Brief",
      "Estimated Value",
      "Deadline",
      "Location",
      "EMD",
      "MSME Exemption",
      "Startup Exemption",
      "Status",
      "Decision Reason",
      "Date",
    ],
    [
      "102561151",
      "Tender247",
      "REF-7",
      "PLC panel",
      "₹1,00,000",
      "13-08-2026",
      "Delhi",
      "0",
      "No",
      "No",
      "NO_BID",
      "Outside scope",
      "06-08-2026",
    ],
  ];
  const parsed = parseHistoricalSheet("7 Aug", matrix);
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.validRows[0]!.scrapedDate, "2026-08-07");
});

test("skip sheet parse short-circuits", () => {
  const parsed = parseHistoricalSheet("21 22 23", [[103, "Tender247"]]);
  assert.equal(parsed.skipped, true);
  assert.equal(parsed.validRows.length, 0);
});

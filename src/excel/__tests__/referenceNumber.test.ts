import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanReferenceNumber,
  referenceNoForWorkbookRow,
  referenceNoFromExcel,
} from "../referenceNumber.js";

test("cleanReferenceNumber preserves punctuation and trims whitespace", () => {
  assert.equal(
    cleanReferenceNumber("  PGVCL/Tech/RMU BOP/2026-27/34:327612:  "),
    "PGVCL/Tech/RMU BOP/2026-27/34:327612:",
  );
});

test("referenceNoFromExcel rejects placeholder tokens", () => {
  assert.equal(referenceNoFromExcel("N/A"), null);
  assert.equal(referenceNoFromExcel("PGVCL/2026/34"), "PGVCL/2026/34");
});

test("referenceNoForWorkbookRow prefers referenceNo over legacy bidAssistId", () => {
  assert.equal(
    referenceNoForWorkbookRow({
      tender247Id: "103894240",
      referenceNo: "PGVCL/Tech/RMU BOP/2026-27/34:327612:",
      bidAssistId: "",
    }),
    "PGVCL/Tech/RMU BOP/2026-27/34:327612:",
  );
  assert.equal(
    referenceNoForWorkbookRow({
      tender247Id: "103894240",
      referenceNo: "",
      bidAssistId: "PGVCL/Tech/RMU BOP/2026-27/34:327612:",
    }),
    "PGVCL/Tech/RMU BOP/2026-27/34:327612:",
  );
  assert.equal(
    referenceNoForWorkbookRow({
      tender247Id: "103894240",
      referenceNo: "",
      bidAssistId: "103894240",
    }),
    null,
  );
});

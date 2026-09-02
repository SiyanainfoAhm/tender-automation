import assert from "node:assert/strict";
import test from "node:test";

import {
  annotateImportDuplicates,
  authorityBriefDeadlineKey,
  isValidReferenceNumber,
  referenceKey,
  type HistoricalTenderIndex,
} from "../duplicateScreening.js";
import { mergeScreeningResults } from "../mergeScreeningResults.js";
import type { RunWorkbookRow } from "../runWorkbook.js";

function row(overrides: Partial<RunWorkbookRow> & { tender247Id?: string }): RunWorkbookRow {
  const t247 = overrides.tender247Id || "1001";
  return {
    canonicalId: `T247-${t247}`,
    source: "TENDER247",
    tender247Id: t247,
    referenceNo: overrides.referenceNo || "",
    bidAssistId: overrides.bidAssistId || "",
    tenderName: overrides.tenderName || "CMS website",
    organization: overrides.organization || "Dept A",
    location: "TN",
    deadline: overrides.deadline || "2026-09-15",
    estimatedCost: "100000",
    emdAmount: "10000",
    sourceRefs: "TENDER247",
    screeningStatus: "",
    screeningReason: "",
    ...overrides,
  };
}

function emptyHistory(): HistoricalTenderIndex {
  return {
    byTender247Id: new Map(),
    byReference: new Map(),
    byAuthorityBriefDeadline: new Map(),
  };
}

test("isValidReferenceNumber rejects placeholder reference tokens", () => {
  assert.equal(isValidReferenceNumber("GEM/2026/001"), true);
  assert.equal(isValidReferenceNumber("-"), false);
  assert.equal(isValidReferenceNumber("N/A"), false);
  assert.equal(isValidReferenceNumber("00"), false);
  assert.equal(isValidReferenceNumber(""), false);
});

test("annotateImportDuplicates marks internal Tender247 ID duplicates without removing rows", () => {
  const annotated = annotateImportDuplicates(
    [row({ tender247Id: "1001" }), row({ tender247Id: "1001", tenderName: "Dup" })],
    emptyHistory(),
  );
  assert.equal(annotated.length, 2);
  assert.equal(annotated[0]?.duplicateMark, undefined);
  assert.equal(annotated[1]?.duplicateMark?.kind, "tender247_id");
  assert.match(
    annotated[1]?.duplicateMark?.reason || "",
    /Duplicate Tender247 ID: 1001/,
  );
});

test("annotateImportDuplicates marks historical matches before internal duplicates", () => {
  const history = emptyHistory();
  history.byTender247Id.set("2002", {
    tender247Id: "2002",
    referenceNumber: null,
    organization: "Dept B",
    tenderName: "Historical tender",
    deadline: "2026-09-01",
    runDate: "2026-08-20",
  });
  const annotated = annotateImportDuplicates([row({ tender247Id: "2002" })], history);
  assert.equal(annotated[0]?.duplicateMark?.kind, "historical");
  assert.match(
    annotated[0]?.duplicateMark?.reason || "",
    /Already reviewed tender: matches existing Tender247 ID 2002 from 2026-08-20/,
  );
});

test("annotateImportDuplicates matches valid reference numbers", () => {
  const annotated = annotateImportDuplicates(
    [
      row({ tender247Id: "3001", referenceNo: "GEM/2026/ABC" }),
      row({ tender247Id: "3002", referenceNo: "GEM/2026/ABC" }),
    ],
    emptyHistory(),
  );
  assert.equal(annotated[1]?.duplicateMark?.kind, "reference");
  assert.match(
    annotated[1]?.duplicateMark?.reason || "",
    /Duplicate Reference Number: GEM\/2026\/ABC/,
  );
});

test("annotateImportDuplicates matches authority + brief + deadline", () => {
  const annotated = annotateImportDuplicates(
    [
      row({ tender247Id: "4001", organization: "Dept C", tenderName: "Portal", deadline: "15-09-2026" }),
      row({ tender247Id: "4002", organization: "Dept C", tenderName: "Portal", deadline: "2026-09-15" }),
    ],
    emptyHistory(),
  );
  assert.equal(annotated[1]?.duplicateMark?.kind, "authority_brief_deadline");
  assert.match(
    annotated[1]?.duplicateMark?.reason || "",
    /same Authority, Tender Brief, and Deadline/,
  );
});

test("mergeScreeningResults preserves DUPLICATE rows and merges GPT decisions for screenable rows", () => {
  const importRows = annotateImportDuplicates(
    [
      row({ tender247Id: "5001", tenderName: "Alpha" }),
      row({ tender247Id: "5001", tenderName: "Alpha duplicate" }),
    ],
    emptyHistory(),
  );
  const merged = mergeScreeningResults({
    importRows,
    gptRows: [
      {
        ...row({ tender247Id: "5001" }),
        screeningStatus: "NO_GO",
        screeningReason: "Out of scope",
      },
    ],
  });
  assert.equal(merged.rows.length, 2);
  assert.equal(merged.rows[0]?.screeningStatus, "NO_GO");
  assert.equal(merged.rows[1]?.screeningStatus, "DUPLICATE");
  assert.match(merged.rows[1]?.screeningReason || "", /Duplicate Tender247 ID/);
});

test("referenceKey and authorityBriefDeadlineKey normalize consistently", () => {
  assert.equal(referenceKey(" GEM/1 "), referenceKey("gem/1"));
  assert.equal(
    authorityBriefDeadlineKey({
      organization: " Dept A ",
      tenderName: "Portal Dev",
      deadline: "01/09/2026",
    }),
    authorityBriefDeadlineKey({
      organization: "dept a",
      tenderName: "portal dev",
      deadline: "2026-09-01",
    }),
  );
});

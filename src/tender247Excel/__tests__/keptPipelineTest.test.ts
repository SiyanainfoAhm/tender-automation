import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import XLSX from "xlsx";
import {
  readAllKeptCandidatesFromExcel,
  readKeptCandidatesFromExcel,
  resolveDefaultKeptExcelPath,
} from "../parseKeptExcelRows.js";
import {
  filterItRelevantWithinFinancialKeep,
  selectFirstItRelevantCandidates,
  type RelevanceScanRecord,
} from "../selectItRelevantCandidates.js";
import {
  parseKeptPipelineArgs,
  selectKeptCandidatesForTest,
} from "../testTender247KeptPipeline.js";
import { writeKeptPipelineAudit } from "../writeKeptPipelineAudit.js";

function fakeCandidate(id: string, title = `t-${id}`) {
  return {
    sourceTenderId: id,
    title,
    estimatedCostRaw: "1",
    parsedTenderValueInr: 1,
    emdRaw: "0",
    parsedEmdInr: 0,
    deadline: null as string | null,
    excelFilterStatus: "KEEP",
    excelFilterReason: "WITHIN_FINANCIAL_LIMITS",
    rowIndex: 1,
  };
}

function scanRow(
  id: string,
  relevance: "IT_RELEVANT" | "NON_IT" | "AMBIGUOUS",
): RelevanceScanRecord {
  return {
    candidate: fakeCandidate(id),
    relevance,
    reasonCode: "TEST",
    matchedTerms: [],
    negativeTerms: [],
    evidenceFields: [],
    candidateOrdinal: null,
    detailOpened: false,
    detailResolved: true,
    error: null,
  };
}

test("parseKeptPipelineArgs reads date, limit, file, freshExcel, stopOnGo", () => {
  const args = parseKeptPipelineArgs([
    "--date=2026-08-12",
    "--limit=4",
    "--file=C:\\tmp\\02-kept.xlsx",
    "--no-fresh-excel",
    "--no-stop-on-go",
  ]);
  assert.equal(args.date, "2026-08-12");
  assert.equal(args.limit, 4);
  assert.equal(args.file, "C:\\tmp\\02-kept.xlsx");
  assert.equal(args.freshExcel, false);
  assert.equal(args.stopOnGo, false);
});

test("parseKeptPipelineArgs defaults limit to 20 and stopOnGo true", () => {
  const args = parseKeptPipelineArgs(["--date=2026-08-12"]);
  assert.equal(args.limit, 20);
  assert.equal(args.freshExcel, true);
  assert.equal(args.stopOnGo, true);
});

test("parseKeptPipelineArgs rejects limit > 50", () => {
  assert.throws(
    () => parseKeptPipelineArgs(["--date=2026-08-12", "--limit=99"]),
    /KEPT_PIPELINE_LIMIT_TOO_HIGH/,
  );
});

test("--limit selects first N IT_RELEVANT only (skips NON_IT/AMBIGUOUS)", () => {
  // Mirrors user example: positions 1,2 NON_IT; 3 IT; 4 AMBIGUOUS; 5,6 IT; 7 NON_IT; 8 IT
  const sequence = [
    { sourceTenderId: "1", relevance: "NON_IT" as const, candidate: fakeCandidate("1") },
    { sourceTenderId: "2", relevance: "NON_IT" as const, candidate: fakeCandidate("2") },
    { sourceTenderId: "3", relevance: "IT_RELEVANT" as const, candidate: fakeCandidate("3") },
    { sourceTenderId: "4", relevance: "AMBIGUOUS" as const, candidate: fakeCandidate("4") },
    { sourceTenderId: "5", relevance: "IT_RELEVANT" as const, candidate: fakeCandidate("5") },
    { sourceTenderId: "6", relevance: "IT_RELEVANT" as const, candidate: fakeCandidate("6") },
    { sourceTenderId: "7", relevance: "NON_IT" as const, candidate: fakeCandidate("7") },
    { sourceTenderId: "8", relevance: "IT_RELEVANT" as const, candidate: fakeCandidate("8") },
  ];
  const selected = selectKeptCandidatesForTest(sequence, 4);
  assert.equal(selected.length, 4);
  assert.deepEqual(
    selected.map((c) => c.sourceTenderId),
    ["3", "5", "6", "8"],
  );
});

test("selectFirstItRelevantCandidates hard-stops at limit", () => {
  const scan = [
    scanRow("a", "NON_IT"),
    scanRow("b", "IT_RELEVANT"),
    scanRow("c", "AMBIGUOUS"),
    scanRow("d", "IT_RELEVANT"),
    scanRow("e", "IT_RELEVANT"),
  ];
  const selected = selectFirstItRelevantCandidates(scan, 2);
  assert.equal(selected.length, 2);
  assert.equal(selected[0]!.candidate.sourceTenderId, "b");
  assert.equal(selected[0]!.candidateOrdinal, 1);
  assert.equal(selected[1]!.candidate.sourceTenderId, "d");
  assert.equal(selected[1]!.candidateOrdinal, 2);
});

test("filterItRelevantWithinFinancialKeep intersects financial KEEP", () => {
  const scan = [
    scanRow("keep-it", "IT_RELEVANT"),
    scanRow("drop-financial", "IT_RELEVANT"),
    scanRow("keep-non", "NON_IT"),
  ];
  const financialIds = new Set(["keep-it", "keep-non"]);
  const filtered = filterItRelevantWithinFinancialKeep(scan, financialIds);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.candidate.sourceTenderId, "keep-it");
});

test("resolveDefaultKeptExcelPath points at excel-filter-review/02-kept.xlsx", () => {
  const p = resolveDefaultKeptExcelPath("downloads", "2026-08-12");
  assert.match(
    p.replace(/\\/g, "/"),
    /downloads\/2026-08-12\/excel-filter-review\/02-kept\.xlsx$/,
  );
});

test("readAllKeptCandidatesFromExcel reads every financial survivor", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kept-xlsx-"));
  const filePath = path.join(dir, "02-kept.xlsx");
  const rows = Array.from({ length: 10 }, (_, i) => ({
    "Tender247 ID": String(2000 + i),
    "Tender Name": `Name ${i}`,
    "Estimated Cost Raw": String((i + 1) * 1000),
    "Parsed Tender Value INR": (i + 1) * 1000,
    "EMD Raw": "100",
    "Parsed EMD INR": 100,
    Deadline: "13-08-2026",
    "Excel Filter Status": "KEEP",
    "Excel Filter Reason": "WITHIN_FINANCIAL_LIMITS",
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Kept");
  XLSX.writeFile(wb, filePath);

  const all = readAllKeptCandidatesFromExcel(filePath);
  assert.equal(all.length, 10);

  // Legacy slice helper still works but is NOT the pipeline --limit semantics
  const sliced = readKeptCandidatesFromExcel(filePath, 4);
  assert.equal(sliced.length, 4);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("writeKeptPipelineAudit writes required artifacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kept-audit-"));
  const selected = [fakeCandidate("111", "Web portal development")];
  const scan = [
    scanRow("111", "IT_RELEVANT"),
    scanRow("222", "NON_IT"),
    scanRow("333", "AMBIGUOUS"),
  ];
  scan[0]!.candidate = selected[0]!;
  scan[0]!.candidateOrdinal = 1;

  const results = [
    {
      sourceTenderId: "111",
      title: "Web portal development",
      financialStatus: "KEEP" as const,
      itRelevance: "IT_RELEVANT" as const,
      itRelevanceReasonCode: "SOFTWARE_SCOPE_MATCH",
      documentsDownloaded: true,
      supabaseStored: true,
      prescreenStatus: "PASSED",
      chatgptSubmitted: true,
      chatgptCompleted: true,
      chatgptResult: "GO",
      error: null,
    },
  ];

  const out = writeKeptPipelineAudit({
    dateFolder: dir,
    selected,
    scan,
    results,
  });

  assert.ok(fs.existsSync(out.selectedPath));
  assert.ok(fs.existsSync(out.itRelevantPath));
  assert.ok(fs.existsSync(out.nonItPath));
  assert.ok(fs.existsSync(out.ambiguousPath));
  assert.ok(fs.existsSync(out.resultsJsonPath));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("kept-pipeline module does not import BidAssist crawler", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/testTender247KeptPipeline.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /runBidassistCrawler|qualifyBidassistTender/);
});

test("kept-pipeline does not call search-tender API helper", () => {
  const mainSrc = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/testTender247KeptPipeline.ts"),
    "utf8",
  );
  const classifySrc = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/classifyKeptRelevance.ts"),
    "utf8",
  );
  assert.doesNotMatch(mainSrc, /lookupTender247SecurityCodes|mailSearchUrl/);
  assert.doesNotMatch(classifySrc, /lookupTender247SecurityCodes|mailSearchUrl/);
  assert.doesNotMatch(mainSrc, /from \"\.\/lookupTenderSecurityCodes/);
  assert.match(classifySrc, /resolveTender247Tender/);
  assert.match(mainSrc, /openViaSingleTenderDirect:\s*true/);
});

test("kept-pipeline scans relevance before document download in source order", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/tender247Excel/testTender247KeptPipeline.ts"),
    "utf8",
  );
  const relevanceIdx = src.indexOf("TENDER247_RELEVANCE_SCAN_START");
  const downloadIdx = src.indexOf("DOCUMENT_DOWNLOAD_START");
  assert.ok(relevanceIdx > 0);
  assert.ok(downloadIdx > relevanceIdx);
  assert.match(src, /FILTERED_IT_CANDIDATES_SELECTED/);
  assert.match(src, /classifyKeptCandidateRelevance/);
  assert.match(src, /openViaSingleTenderDirect:\s*true/);
  assert.match(src, /KEPT_PIPELINE_STOP_ON_GO/);
  assert.match(src, /TENDER247_FRESH_EXCEL_START/);
});

test("real 02-kept.xlsx loads all financial survivors when present", () => {
  const filePath = path.join(
    process.cwd(),
    "downloads",
    "2026-08-12",
    "excel-filter-review",
    "02-kept.xlsx",
  );
  if (!fs.existsSync(filePath)) {
    return;
  }
  const all = readAllKeptCandidatesFromExcel(filePath);
  assert.ok(all.length >= 4);
  assert.equal(all[0]!.sourceTenderId, "100711361");
});

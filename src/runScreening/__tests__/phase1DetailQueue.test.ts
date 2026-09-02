/**
 * Phase-1 screened workbook is the only source for Tender247 detail selection.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  allowTender247DetailScrape,
  assertOpenSingleTenderDetailsAllowed,
  buildPhase1DetailQueue,
  openTendersFromProposedQueue,
  rebuildDetailQueueFromScreenedRows,
  runCorrelationIdForDate,
} from "../phase1DetailQueue.js";
import {
  normalizePhase1CrawlStatus,
  normalizeStatusToken,
} from "../phase1Statuses.js";
import {
  writeRunWorkbook,
  type RunWorkbookRow,
} from "../runWorkbook.js";
import {
  saveRunState,
  saveScreeningManifest,
  screeningDir,
} from "../screeningManifest.js";
import { AutomationError } from "../../browserUtils.js";
import { SIYANA_COMPANY_ID } from "../../company/siyanaCompany.js";

function row(
  id: string,
  status: RunWorkbookRow["screeningStatus"],
  reason: string,
): RunWorkbookRow {
  return {
    canonicalId: `T247-${id}`,
    source: "TENDER247",
    tender247Id: id,
    referenceNo: "",
    bidAssistId: "",
    tenderName: `Tender ${id}`,
    organization: "Dept",
    location: "Chennai",
    deadline: "2026-09-01",
    estimatedCost: "1000000",
    emdAmount: "50000",
    sourceRefs: "TENDER247",
    screeningStatus: status,
    screeningReason: reason,
  };
}

function writeScreenedFixture(dateFolder: string, rows: RunWorkbookRow[]): string {
  const dir = screeningDir(dateFolder);
  fs.mkdirSync(dir, { recursive: true });
  const screenedPath = path.join(dir, "run-screened-siyana.xlsx");
  writeRunWorkbook(rows, screenedPath);
  saveRunState(dateFolder, {
    stage: "AI_SCREENING_COMPLETE",
    aiScreeningComplete: true,
    shortlistReady: true,
    screeningRunId: "RUN-2026-08-17",
    updatedAt: new Date().toISOString(),
  });
  saveScreeningManifest(dateFolder, {
    companyId: SIYANA_COMPANY_ID,
    companyName: "Siyana",
    runDate: "2026-08-17",
    screeningRunId: "RUN-2026-08-17",
    stage: "SHORTLIST_READY",
    status: "complete",
    inputWorkbook: path.join(dateFolder, "run-normalized.xlsx"),
    inputWorkbookHash: "x",
    preferencesHash: "x",
    screeningPromptHash: "x",
    screenedWorkbook: screenedPath,
    screenedWorkbookHash: "x",
    inputRows: rows.length,
    outputRows: rows.length,
    counts: {
      GO: rows.filter((r) => r.screeningStatus === "GO").length,
      CONDITIONAL_GO: rows.filter((r) => r.screeningStatus === "CONDITIONAL_GO").length,
      PARTNER_BID: 0,
      VERIFY: rows.filter((r) => r.screeningStatus === "VERIFY").length,
      NO_GO: rows.filter((r) => r.screeningStatus === "NO_GO").length,
    },
    error: null,
    updatedAt: new Date().toISOString(),
  });
  return screenedPath;
}

test("normalizeStatusToken maps workbook cells onto Phase-1 crawl tokens", () => {
  assert.equal(normalizeStatusToken(" no bid "), "NO_BID");
  assert.equal(normalizePhase1CrawlStatus("NO_BID"), "NO_BID");
  assert.equal(normalizePhase1CrawlStatus("No Bid"), "NO_BID");
  assert.equal(normalizePhase1CrawlStatus("VERIFY"), "VERIFY");
  assert.equal(normalizePhase1CrawlStatus("May Bid"), "MAY_BID");
  assert.equal(normalizePhase1CrawlStatus("WILL_BID"), "WILL_BID");
  assert.equal(normalizePhase1CrawlStatus("hardware"), null);
});

test("67 screened rows rebuild a 37-tender detail queue and never open NO_BID", () => {
  const rows: RunWorkbookRow[] = [];
  for (let i = 1; i <= 30; i += 1) {
    rows.push(row(String(1000 + i), "NO_GO", "NO_BID — outside scope"));
  }
  for (let i = 1; i <= 30; i += 1) {
    rows.push(row(String(2000 + i), "VERIFY", "VERIFY — need documents"));
  }
  for (let i = 1; i <= 7; i += 1) {
    rows.push(row(String(3000 + i), "CONDITIONAL_GO", "MAY_BID — software match"));
  }
  assert.equal(rows.length, 67);

  const rebuilt = rebuildDetailQueueFromScreenedRows(rows, {
    runCorrelationId: "RUN-2026-08-17",
    screeningWorkbookSource: "run-screened-siyana.xlsx",
  });
  assert.equal(rebuilt.counts.NO_BID, 30);
  assert.equal(rebuilt.counts.VERIFY, 30);
  assert.equal(rebuilt.counts.MAY_BID, 7);
  assert.equal(rebuilt.counts.WILL_BID, 0);
  assert.equal(rebuilt.crawlCandidates.length, 37);
  assert.equal(rebuilt.noBidDecisions.length, 30);

  const opened: string[] = [];
  const result = openTendersFromProposedQueue({
    proposedIds: rebuilt.crawlCandidates.map((d) => d.tender247Id),
    decisions: rebuilt.decisionsByTenderId,
    openTender: (id) => opened.push(id),
  });
  assert.equal(result.opened.length, 37);
  assert.equal(opened.length, 37);
  for (const id of rebuilt.noBidDecisions.map((d) => d.tender247Id)) {
    assert.equal(opened.includes(id), false);
  }
});

test("stale pre-screen queue of 67 IDs still cannot open NO_BID tenders", () => {
  const dateFolder = fs.mkdtempSync(path.join(os.tmpdir(), "phase1-queue-"));
  const rows: RunWorkbookRow[] = [];
  const staleIds: string[] = [];
  for (let i = 1; i <= 30; i += 1) {
    const id = String(1000 + i);
    rows.push(row(id, "NO_GO", "NO_BID — outside scope"));
    staleIds.push(id);
    fs.mkdirSync(path.join(dateFolder, `T247-${id}`), { recursive: true });
  }
  for (let i = 1; i <= 30; i += 1) {
    const id = String(2000 + i);
    rows.push(row(id, "VERIFY", "VERIFY — need documents"));
    staleIds.push(id);
  }
  for (let i = 1; i <= 7; i += 1) {
    const id = String(3000 + i);
    rows.push(row(id, "CONDITIONAL_GO", "MAY_BID — software match"));
    staleIds.push(id);
  }

  writeScreenedFixture(dateFolder, rows);
  writeRunWorkbook(rows.map((r) => ({ ...r, screeningStatus: "" })), path.join(dateFolder, "run-normalized.xlsx"));
  fs.writeFileSync(
    path.join(dateFolder, "tender247-candidates.json"),
    JSON.stringify({ ids: staleIds, source: "pre-screen" }, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dateFolder, "tender247-prescreen.json"),
    JSON.stringify({ survivingTenderIds: staleIds }, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dateFolder, "crawl-manifest.json"),
    JSON.stringify({ tenders: Object.fromEntries(staleIds.map((id) => [id, { status: "pending" }])) }, null, 2),
    "utf8",
  );

  const queue = buildPhase1DetailQueue({
    dateFolder,
    runDate: "2026-08-17",
    persist: true,
  });
  assert.equal(queue.screeningRunId, "RUN-2026-08-17");
  assert.equal(queue.crawlerQueueRunId, "RUN-2026-08-17");
  assert.equal(queue.total, 67);
  assert.equal(queue.crawlCandidates.length, 37);
  assert.equal(queue.source, "run-screened-siyana.xlsx");
  assert.ok(
    fs.existsSync(path.join(screeningDir(dateFolder), "phase1-no-bid-decisions.json")),
  );
  assert.ok(fs.existsSync(path.join(screeningDir(dateFolder), "detail-queue.json")));

  const opened: string[] = [];
  const fromStale = openTendersFromProposedQueue({
    proposedIds: staleIds,
    decisions: queue.decisionsByTenderId,
    openTender: (id) => opened.push(id),
  });
  assert.equal(staleIds.length, 67);
  assert.equal(fromStale.opened.length, 37);
  assert.equal(fromStale.refusedNoBid.length, 30);
  assert.equal(opened.length, 37);
  for (const id of staleIds.slice(0, 30)) {
    assert.equal(opened.includes(id), false, `NO_BID ${id} must not open`);
    assert.throws(
      () => assertOpenSingleTenderDetailsAllowed("NO_BID", id),
      /T247_FATAL_QUEUE_INTEGRITY_ERROR/,
    );
    assert.equal(allowTender247DetailScrape(queue.decisionsByTenderId, id), false);
  }
  assert.equal(runCorrelationIdForDate("2026-08-17"), "RUN-2026-08-17");
  fs.rmSync(dateFolder, { recursive: true, force: true });
});

test("truthy or unknown screening status is not permission to crawl", () => {
  const rows = [
    row("1", "", ""),
    row("2", "NO_GO", "no"),
  ];
  rows[0]!.screeningStatus = "" ;
  const rebuilt = rebuildDetailQueueFromScreenedRows(rows, {
    runCorrelationId: "RUN-2026-08-17",
    screeningWorkbookSource: "run-screened-siyana.xlsx",
  });
  assert.equal(rebuilt.crawlCandidates.length, 0);
  assert.equal(rebuilt.unknownCount, 1);
  assert.throws(
    () => assertOpenSingleTenderDetailsAllowed("YES", "1"),
    /T247_FATAL_QUEUE_INTEGRITY_ERROR/,
  );
  assert.throws(
    () => assertOpenSingleTenderDetailsAllowed("NO_BID", "2"),
    (error: unknown) => {
      assert.ok(error instanceof AutomationError);
      assert.equal(error.code, "T247_FATAL_QUEUE_INTEGRITY_ERROR");
      return true;
    },
  );
});

test("runDailyBatch rebuilds the detail queue from the screened workbook", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "tender247Batch", "runDailyBatch.ts"),
    "utf8",
  );
  assert.equal(source.includes("buildPhase1DetailQueue"), true);
  assert.equal(source.includes("tender247-candidates.json"), false);
  assert.equal(source.includes("applyTender247ExcelPrescreen"), false);
  assert.match(source, /survivingIds\.has\(id\)/);
});

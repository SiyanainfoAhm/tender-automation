import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AutomationError } from "../../browserUtils.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("ai-summary pipeline uses search-by-ID and documentsOnlyIfAiMissing", () => {
  const src = fs.readFileSync(
    path.join(root, "src/pipeline/runAiSummaryFirstDocumentPipeline.ts"),
    "utf8",
  );
  assert.match(src, /documentsOnlyIfAiMissing:\s*true/);
  assert.match(src, /allowNoBidDetailOpen:\s*true/);
  assert.match(src, /NO_GO/);
  assert.match(src, /upsertScreenedTendersForDate/);
  assert.match(src, /downloadAndUpsertDailyExcelForAiSummary/);
  assert.match(src, /downloadTodayExcel/);
  assert.match(src, /withDefaultVerifyStatus/);
  assert.match(src, /preserveExistingQualificationStatus/);
  assert.match(src, /persistGptScreenedWorkbookToDatabase/);
  assert.match(src, /listAiSummaryQueueForDate/);
  assert.match(src, /ai_summary_url/);
  assert.match(src, /skippedLocalArtifacts/);
  assert.match(src, /AI_SUMMARY_PIPELINE_SKIP_LOCAL/);
  assert.match(src, /hasAiSummaryOrDocumentsLocally|inspectTenderArtifactState/);
  assert.match(src, /INVALID_ACCOUNT_FLAG/);
  assert.doesNotMatch(
    src,
    /crawl !== "VERIFY" && crawl !== "MAY_BID" && crawl !== "WILL_BID"/,
  );
});

test("processTender skips AI-summary reopen when local AI or docs exist", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tender247Batch/processTender.ts"),
    "utf8",
  );
  assert.match(src, /aiSummaryPipelineLocalDone/);
  assert.match(src, /local_ai_or_docs/);
  assert.doesNotMatch(src, /TENDER247_SKIP_BYPASS_AI_SUMMARY_MISSING/);
  assert.match(
    fs.readFileSync(
      path.join(root, "src/tender247Batch/tenderArtifactState.ts"),
      "utf8",
    ),
    /hasAiSummaryOrDocumentsLocally/,
  );
});

test("withDefaultVerifyStatus fills empty Screening Status", async () => {
  const mod = await import("../runAiSummaryFirstDocumentPipeline.js");
  const rows = mod.withDefaultVerifyStatus([
    {
      canonicalId: "T247-1",
      source: "TENDER247",
      tender247Id: "1",
      referenceNo: "",
      bidAssistId: "",
      tenderName: "A",
      organization: "",
      location: "",
      deadline: "",
      estimatedCost: "",
      emdAmount: "",
      sourceRefs: "",
      screeningStatus: "",
      screeningReason: "",
    },
    {
      canonicalId: "T247-2",
      source: "TENDER247",
      tender247Id: "2",
      referenceNo: "",
      bidAssistId: "",
      tenderName: "B",
      organization: "",
      location: "",
      deadline: "",
      estimatedCost: "",
      emdAmount: "",
      sourceRefs: "",
      screeningStatus: "GO",
      screeningReason: "keep",
    },
  ]);
  assert.equal(rows[0]?.screeningStatus, "VERIFY");
  assert.match(rows[0]?.screeningReason || "", /AI_SUMMARY_PIPELINE_DAILY_EXCEL/);
  assert.equal(rows[1]?.screeningStatus, "GO");
  assert.equal(rows[1]?.screeningReason, "keep");
});

test("downloadRequiredTenderFiles supports documentsOnlyIfAiMissing", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tender247Batch/downloadRequiredTenderFiles.ts"),
    "utf8",
  );
  assert.match(src, /documentsOnlyIfAiMissing/);
  assert.match(src, /DOCUMENTS_SKIPPED_AI_SUMMARY_PRESENT/);
  assert.match(src, /DOCUMENTS_DOWNLOAD_BECAUSE_AI_SUMMARY_MISSING/);
});

test("ai-summary pipeline rejects mistyped --accountid", async () => {
  const mod = await import("../runAiSummaryFirstDocumentPipeline.js");
  await assert.rejects(
    () =>
      mod.runAiSummaryFirstDocumentPipeline([
        "--date=2026-09-06",
        "--accountid=2",
        "--dry-run",
        "--skip-upsert",
      ]),
    (error: unknown) => {
      assert.ok(error instanceof AutomationError);
      assert.equal(error.code, "INVALID_ACCOUNT_FLAG");
      return true;
    },
  );
});

test("package.json exposes pipeline:tender247:ai-summary", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.match(
    pkg.scripts["pipeline:tender247:ai-summary"] || "",
    /runAiSummaryFirstDocumentPipeline/,
  );
});

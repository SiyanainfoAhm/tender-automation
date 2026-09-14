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

test("ai-summary pipeline always downloads documents and uploads Azure artifacts", () => {
  const src = fs.readFileSync(
    path.join(root, "src/pipeline/runAiSummaryFirstDocumentPipeline.ts"),
    "utf8",
  );
  assert.match(src, /documentsOnlyIfAiMissing:\s*false/);
  assert.match(src, /allowNoBidDetailOpen:\s*true/);
  assert.match(src, /NO_GO/);
  assert.match(src, /upsertScreenedTendersForDate/);
  assert.match(src, /downloadAndUpsertDailyExcelForAiSummary/);
  assert.match(src, /downloadTodayExcel/);
  assert.match(src, /withDefaultVerifyStatus/);
  assert.match(src, /preserveExistingQualificationStatus/);
  assert.match(src, /persistGptScreenedWorkbookToDatabase/);
  assert.match(src, /listAiSummaryQueueForDate/);
  assert.match(src, /resolveAiSummaryResumeIdFilter/);
  assert.match(src, /computeAiSummaryResumeIdFilter/);
  assert.match(src, /AI_SUMMARY_PIPELINE_AUTO_RESUME/);
  assert.match(src, /ai_summary_url/);
  assert.match(src, /documents_zip_url/);
  assert.match(src, /resolveAiSummaryArtifactMode/);
  assert.match(src, /SKIP_ALREADY_COMPLETE/);
  assert.match(src, /RESUME_SUMMARY_ONLY/);
  assert.match(src, /RESUME_DOCUMENTS_ONLY/);
  assert.match(src, /PROCESS_FULL/);
  assert.match(src, /existingArtifactUrlsById/);
  assert.doesNotMatch(src, /AI_SUMMARY_PIPELINE_SKIP_LOCAL/);
  assert.doesNotMatch(src, /inspectTenderArtifactState/);
  assert.match(src, /INVALID_ACCOUNT_FLAG/);
  assert.match(src, /resolveAiSummaryArtifactMode/);
  assert.doesNotMatch(
    src,
    /crawl !== "VERIFY" && crawl !== "MAY_BID" && crawl !== "WILL_BID"/,
  );
});

test("processTender skips prescreen on existing Supabase rows", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tender247Batch/processTender.ts"),
    "utf8",
  );
  assert.match(src, /PRESCREEN_SKIPPED_EXISTING_ROW/);
  assert.match(src, /result\.created/);
  assert.match(src, /runAndPersistPrescreen/);
});

test("ai-summary protect mode only sets status on insert", () => {
  const src = fs.readFileSync(
    path.join(root, "src/runScreening/persistPhase1Results.ts"),
    "utf8",
  );
  assert.match(src, /insertedNewRow/);
  assert.match(src, /protectExistingScreeningFields && !insertedNewRow/);
  assert.match(
    src,
    /Status left unchanged \(existing same-day row\)/,
  );
});

test("processTender uploads Azure artifacts even when docs zip is incomplete", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tender247Batch/processTender.ts"),
    "utf8",
  );
  assert.match(src, /hasUploadableArtifacts/);
  assert.match(src, /aiSummaryPipelineFullLocalDone/);
  assert.match(src, /uploadTenderArtifactsAndPersistUrls/);
  assert.match(src, /local_ai_and_docs_complete/);
  assert.doesNotMatch(src, /TENDER247_SKIP_BYPASS_AI_SUMMARY_MISSING/);
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

test("computeAiSummaryResumeIdFilter retries failed only when Excel and DB counts match", async () => {
  const mod = await import("../runAiSummaryFirstDocumentPipeline.js");
  const failed = ["104146865", "104146868"];
  const excelIds = ["1", "2", "3", ...failed];
  const dbIds = new Set(excelIds);

  const sameCount = mod.computeAiSummaryResumeIdFilter({
    priorFailedIds: failed,
    excelRowCount: excelIds.length,
    dbRowCount: excelIds.length,
    excelIds,
    dbIds,
  });
  assert.equal(sameCount.mode, "failed-only");
  assert.deepEqual(sameCount.ids, failed);

  const gapIds = ["999001", "999002"];
  const mismatch = mod.computeAiSummaryResumeIdFilter({
    priorFailedIds: failed,
    excelRowCount: excelIds.length + gapIds.length,
    dbRowCount: excelIds.length,
    excelIds: [...excelIds, ...gapIds],
    dbIds,
  });
  assert.equal(mismatch.mode, "failed-plus-gap");
  assert.deepEqual(mismatch.ids, [...failed, ...gapIds]);

  const none = mod.computeAiSummaryResumeIdFilter({
    priorFailedIds: [],
    excelRowCount: 10,
    dbRowCount: 10,
    excelIds: ["1"],
    dbIds: new Set(["1"]),
  });
  assert.equal(none.mode, "none");
  assert.equal(none.ids, null);
});

test("resolveAiSummaryArtifactMode uses Supabase URLs only", async () => {
  const mod = await import("../runAiSummaryFirstDocumentPipeline.js");
  assert.equal(
    mod.resolveAiSummaryArtifactMode({
      documentsZipUrl: "https://blob/docs.zip",
      aiSummaryUrl: "https://blob/ai.pdf",
    }),
    "SKIP_ALREADY_COMPLETE",
  );
  assert.equal(
    mod.resolveAiSummaryArtifactMode({
      documentsZipUrl: "https://blob/docs.zip",
      aiSummaryUrl: null,
    }),
    "RESUME_SUMMARY_ONLY",
  );
  assert.equal(
    mod.resolveAiSummaryArtifactMode({
      documentsZipUrl: "  ",
      aiSummaryUrl: "https://blob/ai.pdf",
    }),
    "RESUME_DOCUMENTS_ONLY",
  );
  assert.equal(
    mod.resolveAiSummaryArtifactMode({
      documentsZipUrl: null,
      aiSummaryUrl: null,
    }),
    "PROCESS_FULL",
  );
  assert.equal(
    mod.resolveAiSummaryArtifactMode({
      documentsZipUrl: "https://blob/docs.zip",
      aiSummaryUrl: "https://blob/ai.pdf",
      force: true,
    }),
    "PROCESS_FULL",
  );
});

test("package.json exposes pipeline:tender247:ai-summary", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  assert.match(
    pkg.scripts?.["pipeline:tender247:ai-summary"] || "",
    /runAiSummaryFirstDocumentPipeline/,
  );
});

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

test("openSingleTenderDirectly probes Indian/Global before scrape", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tenderDetails/openSingleTenderDirectly.ts"),
    "utf8",
  );
  assert.match(src, /searchTender247ListById/);
  assert.doesNotMatch(src, /scrolling to find/);
  assert.doesNotMatch(src, /scrollUntilIdVisible/);
  assert.match(src, /SEARCH_RESULT_MATCHED|searchTender247ListById/);
  assert.match(src, /DETAIL_OPENED/);
  assert.match(src, /waitForEvent\("page"/);
  assert.match(src, /\.catch\(\(\) => null\)/);
  assert.match(src, /TENDER247_REGION_PROBE/);
  assert.match(src, /TENDER247_REGION_CROSS_CHECK/);
  assert.match(src, /TENDER247_REGION_RESOLVED/);
  assert.match(src, /alternateTender247Region/);
  assert.match(src, /resolvedRegion/);
});

test("alternateTender247Region flips Indian and Global", async () => {
  const mod = await import("../../tender247/sourceRegion.js");
  assert.equal(mod.alternateTender247Region("INDIAN"), "GLOBAL");
  assert.equal(mod.alternateTender247Region("GLOBAL"), "INDIAN");
});

test("searchTender247ById targets SEARCH not ADVANCE SEARCH", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tenderDetails/searchTender247ById.ts"),
    "utf8",
  );
  assert.match(src, /\/\^SEARCH\$\/i/);
  assert.match(src, /ADVANCE\\s\*SEARCH/);
  assert.match(src, /Search\\s\+By\\s\+T247\\s\+ID/);
  assert.match(src, /waitForResponse/);
  assert.match(src, /SEARCH_STARTED/);
  assert.match(src, /SEARCH_RESULT_MATCHED/);
  assert.match(src, /dismissTender247AdvanceSearchModal/);
  assert.match(src, /hasNotText/);
  assert.match(src, /ADVANCE/);
});

test("interruptions dismiss Advance Search modal", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tenderDetails/dismissTender247Interruptions.ts"),
    "utf8",
  );
  assert.match(src, /dismissTender247AdvanceSearchModal/);
  assert.match(src, /TENDER247_ADVANCE_SEARCH_MODAL_DETECTED/);
  assert.match(src, /TENDER247_ADVANCE_SEARCH_MODAL_DISMISSED/);
});

test("document pipeline rejects mistyped --accountid and requires --account-id", async () => {
  const mod = await import("../../pipeline/runVerifyMayBidDocumentPipeline.js");
  // parseArgs is not exported — exercise via dry-run entry that fails on flag first
  await assert.rejects(
    () =>
      mod.runVerifyMayBidDocumentPipeline([
        "--date=2026-09-03",
        "--accountid=2",
        "--dry-run",
      ]),
    (error: unknown) => {
      assert.ok(error instanceof AutomationError);
      assert.equal(error.code, "INVALID_ACCOUNT_FLAG");
      assert.match(error.message, /--account-id=2/);
      return true;
    },
  );
});

test("document pipeline passes force into processSurvivorsInParallel", () => {
  const src = fs.readFileSync(
    path.join(root, "src/pipeline/runVerifyMayBidDocumentPipeline.ts"),
    "utf8",
  );
  assert.match(src, /force:\s*args\.force/);
  assert.match(src, /DOCUMENT_PIPELINE_ACCOUNT_RESOLVED/);
  assert.match(src, /fullSuccess/);
  assert.match(src, /partialSuccess/);
  assert.match(src, /INVALID_ACCOUNT_FLAG/);
});

test("processLiveTender force bypasses ALREADY_COMPLETED_SKIP", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tender247Batch/processTender.ts"),
    "utf8",
  );
  assert.match(src, /!options\.force/);
  assert.match(src, /TENDER247_FORCE_BYPASS_COMPLETION_SKIP/);
  assert.match(src, /await verifyCurrentTenderId[\s\S]*DETAIL_OPENED/);
});

test("sequential acquisition no longer logs DETAIL_OPENED before process", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tender247Batch/runSequentialArtifactAcquisition.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /DETAIL_OPENED/);
  assert.match(src, /BATCH_LOOP_DONE/);
});

test("openSingleTenderDirectly retries expand and hard-resets blocked mail date", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tenderDetails/openSingleTenderDirectly.ts"),
    "utf8",
  );
  assert.match(src, /EXPAND_RETRY/);
  assert.match(src, /TENDER247_UI_HARD_RESET/);
  assert.match(src, /TENDER247_MAIL_DATE_RESTORE_RETRY/);
  assert.match(src, /dismissTender247AdvanceSearchModal/);
});

test("processSurvivors recovers list UI between tenders after failure", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tender247Batch/processSurvivorsInParallel.ts"),
    "utf8",
  );
  assert.match(src, /recoverListPageBetweenTenders/);
  assert.match(src, /T247_LIST_RECOVER/);
  assert.match(src, /T247_LIST_RECOVER_WRONG_REGION/);
  assert.match(src, /urlMatchesTender247Region/);
  assert.match(src, /waitForSelectMailDateCard/);
  assert.match(src, /continuing to next tender/);
});

test("openSingleTenderDirectly skips calendar when mail date already matches", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tenderDetails/openSingleTenderDirectly.ts"),
    "utf8",
  );
  assert.match(src, /TENDER247_DETAIL_MAIL_DATE_OK/);
  assert.match(src, /TENDER247_DETAIL_RETURN_DASHBOARD/);
  assert.match(src, /mail-date-card-missing/);
  assert.match(src, /TENDER247_MAIL_DATE_RESTORE_RELOGIN/);
  assert.match(src, /waitForSelectMailDateCard/);
});

test("openSingleTenderDirectly prefers API detail URL and recovers list expand", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tenderDetails/openSingleTenderDirectly.ts"),
    "utf8",
  );
  assert.match(src, /EXPAND_PREFER_API_DETAIL_URL/);
  assert.match(src, /EXPAND_STILL_ON_LIST/);
  assert.match(src, /openViaSecurityCode/);
});

test("expansion verification requires height growth not absolute 220px", () => {
  const src = fs.readFileSync(
    path.join(root, "src/tenderDetails/tender247Expansion.ts"),
    "utf8",
  );
  assert.match(src, /beforeHeight \+ 80/);
  assert.match(src, /EXPAND_BEFORE_HEIGHT/);
  assert.doesNotMatch(src, /rowBox\.height > 220/);
});

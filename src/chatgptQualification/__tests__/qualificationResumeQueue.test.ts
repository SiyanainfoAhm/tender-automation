import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ensureCanonicalTenderArchive } from "../../tender247Batch/canonicalTenderArchive.js";
import {
  computeQualificationInputFingerprint,
  saveQualificationInputFingerprint,
} from "../qualificationInputFingerprint.js";
import {
  inspectQualificationResumeUniverse,
  planResumeQualificationQueue,
} from "../qualificationResumeQueue.js";
import { reconcileGptReadyQueueBuckets } from "../gptQueuePlan.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function seedCoreReadyTender(dateFolder: string, t247Id: string): Promise<string> {
  const tenderDir = path.join(dateFolder, `T247-${t247Id}`);
  const documentsDir = path.join(tenderDir, "documents");
  fs.mkdirSync(documentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(tenderDir, "metadata.json"),
    JSON.stringify({
      t247Id,
      sourceTenderId: t247Id,
      normalized: { tenderName: "fixture" },
    }),
  );
  fs.writeFileSync(path.join(documentsDir, "NIT.pdf"), "%PDF-1.4 nit-doc\n");
  await ensureCanonicalTenderArchive({
    tenderDir,
    documentsDir,
    sourceTenderId: t247Id,
  });
  return tenderDir;
}

function writeValidQualification(tenderDir: string, t247Id: string, dateFolder: string): void {
  fs.writeFileSync(
    path.join(tenderDir, "qualification-response.txt"),
    "assistant response body",
    "utf8",
  );
  fs.writeFileSync(
    path.join(tenderDir, "qualification-result.json"),
    JSON.stringify(
      {
        sourcePortal: "TENDER247",
        sourceTenderId: t247Id,
        t247Id,
        company: "Siyana Info Solutions Pvt. Ltd.",
        status: "VERIFY",
        decisionLabel: "VERIFY",
        reason: "unit test",
        verdict: "needs verification",
        requiredAction: "Review",
        confidence: 0.5,
        matchedCriteria: [],
        failedCriteria: [],
        unclearCriteria: [],
        missingDocuments: [],
        conditions: [],
        partnershipRequiredFor: [],
        partnershipModeAllowed: [],
        manualReviewRequired: true,
        evidenceFiles: ["Tender_All_Documents.zip"],
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(
    path.join(tenderDir, "chatgpt-state.json"),
    JSON.stringify({
      t247Id,
      status: "completed",
      submissionConfirmed: true,
      chatUrl: "https://chatgpt.com/c/abc123",
      phase: "COMPLETED",
    }),
    "utf8",
  );
  const fp = computeQualificationInputFingerprint({
    dateFolder,
    sourceTenderId: t247Id,
  });
  saveQualificationInputFingerprint(tenderDir, fp);
}

describe("qualification resume universe", () => {
  it("32-style: 5 ready, 2 valid quals, 2 skipped-without-result, 1 failed → 2 reused, 3 queued", async () => {
    const dateFolder = fs.mkdtempSync(path.join(os.tmpdir(), "qual-resume-univ-"));
    tempDirs.push(dateFolder);

    const validA = "103389190";
    const validB = "103392928";
    const skippedA = "100053264";
    const skippedB = "102379065";
    const failed = "102998423";

    for (const id of [validA, validB, skippedA, skippedB, failed]) {
      await seedCoreReadyTender(dateFolder, id);
    }
    writeValidQualification(path.join(dateFolder, `T247-${validA}`), validA, dateFolder);
    writeValidQualification(path.join(dateFolder, `T247-${validB}`), validB, dateFolder);

    fs.writeFileSync(
      path.join(dateFolder, `T247-${skippedA}`, "chatgpt-state.json"),
      JSON.stringify({
        t247Id: skippedA,
        status: "skipped",
        qualificationStatus: null,
        chatUrl: null,
        resultPath: null,
        error: "prescreen:MISSING_REQUIRED_SUMMARY",
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dateFolder, `T247-${skippedB}`, "chatgpt-state.json"),
      JSON.stringify({
        t247Id: skippedB,
        status: "skipped",
        qualificationStatus: null,
        chatUrl: null,
        resultPath: null,
        error: "prescreen:AMBIGUOUS_SCOPE",
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dateFolder, `T247-${failed}`, "chatgpt-state.json"),
      JSON.stringify({
        t247Id: failed,
        status: "failed",
        qualificationStatus: null,
        chatUrl: null,
        resultPath: null,
        error: "Composer continuity failed",
      }),
      "utf8",
    );

    const universe = inspectQualificationResumeUniverse({
      dateFolder,
      resumeMode: true,
    });
    assert.equal(universe.gptReadyIds.length, 5);
    assert.deepEqual(universe.reusedIds.sort(), [validA, validB].sort());
    assert.equal(universe.reusedIds.includes(skippedA), false);
    assert.equal(universe.reusedIds.includes(skippedB), false);
    assert.equal(universe.reusedIds.includes(failed), false);

    const plan = planResumeQualificationQueue({
      universe,
      maxGptSends: 0,
    });
    assert.equal(plan.reusedIds.length, 2);
    assert.equal(plan.newRequiredIds.length, 3);
    assert.equal(plan.queuedNewIds.length, 3);
    const buckets = reconcileGptReadyQueueBuckets(plan);
    assert.equal(buckets.ready, 2 + 3 + 0);
    assert.equal(buckets.reusedValid, 2);
    assert.equal(buckets.newQueued, 3);
    assert.equal(buckets.validPending, 0);
    assert.equal(buckets.ok, true);
  });
});

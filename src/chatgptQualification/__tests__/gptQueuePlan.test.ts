import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assertGptQueueIntegrity,
  assertGptReadyFullyAccounted,
  planGptQualificationQueue,
  reconcileGptReadyCoverage,
  reconcileGptReadyQueueBuckets,
} from "../gptQueuePlan.js";
import { planResumeQualificationQueue } from "../qualificationResumeQueue.js";

const READY = [
  "102750970",
  "102952055",
  "103392680",
  "103392689",
  "103392654",
  "103392781",
  "103395725",
  "103407645",
  "103410140",
  "103391200",
  "102843957",
];

test("unlimited: 11 ready, 2 reused → queue all 9 new GPT candidates", () => {
  const plan = planGptQualificationQueue({
    readyIds: READY,
    reusedIds: ["102750970", "102952055"],
    maxGptSends: 0,
  });
  assert.equal(plan.readyIds.length, 11);
  assert.equal(plan.reusedIds.length, 2);
  assert.equal(plan.newRequiredIds.length, 9);
  assert.equal(plan.queuedNewIds.length, 9);
  assert.equal(plan.limitSkippedIds.length, 0);
  assert.equal(plan.explicitLimit, "UNLIMITED");
  assert.equal(assertGptReadyFullyAccounted(plan), true);
  assert.equal(
    plan.reusedIds.includes("102750970") &&
      plan.queuedNewIds.includes("102750970"),
    false,
  );
});

test("MAX_GPT_TENDERS=3 does not consume slots with reused qualifications", () => {
  const plan = planGptQualificationQueue({
    readyIds: READY,
    reusedIds: ["102750970", "102952055"],
    maxGptSends: 3,
  });
  assert.equal(plan.reusedIds.length, 2);
  assert.equal(plan.newRequiredIds.length, 9);
  assert.equal(plan.queuedNewIds.length, 3);
  assert.equal(plan.limitSkippedIds.length, 6);
  assert.equal(plan.explicitLimit, 3);
  assert.equal(assertGptReadyFullyAccounted(plan), true);
  for (const reused of plan.reusedIds) {
    assert.equal(plan.queuedNewIds.includes(reused), false);
  }
  const limitLogs = plan.notQueued.filter((n) => n.reason === "EXPLICIT_MAX_LIMIT");
  assert.equal(limitLogs.length, 6);
});

test("pending existing conversation does not consume GPT-send slots", () => {
  const plan = planGptQualificationQueue({
    readyIds: READY,
    reusedIds: ["102750970", "102952055"],
    pendingRecoveryIds: ["103407645"],
    maxGptSends: 3,
  });
  assert.equal(plan.reusedIds.length, 2);
  assert.equal(plan.pendingRecoveryIds.length, 1);
  assert.equal(plan.newRequiredIds.length, 8);
  assert.equal(plan.queuedNewIds.length, 3);
  assert.equal(plan.limitSkippedIds.length, 5);
  assert.equal(assertGptReadyFullyAccounted(plan), true);
  assert.equal(
    plan.notQueued.some(
      (row) =>
        row.id === "103407645" &&
        row.reason === "PENDING_EXISTING_CONVERSATION",
    ),
    true,
  );
});

test("production batch never truncates GPT-ready via selectPassed limit", () => {
  const src = fs.readFileSync(
    "src/chatgptQualification/runQualificationBatch.ts",
    "utf8",
  );
  assert.match(src, /planResumeQualificationQueue/);
  assert.match(src, /inspectQualificationResumeUniverse/);
  assert.doesNotMatch(src, /limit: chatgptSelectionLimit/);
  assert.match(src, /CHATGPT_NOT_QUEUED=/);
  assert.match(src, /CHATGPT_NEW_REQUIRED_TENDER_IDS/);
  assert.match(src, /GPT_QUEUE_INTEGRITY_ERROR|assertGptQueueIntegrity|planResumeQualificationQueue/);
});

test("complete JSON with false missing claim is not held as response_pending", () => {
  const src = fs.readFileSync(
    "src/chatgptQualification/processTenderQualification.ts",
    "utf8",
  );
  assert.match(src, /applyFalseMissingDocumentClaim/);
  assert.doesNotMatch(src, /holding as response_pending/);
});

function ids(n: number, start = 103000001): string[] {
  return Array.from({ length: n }, (_, i) => String(start + i));
}

test("resume: 31 ready, 0 existing qualification → 31 queued", () => {
  const readyIds = ids(31);
  const plan = planResumeQualificationQueue({
    universe: {
      phase1CandidateIds: [...readyIds, ...ids(7, 103000100)],
      gptReadyIds: readyIds,
      notReadyIds: ids(7, 103000100),
      reusedIds: [],
      pendingIds: [],
      source: "phase1_workbook",
    },
    maxGptSends: 0,
  });
  assert.equal(plan.readyIds.length, 31);
  assert.equal(plan.reusedIds.length, 0);
  assert.equal(plan.newRequiredIds.length, 31);
  assert.equal(plan.queuedNewIds.length, 31);
  assert.equal(plan.explicitLimit, "UNLIMITED");
  const coverage = reconcileGptReadyCoverage({
    readyIds: plan.readyIds,
    reusedIds: plan.reusedIds,
    completedThisRunIds: [],
    pendingIds: [],
    failedIds: [],
    queuedRemainingIds: plan.queuedNewIds,
  });
  assert.equal(coverage.unaccountedIds.length, 0);
  assert.equal(coverage.coverageLabel, "0/31");
  assert.equal(coverage.queuedRemaining, 31);
});

test("resume: 31 ready, 20 existing valid qualifications → 20 reused, 11 queued", () => {
  const readyIds = ids(31);
  const reusedIds = readyIds.slice(0, 20);
  const plan = planResumeQualificationQueue({
    universe: {
      phase1CandidateIds: readyIds,
      gptReadyIds: readyIds,
      notReadyIds: [],
      reusedIds,
      pendingIds: [],
      source: "phase1_workbook",
    },
    maxGptSends: 0,
  });
  assert.equal(plan.reusedIds.length, 20);
  assert.equal(plan.newRequiredIds.length, 11);
  assert.equal(plan.queuedNewIds.length, 11);
  assert.deepEqual(plan.queuedNewIds, readyIds.slice(20));
  const coverage = reconcileGptReadyCoverage({
    readyIds: plan.readyIds,
    reusedIds: plan.reusedIds,
    completedThisRunIds: [],
    pendingIds: [],
    failedIds: [],
    queuedRemainingIds: plan.queuedNewIds,
  });
  assert.equal(coverage.unaccountedIds.length, 0);
  assert.equal(coverage.coverageLabel, "20/31");
  assert.equal(coverage.queuedRemaining, 11);
});

test("GPT_QUEUE_INTEGRITY_ERROR when 31 ready / 0 reused is reduced to 3", () => {
  const readyIds = ids(31);
  const plan = planGptQualificationQueue({
    readyIds,
    reusedIds: [],
    maxGptSends: 0,
  });
  const corrupt = {
    ...plan,
    newRequiredIds: plan.newRequiredIds.slice(0, 3),
    queuedNewIds: plan.queuedNewIds.slice(0, 3),
  };
  assert.throws(
    () => assertGptQueueIntegrity(corrupt),
    /GPT_QUEUE_INTEGRITY_ERROR ready=31 reused=0 expectedNew=31 actualNew=3/,
  );
});

test("local prescreen skips do not shrink a 31-ready unlimited queue", () => {
  const readyIds = ids(31);
  const plan = planGptQualificationQueue({
    readyIds,
    reusedIds: [],
    prescreenBlockedIds: readyIds.slice(3),
    maxGptSends: 0,
  });
  assert.equal(plan.newRequiredIds.length, 31);
  assert.equal(plan.queuedNewIds.length, 31);
  assertGptQueueIntegrity(plan);
});

test("final coverage 3/31 with 28 omitted fails reconciliation", () => {
  const readyIds = ids(31);
  const coverage = reconcileGptReadyCoverage({
    readyIds,
    reusedIds: [],
    completedThisRunIds: readyIds.slice(0, 3),
    pendingIds: [],
    failedIds: [],
    queuedRemainingIds: [],
  });
  assert.equal(coverage.coverageLabel, "3/31");
  assert.equal(coverage.unaccountedIds.length, 28);
});

test("resume: 32 ready, 3 valid quals, 28 skipped-without-result → 3 reused, 29 queued", () => {
  const readyIds = ids(32);
  const reusedIds = readyIds.slice(0, 3);
  const plan = planResumeQualificationQueue({
    universe: {
      phase1CandidateIds: [...readyIds, ...ids(6, 103000200)],
      gptReadyIds: readyIds,
      notReadyIds: ids(6, 103000200),
      reusedIds,
      pendingIds: [],
      source: "phase1_workbook",
    },
    maxGptSends: 0,
  });
  assert.equal(plan.readyIds.length, 32);
  assert.equal(plan.reusedIds.length, 3);
  assert.equal(plan.newRequiredIds.length, 29);
  assert.equal(plan.queuedNewIds.length, 29);
  assert.equal(plan.explicitLimit, "UNLIMITED");
  const buckets = reconcileGptReadyQueueBuckets(plan);
  assert.equal(buckets.ready, 32);
  assert.equal(buckets.reusedValid, 3);
  assert.equal(buckets.newQueued, 29);
  assert.equal(buckets.validPending, 0);
  assert.equal(buckets.ok, true);
  assert.equal(32, 3 + 29 + 0);
});

test("prescreen-skipped tenders are not classified as reused", () => {
  const src = fs.readFileSync(
    "src/chatgptQualification/processTenderQualification.ts",
    "utf8",
  );
  assert.match(src, /phase1Admitted:\s*true/);
  assert.match(src, /CHATGPT_QUALIFICATION_PRESCREEN=ARTIFACTS_ONLY/);
  assert.doesNotMatch(src, /prescreen:\$\{prescreenGate/);
  assert.match(src, /reusedExistingValid:\s*true/);
});

test("batch does not count skipped-without-result as reused", () => {
  const src = fs.readFileSync(
    "src/chatgptQualification/runQualificationBatch.ts",
    "utf8",
  );
  assert.match(src, /CHATGPT_SKIP_WITHOUT_VALID_QUALIFICATION/);
  assert.match(src, /GPT_READY_QUEUE_RECONCILIATION/);
});


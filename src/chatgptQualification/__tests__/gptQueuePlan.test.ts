import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  assertGptReadyFullyAccounted,
  planGptQualificationQueue,
} from "../gptQueuePlan.js";

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
  assert.match(src, /planGptQualificationQueue/);
  assert.match(src, /allowMissingPrescreenRow: true/);
  assert.doesNotMatch(src, /limit: chatgptSelectionLimit/);
  assert.match(src, /CHATGPT_NOT_QUEUED=/);
  assert.match(src, /CHATGPT_NEW_REQUIRED_TENDER_IDS/);
});

test("complete JSON with false missing claim is not held as response_pending", () => {
  const src = fs.readFileSync(
    "src/chatgptQualification/processTenderQualification.ts",
    "utf8",
  );
  assert.match(src, /applyFalseMissingDocumentClaim/);
  assert.doesNotMatch(src, /holding as response_pending/);
});

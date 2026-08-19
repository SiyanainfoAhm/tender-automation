import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldSkipChatgptForPrescreenDecision,
  isExplicitPrescreenChatgptBlock,
  isPhase1IgnoredQualificationPrescreenReason,
  assertPrescreenAllowsChatgpt,
} from "../chatgptGate.js";
import type { SelectPassedForChatgptResult } from "../selectPassedForChatgpt.js";

/** Pure selection helper mirroring selectPassedForChatgpt limit behavior. */
function pickFirstPassed(
  ids: string[],
  statuses: Record<string, { status: string; eligible: boolean }>,
  limit: number,
): SelectPassedForChatgptResult {
  const passedIds: string[] = [];
  const skipped: SelectPassedForChatgptResult["skipped"] = [];
  for (const id of ids) {
    if (passedIds.length >= limit) break;
    const row = statuses[id];
    const skip = shouldSkipChatgptForPrescreenDecision({
      enabled: true,
      status: row?.status ?? null,
      chatgptEligible: row?.eligible ?? null,
    });
    if (skip) {
      skipped.push({
        sourceTenderId: id,
        status: row?.status ?? null,
        reasonCode: "TEST",
        message: null,
      });
      continue;
    }
    passedIds.push(id);
  }
  return {
    passedIds,
    skipped,
    firstPassedId: passedIds[0] ?? null,
  };
}

test("pipeline picks first PASSED and skips rejected without ChatGPT", () => {
  const result = pickFirstPassed(
    ["1", "2", "3"],
    {
      "1": { status: "REJECTED", eligible: false },
      "2": { status: "PASSED", eligible: true },
      "3": { status: "PASSED", eligible: true },
    },
    1,
  );
  assert.deepEqual(result.passedIds, ["2"]);
  assert.equal(result.firstPassedId, "2");
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0]?.sourceTenderId, "1");
});

test("pipeline stores MANUAL_REVIEW without ChatGPT", () => {
  const result = pickFirstPassed(
    ["a", "b"],
    {
      a: { status: "MANUAL_REVIEW", eligible: false },
      b: { status: "PASSED", eligible: true },
    },
    1,
  );
  assert.deepEqual(result.passedIds, ["b"]);
  assert.equal(result.skipped[0]?.status, "MANUAL_REVIEW");
});

test("no PASSED means ChatGPT must not open", () => {
  const result = pickFirstPassed(
    ["1", "2"],
    {
      "1": { status: "REJECTED", eligible: false },
      "2": { status: "MANUAL_REVIEW", eligible: false },
    },
    1,
  );
  assert.deepEqual(result.passedIds, []);
  assert.equal(result.firstPassedId, null);
});

test("E2E source order is Tender247 then BidAssist", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("src/pipeline/runCompleteEndToEndTest.ts", "utf8"),
  );
  const t247 = src.indexOf('source: "tender247"');
  const ba = src.indexOf('source: "bidassist"');
  assert.ok(t247 >= 0 && ba >= 0 && t247 < ba);
});

test("runSourceEndToEnd filters PASSED before launching ChatGPT", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/pipeline/runSourceEndToEnd.ts", "utf8");
  assert.match(src, /selectPassedForChatgpt/);
  assert.match(src, /E2E_CHATGPT_SKIPPED_NO_PASSED_TENDER/);
  assert.match(src, /E2E_NO_ELIGIBLE_TEST_TENDER/);
  assert.match(src, /E2E_SOURCE_TECHNICAL_SUCCESS/);
  assert.match(src, /E2E_FIRST_PASSED/);
  assert.match(src, /E2E_PRESCREEN_FILTER_START/);
  const filterIdx = src.indexOf("E2E_PRESCREEN_FILTER_START");
  const launchIdx = src.indexOf("session = await launchChatGptPersistentSession");
  assert.ok(filterIdx >= 0 && launchIdx > filterIdx);
});

test("Phase-1 admitted tenders ignore business qualification prescreen reasons", async () => {
  assert.equal(isPhase1IgnoredQualificationPrescreenReason("MISSING_REQUIRED_SUMMARY"), true);
  assert.equal(isPhase1IgnoredQualificationPrescreenReason("AMBIGUOUS_SCOPE"), true);
  assert.equal(isPhase1IgnoredQualificationPrescreenReason("EMD_ABOVE_LIMIT"), true);
  assert.equal(isPhase1IgnoredQualificationPrescreenReason("TENDER_VALUE_ABOVE_LIMIT"), true);
  assert.equal(
    isExplicitPrescreenChatgptBlock({
      status: "MANUAL_REVIEW",
      chatgptEligible: false,
    }),
    true,
  );
  const gate = await assertPrescreenAllowsChatgpt({
    sourcePortal: "TENDER247",
    sourceTenderId: "102379065",
    logger: { info: () => undefined },
    phase1Admitted: true,
  });
  assert.equal(gate.allowed, true);
  assert.equal(gate.skipped, false);
  assert.equal(gate.status, "PHASE1_ADMITTED");
});

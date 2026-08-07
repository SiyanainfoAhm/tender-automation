import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProductionLimitCap,
  chatgptSelectionLimit,
  formatProductionLimit,
  isUnlimitedProductionLimit,
  resolveProductionLimit,
} from "../productionLimit.js";
import { remainingSlots, shouldContinuePagination } from "../bidassist/bidassistPagination.js";
import { shouldSkipChatgptForPrescreenDecision } from "../prescreen/chatgptGate.js";
import type { SelectPassedForChatgptResult } from "../prescreen/selectPassedForChatgpt.js";

/** Mirrors selectPassedForChatgpt limit resolution (0 / undefined → all PASSED). */
function selectPassedWithLimit(
  ids: string[],
  statuses: Record<string, { status: string; eligible: boolean }>,
  maxGptTenders: number,
): SelectPassedForChatgptResult {
  const limit =
    chatgptSelectionLimit(maxGptTenders) ?? Number.POSITIVE_INFINITY;
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

test("MAX_TENDERS=0 means UNLIMITED (never process zero)", () => {
  assert.equal(isUnlimitedProductionLimit(0), true);
  assert.equal(resolveProductionLimit(0), Number.POSITIVE_INFINITY);
  assert.equal(formatProductionLimit(0), "UNLIMITED");
  assert.deepEqual(
    applyProductionLimitCap(["a", "b", "c", "d", "e"], 0),
    ["a", "b", "c", "d", "e"],
  );
  assert.deepEqual(applyProductionLimitCap(["a", "b", "c"], 2), ["a", "b"]);
  assert.equal(formatProductionLimit(5), "5");
});

test("MAX_BIDASSIST_TENDERS=0 means UNLIMITED after category/date filters", () => {
  assert.equal(formatProductionLimit(0), "UNLIMITED");
  assert.equal(shouldContinuePagination({ processedCount: 0, limit: 0 }), true);
  assert.equal(shouldContinuePagination({ processedCount: 999, limit: 0 }), true);
  assert.equal(
    remainingSlots({ processedCount: 50, limit: 0 }),
    Number.POSITIVE_INFINITY,
  );
  assert.equal(shouldContinuePagination({ processedCount: 5, limit: 5 }), false);
  assert.equal(remainingSlots({ processedCount: 2, limit: 5 }), 3);
});

test("MAX_GPT_TENDERS=0 processes every PASSED + chatgpt_eligible tender", () => {
  assert.equal(chatgptSelectionLimit(0), undefined);
  assert.equal(chatgptSelectionLimit(5), 5);
  assert.equal(formatProductionLimit(0), "UNLIMITED");

  const statuses = {
    "1": { status: "REJECTED", eligible: false },
    "2": { status: "MANUAL_REVIEW", eligible: false },
    "3": { status: "PASSED", eligible: true },
    "4": { status: "PASSED", eligible: true },
    "5": { status: "REJECTED", eligible: false },
  };

  const unlimited = selectPassedWithLimit(
    ["1", "2", "3", "4", "5"],
    statuses,
    0,
  );
  assert.deepEqual(unlimited.passedIds, ["3", "4"]);
  assert.equal(unlimited.skipped.length, 3);
  // Rejected / manual-review must not consume the GPT quota.
  assert.ok(unlimited.passedIds.length === 2);

  const capped = selectPassedWithLimit(["1", "2", "3", "4", "5"], statuses, 1);
  assert.deepEqual(capped.passedIds, ["3"]);
  assert.equal(capped.skipped.length, 2);
});

test("startup limit labels use UNLIMITED for zero", () => {
  assert.equal(`TENDER247_LIMIT=${formatProductionLimit(0)}`, "TENDER247_LIMIT=UNLIMITED");
  assert.equal(`BIDASSIST_LIMIT=${formatProductionLimit(0)}`, "BIDASSIST_LIMIT=UNLIMITED");
  assert.equal(
    `CHATGPT_QUALIFICATION_LIMIT=${formatProductionLimit(0)}`,
    "CHATGPT_QUALIFICATION_LIMIT=UNLIMITED",
  );
  assert.equal(`TENDER247_LIMIT=${formatProductionLimit(5)}`, "TENDER247_LIMIT=5");
});

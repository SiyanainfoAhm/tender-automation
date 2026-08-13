/**
 * Regression: RESPONSE_PENDING / rate-limit must not terminate the batch,
 * and fresh-tab / Send-slot mutation guards hold.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  mayMutateComposerWhileWaitingForSendSlot,
  mayMutatePageAfterPromptSubmitted,
  shouldExitBatchWhileQueueRemains,
  shouldLeaveBrowserOpenSolelyForResponsePending,
} from "../batchLifecyclePolicy.js";
import {
  getGlobalChatGptRateLimitState,
  getGlobalRateLimitRemainingMs,
  isGlobalChatGptRateLimited,
  resetGlobalChatGptRateLimitForTests,
  resetGlobalUploadAccountingForTests,
  tripGlobalChatGptRateLimit,
  waitWhileGlobalChatGptRateLimited,
  recordGlobalUploadAttempt,
  getGlobalUploadAttemptsTotal,
} from "../globalChatGptRateLimit.js";

describe("batch lifecycle — response_pending must not end batch", () => {
  it("remainingQueued=11 + response_pending → do NOT exit / leave browser", () => {
    assert.equal(
      shouldExitBatchWhileQueueRemains({
        remainingQueued: 11,
        status: "RUNNING",
      }),
      false,
    );
    assert.equal(
      shouldLeaveBrowserOpenSolelyForResponsePending({
        hasResponsePending: true,
        remainingQueued: 11,
      }),
      false,
    );
  });

  it("queue A pending must not drop B/C (exit only when remainingQueued=0)", () => {
    // After A → response_pending recovery, B and C still queued.
    assert.equal(
      shouldExitBatchWhileQueueRemains({ remainingQueued: 2 }),
      false,
    );
    assert.equal(
      shouldExitBatchWhileQueueRemains({ remainingQueued: 0 }),
      true,
    );
  });

  it("fatal / operator cancel may exit with remaining queue", () => {
    assert.equal(
      shouldExitBatchWhileQueueRemains({
        remainingQueued: 5,
        status: "FAILED_FATAL",
      }),
      true,
    );
    assert.equal(
      shouldExitBatchWhileQueueRemains({
        remainingQueued: 5,
        status: "OPERATOR_CANCELLED",
      }),
      true,
    );
  });

  it("after Send: no mutate until terminal", () => {
    assert.equal(
      mayMutatePageAfterPromptSubmitted({
        promptSubmitted: true,
        candidateTerminal: false,
      }),
      false,
    );
    assert.equal(
      mayMutatePageAfterPromptSubmitted({
        promptSubmitted: true,
        candidateTerminal: true,
      }),
      true,
    );
  });

  it("WAITING_FOR_SEND_SLOT: no composer mutation", () => {
    assert.equal(mayMutateComposerWhileWaitingForSendSlot(true), false);
    assert.equal(mayMutateComposerWhileWaitingForSendSlot(false), true);
  });
});

describe("global ChatGPT rate limit coordinator", () => {
  afterEach(() => {
    resetGlobalChatGptRateLimitForTests();
    resetGlobalUploadAccountingForTests();
  });

  it("trips shared GLOBAL_RATE_LIMITED and pauses both workers", () => {
    let now = 1_000_000;
    resetGlobalChatGptRateLimitForTests({ clock: { now: () => now } });

    tripGlobalChatGptRateLimit({ backoffMs: 600_000 });
    assert.equal(isGlobalChatGptRateLimited(), true);
    const state = getGlobalChatGptRateLimitState();
    assert.equal(state.limited, true);
    assert.equal(state.backoffMs, 600_000);
    assert.equal(getGlobalRateLimitRemainingMs(), 600_000);

    // Advance past window → cleared
    now += 600_001;
    assert.equal(isGlobalChatGptRateLimited(), false);
  });

  it("waitWhileGlobalChatGptRateLimited resolves after backoff", async () => {
    let now = 5_000_000;
    resetGlobalChatGptRateLimitForTests({ clock: { now: () => now } });
    tripGlobalChatGptRateLimit({ backoffMs: 50 });

    const waiter = waitWhileGlobalChatGptRateLimited({ pollMs: 10 });
    // Simulate time passing while waiter polls
    const advance = setInterval(() => {
      now += 20;
    }, 5);
    await waiter;
    clearInterval(advance);
    assert.equal(isGlobalChatGptRateLimited(), false);
  });

  it("shared upload accounting is account-level", () => {
    resetGlobalUploadAccountingForTests();
    recordGlobalUploadAttempt(2);
    recordGlobalUploadAttempt(1);
    assert.equal(getGlobalUploadAttemptsTotal(), 3);
  });
});

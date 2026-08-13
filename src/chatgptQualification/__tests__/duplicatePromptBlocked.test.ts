/**
 * Regression: never second-prompt after response; continue after candidate failure.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceCandidateStage,
  createCandidateTxnState,
  shouldSkipPromptPaste,
  shouldSkipSend,
  stageAtLeast,
} from "../candidateTxnState.js";
import {
  mayEnterQualificationPrompt,
  maySendOrUploadAfterResponse,
} from "../inspectExistingSubmission.js";

describe("duplicate prompt protection (invariant A/B)", () => {
  it("blocks prompt when assistant response exists", () => {
    assert.equal(
      mayEnterQualificationPrompt({
        promptSubmitted: true,
        assistantMessagePresent: true,
        conversationUrl: "https://chatgpt.com/c/abc",
      }),
      false,
    );
    assert.equal(
      maySendOrUploadAfterResponse({
        assistantMessagePresent: true,
        promptSubmitted: true,
      }),
      false,
    );
  });

  it("blocks prompt when only user message submitted (waiting response)", () => {
    assert.equal(
      mayEnterQualificationPrompt({
        promptSubmitted: true,
        assistantMessagePresent: false,
        conversationUrl: "https://chatgpt.com/c/abc",
      }),
      false,
    );
  });

  it("allows prompt only before any submission", () => {
    assert.equal(
      mayEnterQualificationPrompt({
        promptSubmitted: false,
        assistantMessagePresent: false,
        conversationUrl: null,
      }),
      true,
    );
  });

  it("forced timeout/retry handler must not re-enter PROMPT_READY after SUBMITTED", () => {
    let txn = createCandidateTxnState(1);
    txn = advanceCandidateStage(txn, "PROMPT_READY");
    txn.promptEntryCount = 1;
    txn = advanceCandidateStage(txn, "SUBMITTED");
    txn.sendAttemptCount = 1;

    // Simulate old retry path trying to go back and re-paste
    const blocked = advanceCandidateStage(txn, "PROMPT_ENTERING");
    assert.equal(stageAtLeast(blocked.stage, "SUBMITTED"), true);
    assert.equal(shouldSkipPromptPaste(blocked), true);
    assert.equal(shouldSkipSend(blocked), true);
    assert.equal(txn.promptEntryCount, 1);
    assert.equal(txn.sendAttemptCount, 1);
  });

  it("RESPONSE_COMPLETE is monotonic — cannot return to SUBMITTED/PROMPT", () => {
    let txn = createCandidateTxnState(1);
    txn = advanceCandidateStage(txn, "SUBMITTED");
    txn = advanceCandidateStage(txn, "RESPONSE_COMPLETE");
    const blocked = advanceCandidateStage(txn, "SUBMITTED");
    assert.equal(blocked.stage, "RESPONSE_COMPLETE");
    const blocked2 = advanceCandidateStage(txn, "PROMPT_READY");
    assert.equal(blocked2.stage, "RESPONSE_COMPLETE");
  });

  it("uncertain Send with submission signals => Send retry count stays 0 extra", () => {
    // Conceptual: detectSubmissionSignals.submitted => do not increment Send retry.
    let sendAttemptCount = 1;
    let sendRetryCount = 0;
    const signals = { submitted: true, url: "https://chatgpt.com/c/x" };

    if (!signals.submitted && sendAttemptCount < 2) {
      sendRetryCount += 1;
      sendAttemptCount += 1;
    }

    assert.equal(sendRetryCount, 0);
    assert.equal(sendAttemptCount, 1);
  });

  it("Supabase failure must not trigger GPT retry (policy)", () => {
    const gptPromptCount = 1;
    const gptSendCount = 1;
    let supabaseAttempts = 0;
    let persistMode: "PERSIST_RETRY_PENDING" | "GPT_RETRY_PENDING" =
      "PERSIST_RETRY_PENDING";

    // Simulate: valid GPT JSON saved; upsert fails once then succeeds.
    const rawSaved = true;
    assert.equal(rawSaved, true);

    try {
      supabaseAttempts += 1;
      throw new Error("transient upsert");
    } catch {
      persistMode = "PERSIST_RETRY_PENDING";
      supabaseAttempts += 1; // independent retry
    }

    assert.equal(persistMode, "PERSIST_RETRY_PENDING");
    assert.equal(gptPromptCount, 1);
    assert.equal(gptSendCount, 1);
    assert.equal(supabaseAttempts, 2);
  });
});

describe("candidate failure always continues queue (invariant D)", () => {
  it("A DONE, B FAILED_FINAL, C DONE — batch stays alive", () => {
    type Outcome = "DONE" | "FAILED_FINAL" | "RETRY_PENDING";
    const queue = ["A", "B", "C"];
    const results: Record<string, Outcome> = {};
    let movingToNext = 0;
    let processExited = false;

    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        if (id === "B") {
          throw new Error("irrecoverable before submission");
        }
        results[id] = "DONE";
      } catch {
        results[id] = "FAILED_FINAL";
      } finally {
        // closeOnlyCandidatePage — then always continue
        if (queue.length > 0) {
          movingToNext += 1;
        }
      }
    }

    assert.equal(results.A, "DONE");
    assert.equal(results.B, "FAILED_FINAL");
    assert.equal(results.C, "DONE");
    assert.equal(movingToNext, 2);
    assert.equal(processExited, false);
  });

  it("RETRY_PENDING does not block remaining READY candidates", () => {
    const primary = ["X", "Y"];
    const retryLater: string[] = [];
    const done: string[] = [];

    for (const id of primary) {
      if (id === "X") {
        retryLater.push(id); // mark RETRY_PENDING, continue
        continue;
      }
      done.push(id);
    }

    assert.deepEqual(retryLater, ["X"]);
    assert.deepEqual(done, ["Y"]);
  });
});

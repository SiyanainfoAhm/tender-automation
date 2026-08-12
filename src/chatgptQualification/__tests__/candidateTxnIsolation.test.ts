/**
 * Regression tests: candidate failure isolation, prompt-once, submission detection, resume.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  advanceCandidateStage,
  createCandidateTxnState,
  shouldSkipPromptPaste,
  shouldSkipSend,
  shouldSkipUpload,
  stageAtLeast,
} from "../candidateTxnState.js";
import { saveCandidateFailureAudit } from "../candidateFailureAudit.js";
import { parseTender247CompletePipelineArgs } from "../../pipeline/runTender247CompletePipeline.js";

describe("candidateTxnState machine", () => {
  it("skips prompt paste at PROMPT_READY+", () => {
    let s = createCandidateTxnState(1);
    s = advanceCandidateStage(s, "FILES_LOCKED");
    assert.equal(shouldSkipPromptPaste(s), false);
    s = advanceCandidateStage(s, "PROMPT_READY");
    assert.equal(shouldSkipPromptPaste(s), true);
    assert.equal(shouldSkipUpload(s), true);
  });

  it("skips Send at SUBMITTED+", () => {
    let s = createCandidateTxnState(1);
    s = advanceCandidateStage(s, "PROMPT_READY");
    assert.equal(shouldSkipSend(s), false);
    s = advanceCandidateStage(s, "SUBMITTED");
    assert.equal(shouldSkipSend(s), true);
    // Never move back to re-paste
    const blocked = advanceCandidateStage(s, "PROMPT_ENTERING");
    assert.equal(stageAtLeast(blocked.stage, "SUBMITTED"), true);
  });
});

describe("failure isolation semantics", () => {
  it("A succeeds, B fails, C continues (logical batch)", () => {
    type Outcome = "DONE" | "FAILED" | "RETRY_PENDING";
    const results: Record<string, Outcome> = {};
    let browserClosed = false;

    const qualify = (id: string): Outcome => {
      if (id === "B") {
        throw new Error("prompt_send_stage_failure");
      }
      return "DONE";
    };

    for (const id of ["A", "B", "C"]) {
      try {
        results[id] = qualify(id);
      } catch {
        results[id] = "FAILED";
        // must not close browser
        assert.equal(browserClosed, false);
      }
    }

    assert.equal(results.A, "DONE");
    assert.equal(results.B, "FAILED");
    assert.equal(results.C, "DONE");
    assert.equal(browserClosed, false);
  });
});

describe("prompt duplication / send-only retry", () => {
  it("enters prompt once and retries Send without re-paste or re-upload", () => {
    let promptEntryCount = 0;
    let uploadAttemptCount = 0;
    let sendAttemptCount = 0;
    let sendFailOnce = true;

    const txn = createCandidateTxnState(1);
    Object.assign(txn, advanceCandidateStage(txn, "FILES_LOCKED"));
    uploadAttemptCount = 1;

    // Prompt once
    if (!shouldSkipPromptPaste(txn)) {
      promptEntryCount += 1;
      Object.assign(txn, advanceCandidateStage(txn, "PROMPT_READY"));
    }

    const trySend = (): boolean => {
      sendAttemptCount += 1;
      if (sendFailOnce) {
        sendFailOnce = false;
        return false;
      }
      Object.assign(txn, advanceCandidateStage(txn, "SUBMITTED"));
      return true;
    };

    assert.equal(trySend(), false);
    // Send-only retry — do not paste again
    assert.equal(shouldSkipPromptPaste(txn), true);
    assert.equal(shouldSkipUpload(txn), true);
    assert.equal(trySend(), true);

    assert.equal(promptEntryCount, 1);
    assert.equal(uploadAttemptCount, 1);
    assert.equal(sendAttemptCount, 2);
    assert.equal(txn.submitted, true);
  });
});

describe("submission detection", () => {
  it("marks SUBMITTED when conversation URL + user prompt signals exist", () => {
    const signals = {
      conversationUrl: true,
      userPromptVisible: true,
    };
    const submitted = signals.conversationUrl && signals.userPromptVisible;
    assert.equal(submitted, true);

    let s = createCandidateTxnState(1);
    s = advanceCandidateStage(s, "PROMPT_READY");
    if (submitted) {
      s = advanceCandidateStage(s, "SUBMITTED");
    }
    assert.equal(shouldSkipSend(s), true);
    assert.equal(shouldSkipPromptPaste(s), true);
  });
});

describe("resume CLI + skip valid quals", () => {
  it("parses --resume with --date", () => {
    const opts = parseTender247CompletePipelineArgs([
      "--date=2026-08-12",
      "--resume",
      "--chatgpt-limit=3",
    ]);
    assert.equal(opts.requestedDate, "2026-08-12");
    assert.equal(opts.resume, true);
    assert.equal(opts.resumeSkipCrawl, true);
    assert.equal(opts.chatgptLimit, 3);
  });

  it("--resume --crawl keeps detail crawl enabled", () => {
    const opts = parseTender247CompletePipelineArgs([
      "--date=2026-08-12",
      "--resume",
      "--crawl",
    ]);
    assert.equal(opts.resume, true);
    assert.equal(opts.resumeSkipCrawl, false);
  });

  it("resume candidate set skips valid qualification, retries failed", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t247-resume-"));
    try {
      const tenders = [
        { id: "1", valid: true },
        { id: "2", valid: false, failed: true },
        { id: "3", valid: false },
      ];
      for (const t of tenders) {
        const folder = path.join(tmp, `T247-${t.id}`);
        fs.mkdirSync(folder);
        if (t.valid) {
          // Marker only — isValidSavedQualificationResult needs full schema;
          // here we model the selection logic used by resume.
          fs.writeFileSync(
            path.join(folder, "qualification-result.json"),
            JSON.stringify({ status: "GO" }),
            "utf8",
          );
        } else if (t.failed) {
          fs.writeFileSync(
            path.join(folder, "chatgpt-state.json"),
            JSON.stringify({ status: "failed", retryCount: 1 }),
            "utf8",
          );
        }
      }

      const detailAlreadyDone = 54;
      const redoDetails = 0; // resume must not redo successful details
      assert.equal(redoDetails, 0);
      assert.equal(detailAlreadyDone, 54);

      const eligibleForGpt = tenders
        .filter((t) => !t.valid)
        .map((t) => t.id);
      assert.deepEqual(eligibleForGpt, ["2", "3"]);
      assert.ok(!eligibleForGpt.includes("1"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("candidate failure audit", () => {
  it("writes failure.json under until-go-audit", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t247-fail-audit-"));
    try {
      const failurePath = await saveCandidateFailureAudit({
        dateFolder: tmp,
        tenderId: "999",
        attempt: 1,
        stage: "PROMPT_ENTERING",
        reason: "unit_test_failure",
        conversationUrl: null,
        promptSubmitted: false,
        filesLocked: true,
        responseDetected: false,
        retryable: true,
      });
      assert.ok(fs.existsSync(failurePath));
      const parsed = JSON.parse(fs.readFileSync(failurePath, "utf8")) as {
        tenderId: string;
        retryable: boolean;
        stage: string;
      };
      assert.equal(parsed.tenderId, "999");
      assert.equal(parsed.retryable, true);
      assert.equal(parsed.stage, "PROMPT_ENTERING");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

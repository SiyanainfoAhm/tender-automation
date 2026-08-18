/**
 * Global Send throttle must serialize workers even when they race at T+0.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  createChatGptSubmissionScheduler,
  resetSharedChatGptSubmissionSchedulerForTests,
  type ChatGptSubmissionClock,
} from "../../concurrency/chatGptSubmissionScheduler.js";
import { chatgptLastSubmissionPath } from "../submissionThrottle.js";

function createFakeClock(startMs = 1_000_000): ChatGptSubmissionClock & {
  advance: (ms: number) => void;
  nowMs: () => number;
} {
  let now = startMs;
  return {
    now: () => now,
    nowMs: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe("CHATGPT_CONCURRENCY=2 global Send throttling", () => {
  let tmpDir = "";
  let prevCwd = "";

  beforeEach(() => {
    resetSharedChatGptSubmissionSchedulerForTests();
    prevCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-throttle-"));
    process.chdir(tmpDir);
    fs.mkdirSync(path.join(tmpDir, "runtime"), { recursive: true });
  });

  afterEach(() => {
    process.chdir(prevCwd);
    resetSharedChatGptSubmissionSchedulerForTests();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Worker2 Send is >= 300000ms after Worker1 when both start together", async () => {
    const clock = createFakeClock(0);
    const minIntervalMs = 300_000;
    const scheduler = createChatGptSubmissionScheduler({
      minIntervalMs,
      clock,
      initialLastSubmissionAtMs: null,
    });

    const sendAts: number[] = [];

    const worker = async (id: number) => {
      await scheduler.withGlobalSendSlot({
        workerId: id,
        sourcePortal: "TENDER247",
        sourceTenderId: String(id),
        send: async () => {
          sendAts.push(clock.now());
          return { submitted: true, result: id };
        },
      });
    };

    await Promise.all([worker(1), worker(2)]);

    assert.equal(sendAts.length, 2);
    sendAts.sort((a, b) => a - b);
    assert.equal(sendAts[0], 0);
    assert.ok(
      sendAts[1]! - sendAts[0]! >= minIntervalMs,
      `expected gap >= ${minIntervalMs}, got ${sendAts[1]! - sendAts[0]!}`,
    );

    // Third send from either worker must be >= T+600000
    await scheduler.withGlobalSendSlot({
      workerId: 1,
      sourcePortal: "TENDER247",
      sourceTenderId: "3",
      send: async () => {
        sendAts.push(clock.now());
        return { submitted: true, result: 3 };
      },
    });
    sendAts.sort((a, b) => a - b);
    assert.ok(sendAts[2]! - sendAts[1]! >= minIntervalMs);
    assert.ok(sendAts[2]! >= 600_000);
  });

  it("blocks throttle violations instead of warning", async () => {
    const clock = createFakeClock(0);
    const scheduler = createChatGptSubmissionScheduler({
      minIntervalMs: 300_000,
      clock,
      initialLastSubmissionAtMs: null,
    });

    await scheduler.acquireSendSlot({ workerId: 1 });
    scheduler.markSubmissionSuccess({
      sourcePortal: "TENDER247",
      sourceTenderId: "1",
    });
    scheduler.releaseSendSlot();

    // Simulate a buggy caller trying to mark another success immediately.
    clock.advance(1_000);
    assert.throws(
      () =>
        scheduler.markSubmissionSuccess({
          sourcePortal: "TENDER247",
          sourceTenderId: "2",
        }),
      /CHATGPT_GLOBAL_THROTTLE_VIOLATION/,
    );
  });

  it("persists one shared chatgpt-last-submission.json", async () => {
    const clock = createFakeClock(5_000);
    const scheduler = createChatGptSubmissionScheduler({
      minIntervalMs: 100,
      clock,
      initialLastSubmissionAtMs: null,
    });
    await scheduler.withGlobalSendSlot({
      workerId: 1,
      sourcePortal: "TENDER247",
      sourceTenderId: "99",
      send: async () => ({ submitted: true, result: true }),
    });
    const filePath = chatgptLastSubmissionPath();
    assert.ok(fs.existsSync(filePath));
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      sourceTenderId: string;
      lastSubmissionAt: string;
    };
    assert.equal(raw.sourceTenderId, "99");
    assert.ok(raw.lastSubmissionAt);
  });

  it("rate-limit backoff blocks the other worker Send", async () => {
    const clock = createFakeClock(0);
    const scheduler = createChatGptSubmissionScheduler({
      minIntervalMs: 1,
      rateLimitBackoffMs: 60_000,
      maxRateLimitBackoffMs: 60_000,
      clock,
      initialLastSubmissionAtMs: null,
    });

    scheduler.applyRateLimitBackoff(60_000);

    let sentAt: number | null = null;
    await scheduler.withGlobalSendSlot({
      workerId: 2,
      sourcePortal: "TENDER247",
      sourceTenderId: "7",
      send: async () => {
        sentAt = clock.now();
        return { submitted: true, result: true };
      },
    });
    assert.equal(sentAt, 60_000);
  });

  it("RUN_EXCEL_SCREENING skips the individual-tender min interval", async () => {
    const clock = createFakeClock(0);
    const logs: string[] = [];
    const capturingLogger = {
      info: (msg: string) => logs.push(msg),
      warn: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
      debug: () => undefined,
    } as unknown as import("../../logger.js").Logger;
      const scheduler = createChatGptSubmissionScheduler({
        minIntervalMs: 300_000,
        runScreeningMinIntervalMs: 0,
        clock,
        initialLastSubmissionAtMs: 0,
      });
      clock.advance(1_000);

      await scheduler.acquireSendSlot({
        workerId: 1,
        submissionKind: "RUN_EXCEL_SCREENING",
        logger: capturingLogger,
      });
      assert.equal(clock.now(), 1_000);
      scheduler.markSubmissionSuccess({
        sourcePortal: "TENDER247",
        sourceTenderId: "RUN-2026-08-18",
        force: true,
      });
      scheduler.releaseSendSlot();

      assert.equal(
        logs.some((line) => line.includes("CHATGPT_SUBMISSION_KIND=RUN_EXCEL_SCREENING")),
        true,
      );
      assert.equal(
        logs.some((line) => line.includes("CHATGPT_ARTIFICIAL_SEND_DELAY_MS=0")),
        true,
      );
      assert.equal(
        logs.some((line) => line.includes("CHATGPT_TENDER_MIN_SEND_INTERVAL_MS=300000")),
        true,
      );
      assert.equal(
        logs.some((line) => line.includes("CHATGPT_RUN_SCREENING_MIN_SEND_INTERVAL_MS=0")),
        true,
      );
      assert.equal(
        logs.some((line) => line.includes("CHATGPT_SCHEDULER_MIN_INTERVAL_WAIT_MS=")),
        false,
      );

      let tenderAt = -1;
      await scheduler.withGlobalSendSlot({
        workerId: 2,
        sourcePortal: "TENDER247",
        sourceTenderId: "101279958",
        submissionKind: "TENDER_QUALIFICATION",
        send: async () => {
          tenderAt = clock.now();
          return { submitted: true, result: true };
        },
      });
      assert.ok(
        tenderAt >= 1_000 + 300_000,
        `tender send should still wait; got ${tenderAt}`,
      );
  });
});

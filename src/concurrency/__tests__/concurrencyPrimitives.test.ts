import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedQueue } from "../boundedQueue.js";
import { runWorkerPool } from "../workerPool.js";
import {
  createChatGptSubmissionScheduler,
  resetSharedChatGptSubmissionSchedulerForTests,
} from "../chatGptSubmissionScheduler.js";
import { loadTender247ConcurrencyConfig, getTender247DocumentDownloadTimeoutMs } from "../../tender247Batch/tender247ConcurrencyConfig.js";

test("bounded queue respects max size", () => {
  const q = createBoundedQueue<string>(2);
  assert.equal(q.tryEnqueue("a"), true);
  assert.equal(q.tryEnqueue("b"), true);
  assert.equal(q.tryEnqueue("c"), false);
  assert.equal(q.size(), 2);
  assert.equal(q.dequeue(), "a");
  assert.equal(q.tryEnqueue("c"), true);
});

test("bounded queue priority prefers lower priority number first", () => {
  const q = createBoundedQueue<string>(10);
  q.tryEnqueue("late", 5);
  q.tryEnqueue("early", 1);
  assert.equal(q.dequeue(), "early");
  assert.equal(q.dequeue(), "late");
});

test("worker pool respects concurrency and isolates failures", async () => {
  const active = new Set<number>();
  let maxActive = 0;
  const outcomes = await runWorkerPool({
    items: [1, 2, 3, 4, 5, 6],
    concurrency: 4,
    worker: async (n, workerId) => {
      active.add(workerId);
      maxActive = Math.max(maxActive, active.size);
      await new Promise((r) => setTimeout(r, 20));
      active.delete(workerId);
      if (n === 3) throw new Error("boom");
      return n * 2;
    },
  });
  assert.ok(maxActive <= 4);
  assert.equal(outcomes.length, 6);
  assert.equal(outcomes.filter((o) => !o.ok).length, 1);
  assert.equal(outcomes.filter((o) => o.ok).length, 5);
});

test("ChatGPT submission scheduler serializes send slots", async () => {
  resetSharedChatGptSubmissionSchedulerForTests();
  const scheduler = createChatGptSubmissionScheduler({
    minIntervalMs: 50,
    maxWorkers: 2,
  });
  const order: string[] = [];
  const a = (async () => {
    await scheduler.acquireSendSlot({ workerId: 1 });
    order.push("a-hold");
    await new Promise((r) => setTimeout(r, 40));
    order.push("a-release");
    scheduler.releaseSendSlotSuccess({
      sourcePortal: "TENDER247",
      sourceTenderId: "1",
    });
  })();
  const b = (async () => {
    await new Promise((r) => setTimeout(r, 5));
    await scheduler.acquireSendSlot({ workerId: 2 });
    order.push("b-hold");
    scheduler.releaseSendSlotSuccess({
      sourcePortal: "TENDER247",
      sourceTenderId: "2",
    });
    order.push("b-release");
  })();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["a-hold", "a-release", "b-hold", "b-release"]);
});

test("concurrency defaults: detail 1, download 1, chatgpt 1, queue 10, interval 300s", () => {
  const cfg = loadTender247ConcurrencyConfig({});
  assert.equal(cfg.detailConcurrency, 1);
  assert.equal(cfg.downloadConcurrency, 1);
  assert.equal(cfg.artifactConcurrency, 1);
  assert.equal(cfg.chatgptConcurrency, 1);
  assert.equal(cfg.chatgptReadyQueueMax, 10);
  assert.equal(cfg.chatgptMinSubmissionIntervalMs, 300_000);
});

test("TENDER247_DOCUMENT_DOWNLOAD_TIMEOUT_MS defaults to 5 minutes", () => {
  assert.equal(getTender247DocumentDownloadTimeoutMs({}), 300_000);
});

test("CHATGPT_CONCURRENCY cannot exceed 2", () => {
  const cfg = loadTender247ConcurrencyConfig({ CHATGPT_CONCURRENCY: "9" });
  assert.equal(cfg.chatgptConcurrency, 2);
});

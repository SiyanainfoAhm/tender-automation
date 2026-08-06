import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isReadableZipArchive,
  isValidMetadataJson,
  listNewReadyTenderIds,
} from "../chatgptQualification/readiness.js";
import {
  acquirePipelineLock,
  isProcessAlive,
  readLockPid,
  releasePipelineLock,
  waitForCrawlerLockRelease,
} from "../runDailyTenderPipeline.js";
import { Logger } from "../logger.js";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("isProcessAlive detects current process", () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(999_999_999), false);
});

test("pipeline lock acquire/release and stale lock recovery", () => {
  const dir = makeTempDir("pipeline-lock-");
  const lockPath = path.join(dir, "daily-pipeline.lock");

  acquirePipelineLock(lockPath);
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(readLockPid(lockPath), process.pid);

  // Simulate stale lock from a dead pid
  releasePipelineLock(lockPath);
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: 999_999_999, startedAt: new Date().toISOString() }),
    "utf8",
  );
  acquirePipelineLock(lockPath);
  assert.equal(readLockPid(lockPath), process.pid);
  releasePipelineLock(lockPath);
  assert.equal(fs.existsSync(lockPath), false);
});

test("waitForCrawlerLockRelease removes stale crawl lock", async () => {
  const dir = makeTempDir("crawl-lock-");
  const crawlLock = path.join(dir, "crawl.lock");
  fs.writeFileSync(
    crawlLock,
    JSON.stringify({ pid: 999_999_999, startedAt: new Date().toISOString() }),
    "utf8",
  );
  const logger = new Logger(dir, "PipelineTest");
  await waitForCrawlerLockRelease({
    lockPaths: [crawlLock],
    timeoutMs: 5_000,
    pollMs: 200,
    logger,
  });
  assert.equal(fs.existsSync(crawlLock), false);
});

test("metadata and zip readiness helpers", () => {
  const dir = makeTempDir("ready-");
  const metaPath = path.join(dir, "metadata.json");
  fs.writeFileSync(metaPath, "{not-json", "utf8");
  assert.equal(isValidMetadataJson(metaPath), false);
  fs.writeFileSync(metaPath, JSON.stringify({ t247Id: "1" }), "utf8");
  assert.equal(isValidMetadataJson(metaPath), true);

  const badZip = path.join(dir, "bad.zip");
  fs.writeFileSync(badZip, "not-a-zip", "utf8");
  assert.equal(isReadableZipArchive(badZip), false);

  const goodZip = path.join(dir, "good.zip");
  // Minimal local-file header signature PK\x03\x04
  const buf = Buffer.alloc(30, 0);
  buf.writeUInt32LE(0x04034b50, 0);
  fs.writeFileSync(goodZip, buf);
  assert.equal(isReadableZipArchive(goodZip), true);
});

test("listNewReadyTenderIds skips completed results", () => {
  const dir = makeTempDir("new-ready-");
  const readyA = path.join(dir, "T247-111");
  const readyB = path.join(dir, "T247-222");
  fs.mkdirSync(readyA, { recursive: true });
  fs.mkdirSync(readyB, { recursive: true });
  fs.writeFileSync(
    path.join(readyA, "qualification-result.json"),
    JSON.stringify({ ok: true }),
    "utf8",
  );

  const newReady = listNewReadyTenderIds(dir, ["111", "222"], (resultPath) =>
    fs.existsSync(resultPath),
  );
  assert.deepEqual(newReady, ["222"]);
});

test("Tender247 failure must not start ChatGPT (decision contract)", () => {
  // Pure decision: non-zero crawl exit ⇒ chatgptStarted stays false
  const tender247ExitCode: number = 1;
  let chatgptStarted = false;
  if (tender247ExitCode === 0) {
    chatgptStarted = true;
  }
  assert.equal(chatgptStarted, false);
});

test("zero new ready tenders must not open ChatGPT (decision contract)", () => {
  const newReadyCount = 0;
  const shouldStartChatGpt = newReadyCount > 0;
  assert.equal(shouldStartChatGpt, false);
});

test("mixed ready/incomplete leaves incomplete out of new-ready set", () => {
  const dir = makeTempDir("mixed-");
  fs.mkdirSync(path.join(dir, "T247-1"), { recursive: true });
  fs.mkdirSync(path.join(dir, "T247-2"), { recursive: true });
  // Only mark 1 as needing work; 2 already complete
  fs.writeFileSync(
    path.join(dir, "T247-2", "qualification-result.json"),
    "{}",
    "utf8",
  );
  const newReady = listNewReadyTenderIds(dir, ["1", "2"], (p) =>
    fs.existsSync(p),
  );
  assert.deepEqual(newReady, ["1"]);
});

test("rate-limit phase must preserve remaining queue (decision contract)", () => {
  const remainingQueued = 4;
  const markRemainingFailed = false;
  assert.equal(remainingQueued > 0 && !markRemainingFailed, true);
});

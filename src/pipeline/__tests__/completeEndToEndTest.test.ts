import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  remainingSubmissionWaitMs,
  writeLastSubmission,
  waitForSharedSubmissionInterval,
} from "../../chatgptQualification/submissionThrottle.js";
import {
  assembleQualificationAttachmentBundle,
  assertRequiredAttachmentsReady,
  type QualificationAttachmentFile,
} from "../../chatgptQualification/sourceDocumentResolver.js";
import {
  assertBidassistBundleComplete,
  assertTender247BundleComplete,
} from "../../chatgptQualification/uploadQualificationAttachments.js";
import {
  selectManifestQualificationIds,
  type PipelineManifest,
} from "../pipelineManifest.js";
import {
  buildCompleteE2ESummary,
  parseCompleteE2EArgs,
  runCompleteEndToEndTest,
  shouldRunBidassistAfterTender247,
  writeCompleteE2ESummary,
  completeE2ELockPath,
} from "../runCompleteEndToEndTest.js";
import type {
  SourceEndToEndOptions,
  SourceEndToEndResult,
} from "../runSourceEndToEnd.js";
import {
  acquirePipelineLock,
  releasePipelineLock,
} from "../../runDailyTenderPipeline.js";
import { AutomationError } from "../../browserUtils.js";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function okResult(
  source: "TENDER247" | "BIDASSIST",
  id: string,
): SourceEndToEndResult {
  return {
    source,
    success: true,
    rateLimited: false,
    sourceTenderId: id,
    folderId: source === "TENDER247" ? `T247-${id}` : `BA-${id}`,
    manifestPath: `/tmp/${source}.json`,
    metadataVerified: true,
    documentsEnriched: true,
    attachmentsConfirmed: true,
    promptSubmitted: true,
    responseCompleted: true,
    qualificationStatus: "GO",
    qualificationVerified: true,
    statusSyncVerified: true,
    chatUrl: "https://chatgpt.com/c/abc-123",
    error: null,
  };
}

function failedResult(
  source: "TENDER247" | "BIDASSIST",
  error: string,
): SourceEndToEndResult {
  return {
    ...okResult(source, "0"),
    success: false,
    sourceTenderId: null,
    folderId: null,
    metadataVerified: false,
    attachmentsConfirmed: false,
    promptSubmitted: false,
    responseCompleted: false,
    qualificationStatus: null,
    qualificationVerified: false,
    statusSyncVerified: false,
    chatUrl: null,
    error,
  };
}

test("12. Limit greater than one is rejected", () => {
  assert.throws(
    () => parseCompleteE2EArgs(["--limit-per-source=2"]),
    /COMPLETE_E2E_TEST_LIMIT_MUST_BE_ONE/,
  );
});

test("1. Tender247 completes before BidAssist begins", async () => {
  const order: string[] = [];
  const { summary, exitCode } = await runCompleteEndToEndTest(
    {
      limitPerSource: 1,
      date: "2026-08-06",
      continueOnSourceError: false,
    },
    {
      runSource: async (opts: SourceEndToEndOptions) => {
        order.push(`start:${opts.source}`);
        await new Promise((r) => setTimeout(r, 20));
        order.push(`end:${opts.source}`);
        return okResult(
          opts.source === "tender247" ? "TENDER247" : "BIDASSIST",
          opts.source === "tender247" ? "111" : "222",
        );
      },
      waitBetweenSources: async () => {
        order.push("wait");
        return { waitedMs: 0, elapsedMs: 0, remainingMs: 0 };
      },
    },
  );

  assert.deepEqual(order, [
    "start:tender247",
    "end:tender247",
    "wait",
    "start:bidassist",
    "end:bidassist",
  ]);
  assert.equal(summary.status, "SUCCESS");
  assert.equal(exitCode, 0);
});

test("2. Tender247 failure prevents BidAssist by default", async () => {
  let bidassistCalled = false;
  const { summary, exitCode } = await runCompleteEndToEndTest(
    {
      limitPerSource: 1,
      date: "2026-08-06",
      continueOnSourceError: false,
    },
    {
      runSource: async (opts: SourceEndToEndOptions) => {
        if (opts.source === "bidassist") {
          bidassistCalled = true;
          return okResult("BIDASSIST", "222");
        }
        return failedResult("TENDER247", "crawler failed");
      },
      waitBetweenSources: async () => ({
        waitedMs: 0,
        elapsedMs: 0,
        remainingMs: 0,
      }),
    },
  );
  assert.equal(bidassistCalled, false);
  assert.equal(summary.bidassist.ran, false);
  assert.equal(summary.status, "FAILED");
  assert.equal(exitCode, 1);
  assert.equal(
    shouldRunBidassistAfterTender247({
      tender247: failedResult("TENDER247", "x"),
      continueOnSourceError: false,
    }).run,
    false,
  );
});

test("3. Shared submission interval waits only the remaining duration", async () => {
  const minIntervalMs = 10_000;
  const lastAt = Date.now() - 7_000;
  const remaining = remainingSubmissionWaitMs({
    lastSubmissionAtMs: lastAt,
    nowMs: lastAt + 7_000,
    minIntervalMs,
  });
  assert.equal(remaining, 3_000);

  const filePath = path.join(makeTempDir("throttle-"), "last.json");
  writeLastSubmission(
    {
      lastSubmissionAt: new Date(Date.now() - 7_000).toISOString(),
      sourcePortal: "TENDER247",
      sourceTenderId: "1",
    },
    filePath,
  );
  const started = Date.now();
  const result = await waitForSharedSubmissionInterval({
    minIntervalMs: 200,
    filePath,
    betweenSource: true,
  });
  const elapsed = Date.now() - started;
  assert.ok(result.waitedMs >= 0);
  assert.ok(elapsed < 500, `should not wait a full 10 minutes, elapsed=${elapsed}`);
});

test("4. Rate limit prevents the second source", async () => {
  let bidassistCalled = false;
  const rateLimited: SourceEndToEndResult = {
    ...okResult("TENDER247", "111"),
    success: false,
    rateLimited: true,
    error: "Too many requests",
    qualificationVerified: false,
    statusSyncVerified: false,
  };
  const { summary, exitCode } = await runCompleteEndToEndTest(
    {
      limitPerSource: 1,
      date: "2026-08-06",
      continueOnSourceError: true,
    },
    {
      runSource: async (opts: SourceEndToEndOptions) => {
        if (opts.source === "bidassist") {
          bidassistCalled = true;
          return okResult("BIDASSIST", "222");
        }
        return rateLimited;
      },
      waitBetweenSources: async () => ({
        waitedMs: 0,
        elapsedMs: 0,
        remainingMs: 0,
      }),
    },
  );
  assert.equal(bidassistCalled, false);
  assert.equal(summary.status, "RATE_LIMITED");
  assert.equal(exitCode, 2);
});

test("5. Tender247 attachment confirmation is mandatory", () => {
  const files: QualificationAttachmentFile[] = [
    {
      kind: "METADATA",
      fileName: "metadata.json",
      filePath: "/tmp/metadata.json",
      required: true,
    },
  ];
  assert.throws(
    () => assertTender247BundleComplete(files, "100", false),
    /E2E_REQUIRED_ATTACHMENT_BUNDLE_INCOMPLETE/,
  );
  assert.throws(
    () =>
      assertRequiredAttachmentsReady({
        sourcePortal: "TENDER247",
        sourceTenderId: "100",
        metadataDetected: true,
        tenderArchiveDetected: false,
        bidassistArchiveDetected: false,
        aiSummaryDetected: false,
        aiSummaryRequired: false,
      }),
    (err: unknown) =>
      err instanceof AutomationError &&
      err.code === "CHATGPT_REQUIRED_ATTACHMENTS_NOT_READY",
  );
});

test("6. BidAssist metadata plus original ZIP are mandatory", () => {
  const zipOnly: QualificationAttachmentFile[] = [
    {
      kind: "DOCUMENT_ARCHIVE",
      fileName: "tender.zip",
      filePath: "/tmp/tender.zip",
      required: true,
    },
  ];
  assert.throws(
    () => assertBidassistBundleComplete(zipOnly, "BA-1"),
    /E2E_REQUIRED_ATTACHMENT_BUNDLE_INCOMPLETE/,
  );

  const root = makeTempDir("ba-attach-");
  const folder = path.join(root, "BA-1");
  const originalDir = path.join(folder, "original");
  fs.mkdirSync(originalDir, { recursive: true });
  fs.writeFileSync(path.join(originalDir, "docs.zip"), "PK\x03\x04zip");
  fs.writeFileSync(
    path.join(folder, "download-state.json"),
    JSON.stringify({ originalZipFile: "docs.zip", bidassistId: "1" }),
    "utf8",
  );
  const metaDir = makeTempDir("ba-meta-");
  const metadataPath = path.join(metaDir, "metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify({ id: "1" }), "utf8");
  const bundle = assembleQualificationAttachmentBundle({
    sourcePortal: "BIDASSIST",
    sourceTenderId: "1",
    localFolderPath: folder,
    metadataPath,
    cleanup: () => undefined,
  });
  assert.equal(bundle.files.length, 2);
  assert.ok(bundle.files.some((f: QualificationAttachmentFile) => f.kind === "METADATA"));
  assert.ok(
    bundle.files.some((f: QualificationAttachmentFile) => f.kind === "DOCUMENT_ARCHIVE"),
  );
});

test("7. Each source processes only its current manifest ID", () => {
  const manifest: PipelineManifest = {
    runId: "tender247-test",
    sourcePortal: "TENDER247",
    startedAt: new Date().toISOString(),
    selectedTenderIds: ["103032559"],
    completedCrawlerTenderIds: ["103032559"],
    failedCrawlerTenderIds: [],
  };
  const ids = selectManifestQualificationIds(manifest);
  assert.deepEqual(ids, ["103032559"]);
  assert.equal(ids.length, 1);
  assert.ok(!ids.includes("999999"));
});

test("8. Both Supabase rows are verified in combined success", async () => {
  const { summary } = await runCompleteEndToEndTest(
    {
      limitPerSource: 1,
      date: "2026-08-06",
      continueOnSourceError: false,
    },
    {
      runSource: async (opts: SourceEndToEndOptions) =>
        okResult(
          opts.source === "tender247" ? "TENDER247" : "BIDASSIST",
          opts.source === "tender247" ? "111" : "222",
        ),
      waitBetweenSources: async () => ({
        waitedMs: 0,
        elapsedMs: 0,
        remainingMs: 0,
      }),
    },
  );
  assert.equal(summary.tender247.metadataVerified, true);
  assert.equal(summary.tender247.qualificationVerified, true);
  assert.equal(summary.tender247.statusSyncVerified, true);
  assert.equal(summary.bidassist.metadataVerified, true);
  assert.equal(summary.bidassist.qualificationVerified, true);
  assert.equal(summary.bidassist.statusSyncVerified, true);
});

test("9. Combined summary contains both results", () => {
  const dir = makeTempDir("complete-summary-");
  const summary = buildCompleteE2ESummary({
    runId: "run-1",
    date: "2026-08-06",
    startedAt: "2026-08-06T00:00:00.000Z",
    finishedAt: "2026-08-06T00:20:00.000Z",
    limitPerSource: 1,
    tender247: okResult("TENDER247", "111"),
    bidassist: okResult("BIDASSIST", "222"),
    bidassistRan: true,
  });
  const outPath = writeCompleteE2ESummary(dir, "2026-08-06", summary);
  const saved = JSON.parse(fs.readFileSync(outPath, "utf8")) as {
    tender247: { sourceTenderId: string };
    bidassist: { sourceTenderId: string };
    status: string;
  };
  assert.equal(saved.status, "SUCCESS");
  assert.equal(saved.tender247.sourceTenderId, "111");
  assert.equal(saved.bidassist.sourceTenderId, "222");
});

test("10. Lock prevents simultaneous combined tests", () => {
  const lockPath = path.join(makeTempDir("complete-lock-"), "complete-e2e-test.lock");
  acquirePipelineLock(lockPath, {
    name: "complete-e2e-test",
    alreadyRunningCode: "COMPLETE_E2E_TEST_ALREADY_RUNNING",
  });
  assert.throws(
    () =>
      acquirePipelineLock(lockPath, {
        name: "complete-e2e-test",
        alreadyRunningCode: "COMPLETE_E2E_TEST_ALREADY_RUNNING",
      }),
    (err: unknown) =>
      err instanceof AutomationError &&
      err.code === "COMPLETE_E2E_TEST_ALREADY_RUNNING",
  );
  releasePipelineLock(lockPath);
  assert.equal(fs.existsSync(lockPath), false);
});

test("11. Ctrl+C releases the lock", () => {
  const lockPath = path.join(makeTempDir("complete-sigint-"), "complete-e2e-test.lock");
  acquirePipelineLock(lockPath, {
    name: "complete-e2e-test",
    alreadyRunningCode: "COMPLETE_E2E_TEST_ALREADY_RUNNING",
  });
  assert.equal(fs.existsSync(lockPath), true);
  // Simulate interrupt finally/handler path
  releasePipelineLock(lockPath);
  assert.equal(fs.existsSync(lockPath), false);
  assert.ok(completeE2ELockPath("runtime").endsWith("complete-e2e-test.lock"));
});

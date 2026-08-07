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
  deriveCompleteStatus,
  formatCompleteE2EConsoleSummary,
  parseCompleteE2EArgs,
  runCompleteEndToEndTest,
  shouldRunBidassistAfterTender247,
  writeCompleteE2ESummary,
  completeE2ELockPath,
} from "../runCompleteEndToEndTest.js";
import type {
  SourceEndToEndOptions,
  SourceEndToEndPrescreenStats,
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

function defaultStats(
  overrides: Partial<SourceEndToEndPrescreenStats> = {},
): SourceEndToEndPrescreenStats {
  return {
    candidatesCrawled: 1,
    metadataVerifiedCount: 1,
    prescreenRejected: 0,
    prescreenManualReview: 0,
    prescreenPassed: 1,
    chatgptRequestsAvoided: 0,
    crawlMaxPerSource: 5,
    chatgptMaxPerSource: 1,
    ...overrides,
  };
}

function okResult(
  source: "TENDER247" | "BIDASSIST",
  id: string,
): SourceEndToEndResult {
  return {
    source,
    success: true,
    outcome: "SUCCESS",
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
    stats: defaultStats(),
  };
}

function failedResult(
  source: "TENDER247" | "BIDASSIST",
  error: string,
): SourceEndToEndResult {
  return {
    ...okResult(source, "0"),
    success: false,
    outcome: "FAILED",
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
    stats: defaultStats({
      candidatesCrawled: 0,
      metadataVerifiedCount: 0,
      prescreenPassed: 0,
    }),
  };
}

function noEligibleResult(
  source: "TENDER247" | "BIDASSIST",
  stats?: Partial<SourceEndToEndPrescreenStats>,
): SourceEndToEndResult {
  return {
    ...okResult(source, "0"),
    success: false,
    outcome: "NO_ELIGIBLE_TEST_TENDER",
    sourceTenderId: null,
    folderId: null,
    attachmentsConfirmed: false,
    promptSubmitted: false,
    responseCompleted: false,
    qualificationStatus: null,
    qualificationVerified: false,
    statusSyncVerified: false,
    chatUrl: null,
    error: null,
    metadataVerified: true,
    stats: defaultStats({
      candidatesCrawled: 5,
      metadataVerifiedCount: 5,
      prescreenRejected: 4,
      prescreenManualReview: 1,
      prescreenPassed: 0,
      chatgptRequestsAvoided: 5,
      ...stats,
    }),
  };
}

const defaultCompleteOpts = {
  crawlMaxPerSource: 5,
  chatgptMaxPerSource: 1,
  requireChatgptPath: true,
  date: "2026-08-06",
  continueOnSourceError: false,
};

test("12. ChatGPT max greater than one is rejected", () => {
  assert.throws(
    () => parseCompleteE2EArgs(["--chatgpt-max-per-source=2"]),
    /COMPLETE_E2E_TEST_CHATGPT_MAX_MUST_BE_ONE/,
  );
  assert.throws(
    () => parseCompleteE2EArgs(["--limit-per-source=2"]),
    /COMPLETE_E2E_TEST_CHATGPT_MAX_MUST_BE_ONE/,
  );
});

test("parseCompleteE2EArgs reads crawl/ChatGPT max flags", () => {
  const opts = parseCompleteE2EArgs([
    "--crawl-max-per-source=5",
    "--chatgpt-max-per-source=1",
    "--require-chatgpt-path=true",
    "--date=2026-08-06",
  ]);
  assert.equal(opts.crawlMaxPerSource, 5);
  assert.equal(opts.chatgptMaxPerSource, 1);
  assert.equal(opts.requireChatgptPath, true);
});

test("1. Tender247 completes before BidAssist begins", async () => {
  const order: string[] = [];
  const { summary, exitCode } = await runCompleteEndToEndTest(
    { ...defaultCompleteOpts },
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

test("2. Tender247 technical failure prevents BidAssist by default", async () => {
  let bidassistCalled = false;
  const { summary, exitCode } = await runCompleteEndToEndTest(
    { ...defaultCompleteOpts },
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
    outcome: "RATE_LIMITED",
    rateLimited: true,
    error: "Too many requests",
    qualificationVerified: false,
    statusSyncVerified: false,
  };
  const { summary, exitCode } = await runCompleteEndToEndTest(
    { ...defaultCompleteOpts, continueOnSourceError: true },
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
    { ...defaultCompleteOpts },
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
    crawlMaxPerSource: 5,
    chatgptMaxPerSource: 1,
    requireChatgptPath: true,
    tender247: okResult("TENDER247", "111"),
    bidassist: okResult("BIDASSIST", "222"),
    bidassistRan: true,
  });
  const outPath = writeCompleteE2ESummary(dir, "2026-08-06", summary);
  const saved = JSON.parse(fs.readFileSync(outPath, "utf8")) as {
    tender247: { sourceTenderId: string };
    bidassist: { sourceTenderId: string };
    status: string;
    crawlMaxPerSource: number;
    chatgptMaxPerSource: number;
  };
  assert.equal(saved.status, "SUCCESS");
  assert.equal(saved.tender247.sourceTenderId, "111");
  assert.equal(saved.bidassist.sourceTenderId, "222");
  assert.equal(saved.crawlMaxPerSource, 5);
  assert.equal(saved.chatgptMaxPerSource, 1);
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
  releasePipelineLock(lockPath);
  assert.equal(fs.existsSync(lockPath), false);
  assert.ok(completeE2ELockPath("runtime").endsWith("complete-e2e-test.lock"));
});

test("13. Five rejected Tender247 candidates → NO_ELIGIBLE_TEST_TENDER not FAILED", () => {
  const t247 = noEligibleResult("TENDER247");
  assert.equal(t247.outcome, "NO_ELIGIBLE_TEST_TENDER");
  assert.notEqual(t247.outcome, "FAILED");
  assert.equal(t247.stats.prescreenPassed, 0);
  assert.equal(t247.stats.candidatesCrawled, 5);
  assert.equal(
    shouldRunBidassistAfterTender247({
      tender247: t247,
      continueOnSourceError: false,
    }).run,
    true,
  );
});

test("14. NO_ELIGIBLE_TEST_TENDER from Tender247 does not skip BidAssist", async () => {
  let bidassistCalled = false;
  const { summary, exitCode } = await runCompleteEndToEndTest(
    { ...defaultCompleteOpts },
    {
      runSource: async (opts: SourceEndToEndOptions) => {
        if (opts.source === "bidassist") {
          bidassistCalled = true;
          return okResult("BIDASSIST", "222");
        }
        return noEligibleResult("TENDER247");
      },
      waitBetweenSources: async () => ({
        waitedMs: 0,
        elapsedMs: 0,
        remainingMs: 0,
      }),
    },
  );
  assert.equal(bidassistCalled, true);
  assert.equal(summary.bidassist.ran, true);
  assert.equal(summary.tender247.outcome, "NO_ELIGIBLE_TEST_TENDER");
  assert.equal(summary.status, "PARTIAL_SUCCESS");
  assert.equal(exitCode, 0);
  assert.equal(
    shouldRunBidassistAfterTender247({
      tender247: noEligibleResult("TENDER247"),
      continueOnSourceError: false,
    }).reason,
    "tender247_no_eligible_test_tender",
  );
});

test("15. Tender247 technical crawler failure may produce FAILED", async () => {
  const { summary, exitCode } = await runCompleteEndToEndTest(
    { ...defaultCompleteOpts },
    {
      runSource: async (opts: SourceEndToEndOptions) => {
        if (opts.source === "bidassist") {
          return okResult("BIDASSIST", "222");
        }
        return failedResult("TENDER247", "Tender247 crawler exited with code 1");
      },
      waitBetweenSources: async () => ({
        waitedMs: 0,
        elapsedMs: 0,
        remainingMs: 0,
      }),
    },
  );
  assert.equal(summary.tender247.outcome, "FAILED");
  assert.equal(summary.bidassist.ran, false);
  assert.equal(summary.status, "FAILED");
  assert.equal(exitCode, 1);
});

test("16. BidAssist still executes after Tender247 has no eligible tender", async () => {
  const order: string[] = [];
  const { summary } = await runCompleteEndToEndTest(
    { ...defaultCompleteOpts },
    {
      runSource: async (opts: SourceEndToEndOptions) => {
        order.push(opts.source);
        assert.equal(opts.crawlMax, 5);
        assert.equal(opts.limit, 1);
        if (opts.source === "tender247") {
          return noEligibleResult("TENDER247");
        }
        return noEligibleResult("BIDASSIST", {
          candidatesCrawled: 5,
          metadataVerifiedCount: 5,
          prescreenRejected: 5,
          prescreenManualReview: 0,
          chatgptRequestsAvoided: 5,
        });
      },
      waitBetweenSources: async () => ({
        waitedMs: 0,
        elapsedMs: 0,
        remainingMs: 0,
      }),
    },
  );
  assert.deepEqual(order, ["tender247", "bidassist"]);
  assert.equal(summary.bidassist.ran, true);
  assert.equal(summary.bidassist.outcome, "NO_ELIGIBLE_TEST_TENDER");
});

test("17. Both sources having no eligible tender → overall NO_ELIGIBLE_TEST_TENDER", () => {
  const status = deriveCompleteStatus({
    tender247: noEligibleResult("TENDER247"),
    bidassist: noEligibleResult("BIDASSIST"),
    bidassistRan: true,
  });
  assert.equal(status, "NO_ELIGIBLE_TEST_TENDER");

  const mixed = deriveCompleteStatus({
    tender247: noEligibleResult("TENDER247"),
    bidassist: okResult("BIDASSIST", "9"),
    bidassistRan: true,
  });
  assert.equal(mixed, "PARTIAL_SUCCESS");
});

test("18. Summary uses crawlMaxPerSource and chatgptMaxPerSource correctly", () => {
  const summary = buildCompleteE2ESummary({
    runId: "run-2",
    date: "2026-08-06",
    startedAt: "2026-08-06T00:00:00.000Z",
    finishedAt: "2026-08-06T00:20:00.000Z",
    crawlMaxPerSource: 5,
    chatgptMaxPerSource: 1,
    requireChatgptPath: true,
    tender247: noEligibleResult("TENDER247"),
    bidassist: okResult("BIDASSIST", "222"),
    bidassistRan: true,
  });
  const text = formatCompleteE2EConsoleSummary(summary, "/tmp/summary.json");
  assert.match(text, /Crawl max per source: 5/);
  assert.match(text, /ChatGPT max per source: 1/);
  assert.match(text, /Require ChatGPT path: YES/);
  assert.doesNotMatch(text, /Limit per source/);
  assert.match(text, /Candidates crawled: 5/);
  assert.match(text, /Prescreen rejected: 4/);
  assert.match(text, /Manual review: 1/);
  assert.match(text, /Prescreen passed: 0/);
  assert.match(text, /ChatGPT requests avoided: 5/);
  assert.match(text, /ChatGPT candidate: NONE/);
  assert.match(text, /Source outcome: NO_ELIGIBLE_TEST_TENDER/);
  assert.match(text, /Overall: PARTIAL_SUCCESS/);
  assert.equal(summary.crawlMaxPerSource, 5);
  assert.equal(summary.chatgptMaxPerSource, 1);
});

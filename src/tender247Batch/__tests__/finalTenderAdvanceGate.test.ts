/**
 * Authoritative pre-next-tender filesystem gate.
 * Tender B must not start until Tender A is complete or pending-timeout.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ensureCanonicalTenderArchive } from "../canonicalTenderArchive.js";
import {
  runFinalTenderAdvanceGate,
} from "../finalTenderAdvanceGate.js";
import { runSequentialArtifactAcquisition } from "../runSequentialArtifactAcquisition.js";
import {
  discoverIncompleteTenders,
  inspectTenderArtifactState,
  writeMinimalValidAiSummaryPdf,
} from "../tenderArtifactState.js";
import {
  emptyRecoveryReport,
  recordRecoveryItem,
} from "../tender247RecoveryReport.js";

function writeMetadata(tenderDir: string, t247Id: string): void {
  fs.mkdirSync(tenderDir, { recursive: true });
  fs.writeFileSync(
    path.join(tenderDir, "metadata.json"),
    JSON.stringify({
      t247Id,
      sourceTenderId: t247Id,
      normalized: { tenderName: "fixture" },
      raw: { a: 1 },
    }),
  );
}

async function writeDocumentsZip(tenderDir: string, t247Id: string): Promise<void> {
  const documentsDir = path.join(tenderDir, "documents");
  fs.mkdirSync(documentsDir, { recursive: true });
  fs.writeFileSync(path.join(documentsDir, "NIT.pdf"), "%PDF-1.4 nit-doc\n");
  await ensureCanonicalTenderArchive({
    tenderDir,
    documentsDir,
    sourceTenderId: t247Id,
  });
}

describe("inspectTenderArtifactState is the single completeness definition", () => {
  it("requires metadata + valid AI PDF + valid documents ZIP", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t247-inspect-"));
    const tenderDir = path.join(root, "T247-103383747");
    writeMetadata(tenderDir, "103383747");
    writeMinimalValidAiSummaryPdf(path.join(tenderDir, "AI_Summary.pdf"));
    let state = inspectTenderArtifactState(tenderDir, "103383747");
    assert.equal(state.metadataValid, true);
    assert.equal(state.aiSummaryValid, true);
    assert.equal(state.documentsZipValid, false);
    assert.equal(state.complete, false);

    await writeDocumentsZip(tenderDir, "103383747");
    state = inspectTenderArtifactState(tenderDir, "103383747");
    assert.equal(state.documentsZipValid, true);
    assert.equal(state.complete, true);
    assert.equal(state.ready, true);
  });

  it("rejects a tiny or non-PDF AI_Summary.pdf", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t247-ai-"));
    const tenderDir = path.join(root, "T247-1");
    fs.mkdirSync(tenderDir, { recursive: true });
    fs.writeFileSync(path.join(tenderDir, "AI_Summary.pdf"), "%PDF-1.4 ai");
    assert.equal(inspectTenderArtifactState(tenderDir, "1").aiSummaryValid, false);
    fs.writeFileSync(path.join(tenderDir, "AI_Summary.pdf"), "<html>error</html>" + "x".repeat(120));
    assert.equal(inspectTenderArtifactState(tenderDir, "1").aiSummaryValid, false);
  });

  it("rediscover incomplete folders even when crawl-manifest says completed", async () => {
    const dateFolder = fs.mkdtempSync(path.join(os.tmpdir(), "t247-resume-scan-"));
    const incompleteDir = path.join(dateFolder, "T247-103436077");
    const completeDir = path.join(dateFolder, "T247-103383747");
    writeMetadata(incompleteDir, "103436077");
    writeMinimalValidAiSummaryPdf(path.join(incompleteDir, "AI_Summary.pdf"));
    fs.writeFileSync(path.join(dateFolder, "T247-103436077.zip"), "outer-zip-is-not-enough");
    fs.writeFileSync(
      path.join(dateFolder, "crawl-manifest.json"),
      JSON.stringify({
        date: "2026-08-17",
        tenders: {
          "103436077": { status: "completed", zipPath: "T247-103436077.zip" },
        },
      }),
    );

    writeMetadata(completeDir, "103383747");
    writeMinimalValidAiSummaryPdf(path.join(completeDir, "AI_Summary.pdf"));
    await writeDocumentsZip(completeDir, "103383747");

    const incomplete = discoverIncompleteTenders(dateFolder);
    assert.ok(incomplete.includes("103436077"));
    assert.equal(incomplete.includes("103383747"), false);
  });
});

describe("final pre-next-tender gate", () => {
  it("does not open Tender B while Tender A's canonical ZIP is missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t247-gate-zip-"));
    const tenderA = path.join(root, "T247-A");
    writeMetadata(tenderA, "A");
    writeMinimalValidAiSummaryPdf(path.join(tenderA, "AI_Summary.pdf"));

    const opened: string[] = [];
    let now = 0;
    await runSequentialArtifactAcquisition({
      candidates: ["A", "B"],
      getId: (id) => id,
      process: async (id) => {
        opened.push(`${id}_OPEN`);
        if (id === "B") {
          const aState = inspectTenderArtifactState(tenderA, "A");
          assert.equal(aState.complete, true, "Tender B must not open before A is complete");
          return { complete: true, safeToAdvance: true, evidenceMode: "FULL" };
        }
        const gate = await runFinalTenderAdvanceGate({
          tenderDir: tenderA,
          t247Id: "A",
          logger: { info: () => undefined },
          recoveryBudgetMs: 20_000,
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
          retryDelayMs: 1_000,
          retryDocuments: async () => {
            if (now >= 3_000) {
              await writeDocumentsZip(tenderA, "A");
            }
          },
        });
        assert.equal(gate.ready, true);
        assert.equal(gate.state.complete, true);
        opened.push("A_FINAL_GATE=PASS");
        return { complete: true, safeToAdvance: true, evidenceMode: "FULL" };
      },
    });

    assert.deepEqual(opened, ["A_OPEN", "A_FINAL_GATE=PASS", "B_OPEN"]);
  });

  it("does not open Tender B during a delayed 15s AI save (fake clock)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t247-gate-ai-"));
    const tenderA = path.join(root, "T247-A");
    writeMetadata(tenderA, "A");
    await writeDocumentsZip(tenderA, "A");

    const opened: string[] = [];
    let now = 0;
    await runSequentialArtifactAcquisition({
      candidates: ["A", "B"],
      getId: (id) => id,
      process: async (id) => {
        opened.push(`${id}_OPEN`);
        if (id === "B") {
          assert.ok(now >= 15_000, "B opened before the delayed AI was valid");
          return { complete: true, safeToAdvance: true, evidenceMode: "FULL" };
        }
        const gate = await runFinalTenderAdvanceGate({
          tenderDir: tenderA,
          t247Id: "A",
          logger: { info: () => undefined },
          recoveryBudgetMs: 60_000,
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
          retryDelayMs: 1_500,
          retryAi: async () => {
            if (now >= 15_000) {
              writeMinimalValidAiSummaryPdf(path.join(tenderA, "AI_Summary.pdf"));
            }
          },
        });
        assert.equal(gate.ready, true);
        assert.ok(now >= 15_000);
        return { complete: true, safeToAdvance: true, evidenceMode: "FULL" };
      },
    });
    assert.equal(opened[0], "A_OPEN");
    assert.equal(opened.includes("B_OPEN"), true);
    assert.ok(opened.indexOf("A_OPEN") < opened.indexOf("B_OPEN"));
  });

  it("blocks advance before the deadline and allows PENDING_TIMEOUT_AI after it (fake clock)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t247-gate-timeout-"));
    const tenderDir = path.join(root, "T247-103436077");
    writeMetadata(tenderDir, "103436077");
    await writeDocumentsZip(tenderDir, "103436077");

    const mid = inspectTenderArtifactState(tenderDir, "103436077");
    assert.equal(mid.aiSummaryValid, false);
    assert.equal(mid.complete, false);

    let now = 0;
    const logs: string[] = [];
    const gate = await runFinalTenderAdvanceGate({
      tenderDir,
      t247Id: "103436077",
      logger: { info: (m) => logs.push(m) },
      recoveryBudgetMs: 5 * 60 * 1000,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      retryDelayMs: 30_000,
      retryAi: async () => undefined,
    });

    assert.equal(gate.ready, false);
    assert.equal(gate.pendingTimeout, true);
    assert.equal(gate.pendingReason, "PENDING_TIMEOUT_AI");
    assert.equal(gate.safeToAdvance, true);
    assert.ok(now >= 5 * 60 * 1000);
    assert.ok(logs.some((l) => l.includes("SAFE_TO_ADVANCE_BY_TIMEOUT_EXCEPTION=true")));
    assert.equal(inspectTenderArtifactState(tenderDir, "103436077").complete, false);

    await runSequentialArtifactAcquisition({
      candidates: ["103436077", "NEXT"],
      getId: (id) => id,
      process: async (id) => {
        if (id === "103436077") {
          return { pendingTimeout: true, safeToAdvance: true, evidenceMode: "PARTIAL" };
        }
        return { complete: true, safeToAdvance: true, evidenceMode: "FULL" };
      },
    });
  });

  it("refuses to start the next tender when the previous result is non-terminal", async () => {
    await assert.rejects(
      () =>
        runSequentialArtifactAcquisition({
          candidates: ["A", "B"],
          getId: (id) => id,
          process: async (id) => {
            if (id === "A") {
              return { evidenceMode: "PARTIAL", metadataOk: true };
            }
            throw new Error("B_MUST_NOT_OPEN");
          },
        }),
      /T247_PREVIOUS_TENDER_NOT_TERMINAL: A/,
    );
  });

  it("records pending vs recovered in the recovery report", () => {
    const report = emptyRecoveryReport();
    const completeState = {
      tenderDir: "x",
      t247Id: "1",
      metadataPath: "m",
      aiSummaryPath: "a",
      documentsZipPath: "d",
      metadataValid: true,
      aiSummaryValid: true,
      documentsZipValid: true,
      complete: true,
      ready: true,
      missing: [],
    };
    const pendingState = {
      ...completeState,
      t247Id: "2",
      aiSummaryValid: false,
      complete: false,
      ready: false,
      missing: ["aiSummary" as const],
    };
    recordRecoveryItem(report, "103383747", completeState, "recovered");
    recordRecoveryItem(
      report,
      "103436077",
      pendingState,
      "pending_timeout",
      "AI_Summary.pdf not obtained within 5-minute recovery budget",
    );
    assert.equal(report.recovered, 1);
    assert.equal(report.pendingTimeout, 1);
    assert.equal(report.items["103436077"]?.status, "pending_timeout");
    assert.equal(report.items["103383747"]?.status, "recovered");
  });
});

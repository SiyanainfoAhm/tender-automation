import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  appendDetailSubmission,
  evaluateDetailRateSlot,
  pruneActiveSubmissions,
  recordDetailSubmission,
  type DetailSubmissionLedgerEntry,
} from "../chatgptDetailSubmissionLedger.js";

describe("chatgpt detail rolling 65/3h ledger", () => {
  let tmpDir = "";
  let ledgerPath = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detail-ledger-"));
    ledgerPath = path.join(tmpDir, "detail-submission-ledger.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("allows immediate send when used < 65", () => {
    const submissions: DetailSubmissionLedgerEntry[] = Array.from(
      { length: 64 },
      (_, i) => ({
        tenderId: String(1000 + i),
        submittedAt: new Date(1_000_000 + i * 1000).toISOString(),
        mode: "TEXT_MODE" as const,
      }),
    );
    const decision = evaluateDetailRateSlot({
      submissions,
      nowMs: 1_000_000 + 64_000,
      config: {
        maxSubmissions: 65,
        windowMs: 3 * 60 * 60 * 1000,
        safetyBufferMs: 60_000,
      },
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.used, 64);
    assert.equal(decision.available, 1);
  });

  it("waits when 65 active timestamps are inside the window", () => {
    const windowMs = 3 * 60 * 60 * 1000;
    const nowMs = 10_000_000;
    const oldest = nowMs - windowMs + 60_000;
    const submissions: DetailSubmissionLedgerEntry[] = Array.from(
      { length: 65 },
      (_, i) => ({
        tenderId: String(2000 + i),
        submittedAt: new Date(oldest + i * 1000).toISOString(),
        mode: "UPLOAD" as const,
      }),
    );
    const decision = evaluateDetailRateSlot({
      submissions,
      nowMs,
      config: {
        maxSubmissions: 65,
        windowMs,
        safetyBufferMs: 60_000,
      },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.used, 65);
    assert.ok((decision.waitMs ?? 0) > 0);
    assert.ok(decision.nextSlotAt);
  });

  it("prunes timestamps older than the rolling window", () => {
    const windowMs = 3 * 60 * 60 * 1000;
    const nowMs = 10_000_000;
    const submissions: DetailSubmissionLedgerEntry[] = [
      {
        tenderId: "1",
        submittedAt: new Date(nowMs - windowMs - 1).toISOString(),
        mode: "TEXT_MODE",
      },
      {
        tenderId: "2",
        submittedAt: new Date(nowMs - 1_000).toISOString(),
        mode: "TEXT_MODE",
      },
    ];
    const active = pruneActiveSubmissions(submissions, nowMs, windowMs);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.tenderId, "2");
  });

  it("persists submissions across restart and still sees 65 used", () => {
    const windowMs = 3 * 60 * 60 * 1000;
    const now = Date.now();
    const seeded = {
      submissions: Array.from({ length: 65 }, (_, i) => ({
        tenderId: String(3000 + i),
        submittedAt: new Date(now - i * 1000).toISOString(),
        mode: "TEXT_MODE" as const,
      })),
    };
    fs.writeFileSync(ledgerPath, JSON.stringify(seeded, null, 2), "utf8");
    const raw = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as {
      submissions: DetailSubmissionLedgerEntry[];
    };
    const decision = evaluateDetailRateSlot({
      submissions: raw.submissions,
      nowMs: now,
      config: {
        maxSubmissions: 65,
        windowMs,
        safetyBufferMs: 60_000,
      },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.used, 65);
    assert.equal(decision.available, 0);
  });

  it("records only after explicit recordDetailSubmission", async () => {
    const decision = await recordDetailSubmission({
      tenderId: "T247-999001",
      mode: "TEXT_MODE",
      ledgerPath,
      config: {
        maxSubmissions: 65,
        windowMs: 3 * 60 * 60 * 1000,
        safetyBufferMs: 60_000,
      },
    });
    assert.equal(decision.used, 1);
    const raw = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as {
      submissions: DetailSubmissionLedgerEntry[];
    };
    assert.equal(raw.submissions.length, 1);
    assert.equal(raw.submissions[0]!.tenderId, "999001");
  });

  it("appendDetailSubmission keeps rolling prune", () => {
    const windowMs = 1000;
    const ledger = { submissions: [] as DetailSubmissionLedgerEntry[] };
    const next = appendDetailSubmission(
      ledger,
      {
        tenderId: "1",
        submittedAt: new Date(1000).toISOString(),
        mode: "TEXT_MODE",
      },
      5000,
      windowMs,
    );
    assert.equal(next.submissions.length, 0);
  });
});

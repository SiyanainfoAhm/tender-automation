/**
 * Canonical JSON completion must not wait on sticky Stop or 5-minute stall.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import crypto from "node:crypto";
import {
  createJsonStabilityState,
  tickCanonicalJsonStability,
  tryParseCanonicalQualificationJson,
  REQUIRED_JSON_STABLE_POLLS,
} from "../canonicalJsonCompletion.js";
import {
  updateLastResponseActivityAt,
  isResponseActivityStalled,
  type ResponseActivitySnapshot,
} from "../responseWaitPolicy.js";

const COMPLETE_JSON = `{
  "t247Id": "103232437",
  "status": "VERIFY",
  "manualReviewRequired": true,
  "confidence": 99
}`;

function hash(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);
}

function snap(
  partial: Partial<ResponseActivitySnapshot>,
): ResponseActivitySnapshot {
  return {
    assistantCount: 1,
    textLength: 10,
    textFingerprint: "abc",
    active: false,
    generationLabel: "idle",
    stopVisible: false,
    ...partial,
  };
}

describe("canonical JSON response completion", () => {
  it("parses complete qualification JSON with status + tender id", () => {
    const parsed = tryParseCanonicalQualificationJson(
      COMPLETE_JSON,
      "103232437",
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.status, "VERIFY");
    }
  });

  it("completes after 3 stable polls + 5s grace even if Stop stays visible 60s", () => {
    const textHash = hash(COMPLETE_JSON);
    let state = createJsonStabilityState();
    let completedAt: number | null = null;

    // Simulate: JSON complete at t=0, unchanged for 10s, Stop visible for 60s.
    for (let t = 0; t <= 60_000; t += 1_000) {
      const tick = tickCanonicalJsonStability({
        text: COMPLETE_JSON,
        textHash,
        expectedT247Id: "103232437",
        previous: state,
        nowMs: t,
        stopStillVisible: true,
        postJsonUiGraceMs: 5_000,
        requiredStablePolls: REQUIRED_JSON_STABLE_POLLS,
      });
      state = tick.state;

      if (tick.shouldComplete) {
        completedAt = t;
        assert.equal(tick.stable, true);
        assert.equal(tick.ignoreStaleStop, true);
        break;
      }
    }

    assert.ok(completedAt != null, "must complete while Stop still visible");
    // 3 polls at t=0,1000,2000 → stable at poll 3 (t=2000), then +5s grace → ~7000
    assert.ok(
      completedAt! <= 10_000,
      `must complete within ~10s, got ${completedAt}ms`,
    );
    assert.ok(
      completedAt! >= 5_000,
      `grace should apply when Stop stuck, got ${completedAt}ms`,
    );
    // Must NOT wait 5 minutes
    assert.ok(completedAt! < 300_000);
  });

  it("sticky Stop alone does not reset lastResponseActivityAt", () => {
    const base = snap({
      textLength: COMPLETE_JSON.length,
      textFingerprint: hash(COMPLETE_JSON),
      active: true,
      stopVisible: true,
      generationLabel: "stop",
    });
    let last = 1_000;
    for (let t = 2_000; t <= 20_000; t += 1_000) {
      const updated = updateLastResponseActivityAt({
        previous: base,
        next: { ...base },
        lastActivityAtMs: last,
        nowMs: t,
      });
      assert.equal(updated.changed, false);
      assert.equal(updated.lastActivityAtMs, 1_000);
      last = updated.lastActivityAtMs;
    }
    // Stall clock advances — sticky Stop does not keep us forever "active"
    assert.equal(
      isResponseActivityStalled({
        lastActivityAtMs: last,
        nowMs: last + 300_000,
        stallMs: 300_000,
        currentlyActive: false,
        ignoreStickyActive: true,
      }),
      true,
    );
  });

  it("text growth still counts as activity while generating", () => {
    let previous = snap({
      textLength: 10,
      textFingerprint: "a",
      active: true,
      generationLabel: "thinking",
    });
    let last = 0;
    for (let t = 60_000; t <= 7 * 60_000; t += 60_000) {
      const next = snap({
        textLength: 10 + t / 1000,
        textFingerprint: `fp-${t}`,
        active: true,
        generationLabel: "thinking",
      });
      const updated = updateLastResponseActivityAt({
        previous,
        next,
        lastActivityAtMs: last,
        nowMs: t,
      });
      assert.equal(updated.changed, true);
      last = updated.lastActivityAtMs;
      previous = next;
    }
    assert.equal(last, 7 * 60_000);
  });
});

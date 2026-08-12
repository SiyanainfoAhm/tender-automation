import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isResponseActivityStalled,
  mayNavigateAwayDuringResponseWait,
  updateLastResponseActivityAt,
  type ResponseActivitySnapshot,
} from "../responseWaitPolicy.js";

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

describe("ChatGPT response wait policy — no refresh while active", () => {
  it("does not stall while generation is active even after 7 minutes", () => {
    const sendAt = 0;
    const sevenMin = 7 * 60_000;
    const stalled = isResponseActivityStalled({
      lastActivityAtMs: sendAt,
      nowMs: sevenMin,
      stallMs: 300_000,
      currentlyActive: true,
    });
    assert.equal(stalled, false);
    assert.equal(
      mayNavigateAwayDuringResponseWait({
        promptSubmitted: true,
        conversationUrlValid: true,
        responseActive: true,
        responseComplete: false,
        pageBroken: false,
      }),
      false,
    );
  });

  it("activity updates lastResponseActivityAt so slow responses never stall at 5 min", () => {
    let last = 0;
    let previous: ResponseActivitySnapshot | null = null;
    // Simulate 7 minutes of periodic growth (every 60s)
    for (let t = 0; t <= 7 * 60_000; t += 60_000) {
      const next = snap({
        textLength: 100 + t / 1000,
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
      last = updated.lastActivityAtMs;
      previous = next;
      assert.equal(
        isResponseActivityStalled({
          lastActivityAtMs: last,
          nowMs: t,
          stallMs: 300_000,
          currentlyActive: true,
        }),
        false,
      );
    }
    assert.equal(last, 7 * 60_000);
  });

  it("stalls only after 5 minutes with zero activity and no active generation", () => {
    const lastActivity = 1_000_000;
    assert.equal(
      isResponseActivityStalled({
        lastActivityAtMs: lastActivity,
        nowMs: lastActivity + 299_999,
        stallMs: 300_000,
        currentlyActive: false,
      }),
      false,
    );
    assert.equal(
      isResponseActivityStalled({
        lastActivityAtMs: lastActivity,
        nowMs: lastActivity + 300_000,
        stallMs: 300_000,
        currentlyActive: false,
      }),
      true,
    );
  });

  it("forbids page refresh / project reopen during normal submitted wait", () => {
    assert.equal(
      mayNavigateAwayDuringResponseWait({
        promptSubmitted: true,
        conversationUrlValid: true,
        responseActive: false,
        responseComplete: false,
        pageBroken: false,
      }),
      false,
    );
    assert.equal(
      mayNavigateAwayDuringResponseWait({
        promptSubmitted: true,
        conversationUrlValid: true,
        responseActive: false,
        responseComplete: false,
        pageBroken: true,
      }),
      false,
      "even when broken, mid-wait must not project-reopen (reopen exact /c/ only)",
    );
  });

  it("unchanged idle snapshot does not bump activity timestamp", () => {
    const base = snap({ textLength: 50, textFingerprint: "same" });
    const updated = updateLastResponseActivityAt({
      previous: base,
      next: { ...base },
      lastActivityAtMs: 1000,
      nowMs: 5000,
    });
    assert.equal(updated.changed, false);
    assert.equal(updated.lastActivityAtMs, 1000);
  });
});

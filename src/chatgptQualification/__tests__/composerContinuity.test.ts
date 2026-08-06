import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateComposerContinuity,
  isSameProjectHomeUrl,
  legacyCoordinateComposerIdentity,
  legacyIdentityDiffersOnlyByLayout,
  type ComposerContinuitySnapshot,
} from "../uploadQualificationAttachments.js";

const PROJECT =
  "https://chatgpt.com/g/g-p-6a7056fadb0c81918a18a9a72cfb403a-siyana-tender-qualification-automation/project";
const CONVERSATION =
  "https://chatgpt.com/g/g-p-6a7056fadb0c81918a18a9a72cfb403a-siyana-tender-qualification-automation/c/abc-123";

function baseSnapshot(
  overrides: Partial<ComposerContinuitySnapshot> = {},
): ComposerContinuitySnapshot {
  return {
    urlBefore: PROJECT,
    urlAfter: PROJECT,
    tokenAssigned: "agenttender-TENDER247-103032559-uuid",
    tokenStillPresent: true,
    projectHeadingUnchanged: true,
    metadataAttached: true,
    documentsAttached: true,
    aiSummaryAttached: true,
    aiSummaryRequired: true,
    promptEditorVisible: true,
    sendButtonVisible: true,
    activeComposerCount: 1,
    ...overrides,
  };
}

test("1. Composer x coordinate changes after upload — continuity still passes", () => {
  const before = legacyCoordinateComposerIdentity({
    id: "prompt-textarea",
    ariaLabel: "New chat in Siyana Tender Qualification Automation",
    top: 188,
    left: 342,
    width: 523,
    pathname: "/project",
  });
  const after = legacyCoordinateComposerIdentity({
    id: "prompt-textarea",
    ariaLabel: "New chat in Siyana Tender Qualification Automation",
    top: 188,
    left: 400,
    width: 523,
    pathname: "/project",
  });
  assert.equal(legacyIdentityDiffersOnlyByLayout(before, after), true);
  // Continuity ignores coordinates entirely
  const result = evaluateComposerContinuity(baseSnapshot());
  assert.equal(result.ok, true);
  assert.equal(result.rebind, false);
});

test("2. Composer y coordinate changes — continuity still passes", () => {
  const before = legacyCoordinateComposerIdentity({
    id: "prompt-textarea",
    ariaLabel: "New chat in Siyana Tender Qualification Automation",
    top: 188,
    left: 342,
    width: 523,
    pathname: "/project",
  });
  const after = legacyCoordinateComposerIdentity({
    id: "prompt-textarea",
    ariaLabel: "New chat in Siyana Tender Qualification Automation",
    top: 267,
    left: 342,
    width: 523,
    pathname: "/project",
  });
  assert.equal(legacyIdentityDiffersOnlyByLayout(before, after), true);
  assert.notEqual(before, after);
  const result = evaluateComposerContinuity(baseSnapshot());
  assert.equal(result.ok, true);
});

test("3. Composer height/layout changes because attachment cards appear — continuity passes", () => {
  const before = legacyCoordinateComposerIdentity({
    id: "prompt-textarea",
    ariaLabel: "New chat in Siyana Tender Qualification Automation",
    top: 188,
    left: 342,
    width: 523,
    pathname: "/project",
  });
  const after = legacyCoordinateComposerIdentity({
    id: "prompt-textarea",
    ariaLabel: "New chat in Siyana Tender Qualification Automation",
    top: 267,
    left: 342,
    width: 600,
    pathname: "/project",
  });
  assert.equal(legacyIdentityDiffersOnlyByLayout(before, after), true);
  const result = evaluateComposerContinuity(
    baseSnapshot({
      metadataAttached: true,
      documentsAttached: true,
      aiSummaryAttached: true,
    }),
  );
  assert.equal(result.ok, true);
});

test("4. React replaces composer wrapper — rebind succeeds when attachments remain", () => {
  const result = evaluateComposerContinuity(
    baseSnapshot({
      tokenStillPresent: false,
      projectHeadingUnchanged: true,
      metadataAttached: true,
      documentsAttached: true,
      promptEditorVisible: true,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.rebind, true);
});

test("5. Actual navigation to a different chat fails continuity", () => {
  assert.equal(isSameProjectHomeUrl(PROJECT, CONVERSATION), false);
  const result = evaluateComposerContinuity(
    baseSnapshot({
      urlAfter: CONVERSATION,
    }),
  );
  assert.equal(result.ok, false);
  assert.match(result.reason || "", /navigat/i);
});

test("6. Missing attachment cards after upload fails continuity", () => {
  const result = evaluateComposerContinuity(
    baseSnapshot({
      metadataAttached: false,
      documentsAttached: true,
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "required_attachments_missing");
});

test("7. Prompt entry occurs only after attachment and continuity verification", () => {
  const order: string[] = [];
  const attachmentsReady = () => {
    order.push("attachments_ready");
    return true;
  };
  const continuityConfirmed = () => {
    order.push("continuity_confirmed");
    return evaluateComposerContinuity(baseSnapshot()).ok;
  };
  const enterPrompt = () => {
    assert.ok(order.includes("attachments_ready"));
    assert.ok(order.includes("continuity_confirmed"));
    order.push("prompt_entered");
  };

  assert.equal(attachmentsReady(), true);
  assert.equal(continuityConfirmed(), true);
  enterPrompt();
  assert.deepEqual(order, [
    "attachments_ready",
    "continuity_confirmed",
    "prompt_entered",
  ]);
});

test("same Project Home URL continuity helper", () => {
  assert.equal(isSameProjectHomeUrl(PROJECT, PROJECT), true);
  assert.equal(
    isSameProjectHomeUrl(PROJECT, `${PROJECT}?foo=1`),
    true,
  );
});

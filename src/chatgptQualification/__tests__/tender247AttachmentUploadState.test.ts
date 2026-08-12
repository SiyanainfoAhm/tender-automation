import assert from "node:assert/strict";
import test from "node:test";
import type { QualificationAttachmentFile } from "../sourceDocumentResolver.js";
import { buildTender247ExpectedManifest } from "../tender247AttachmentManifest.js";
import {
  STABLE_ATTACHMENT_POLLS_REQUIRED,
  canAssignUploadFiles,
  createTenderAttachmentUploadState,
  evaluateAttachmentStabilityPoll,
  lockAttachments,
  shouldRetryUpload,
} from "../tender247AttachmentUploadState.js";

function manifestWithAi(): ReturnType<typeof buildTender247ExpectedManifest> {
  const files: QualificationAttachmentFile[] = [
    {
      kind: "METADATA",
      filePath: "/tmp/metadata.json",
      fileName: "metadata.json",
      required: true,
    },
    {
      kind: "AI_SUMMARY",
      filePath: "/tmp/AI_Summary.pdf",
      fileName: "AI_Summary.pdf",
      required: true,
    },
    {
      kind: "DOCUMENT_ARCHIVE",
      filePath: "/tmp/Tender_All_Documents.zip",
      fileName: "Tender_All_Documents.zip",
      required: true,
    },
  ];
  return buildTender247ExpectedManifest(files);
}

test("0 → upload 3 → stable 3 => no retry needed", () => {
  const manifest = manifestWithAi();
  const names = [
    "metadata.json",
    "AI_Summary.pdf",
    "Tender_All_Documents.zip",
  ];
  const first = evaluateAttachmentStabilityPoll({
    composerCount: 3,
    displayedNames: names,
    manifest,
    previousStableCount: null,
    consecutiveStablePolls: 0,
  });
  assert.equal(first.stable, false);
  assert.equal(first.consecutiveStablePolls, 1);

  const second = evaluateAttachmentStabilityPoll({
    composerCount: 3,
    displayedNames: names,
    manifest,
    previousStableCount: 3,
    consecutiveStablePolls: first.consecutiveStablePolls,
  });
  assert.equal(second.stable, true);
  assert.equal(second.consecutiveStablePolls, STABLE_ATTACHMENT_POLLS_REQUIRED);
  assert.equal(shouldRetryUpload(1, "none"), false);
});

test("timestamped names stabilize across two polls without retry", () => {
  const manifest = manifestWithAi();
  const names = [
    "metadata(20260812-084008).json",
    "AI_Summary(20260812-084008).pdf",
    "Tender_All_Documents(20260812-084008).zip",
  ];
  const first = evaluateAttachmentStabilityPoll({
    composerCount: 3,
    displayedNames: names,
    manifest,
    previousStableCount: null,
    consecutiveStablePolls: 0,
  });
  assert.equal(first.validation.ok, true);
  assert.equal(first.stable, false);

  const second = evaluateAttachmentStabilityPoll({
    composerCount: 3,
    displayedNames: names,
    manifest,
    previousStableCount: 3,
    consecutiveStablePolls: first.consecutiveStablePolls,
  });
  assert.equal(second.stable, true);
  assert.equal(second.validation.metadataCount, 1);
  assert.equal(second.validation.aiSummaryCount, 1);
  assert.equal(second.validation.archiveCount, 1);
});

test("0 → count 1 → 2 → 3 → 3 => stabilizes without retry", () => {
  const manifest = manifestWithAi();
  const steps: Array<{ count: number; names: string[] }> = [
    { count: 1, names: ["metadata.json"] },
    { count: 2, names: ["metadata.json", "AI_Summary.pdf"] },
    {
      count: 3,
      names: [
        "metadata.json",
        "AI_Summary.pdf",
        "Tender_All_Documents.zip",
      ],
    },
    {
      count: 3,
      names: [
        "metadata.json",
        "AI_Summary.pdf",
        "Tender_All_Documents.zip",
      ],
    },
  ];

  let previous: number | null = null;
  let consecutive = 0;
  let stable = false;
  for (const step of steps) {
    const poll = evaluateAttachmentStabilityPoll({
      composerCount: step.count,
      displayedNames: step.names,
      manifest,
      previousStableCount: previous,
      consecutiveStablePolls: consecutive,
    });
    consecutive = poll.consecutiveStablePolls;
    previous = step.count;
    stable = poll.stable;
  }
  assert.equal(stable, true);
});

test("3 correct files => attachmentsLocked blocks reassignment", () => {
  const state = createTenderAttachmentUploadState();
  state.filesAssigned = true;
  lockAttachments(state);
  assert.equal(canAssignUploadFiles(state), false);
});

test("upload explicit error => exactly one retry allowed", () => {
  assert.equal(shouldRetryUpload(1, "upload_error_visible"), true);
  assert.equal(shouldRetryUpload(2, "upload_error_visible"), false);
});

test("second attempt failure => stop candidate", () => {
  assert.equal(shouldRetryUpload(2, "timeout"), false);
});

test("temporary low count during settle => not stable, no retry yet", () => {
  const manifest = manifestWithAi();
  const poll = evaluateAttachmentStabilityPoll({
    composerCount: 1,
    displayedNames: ["metadata.json"],
    manifest,
    previousStableCount: null,
    consecutiveStablePolls: 0,
  });
  assert.equal(poll.stable, false);
  assert.equal(shouldRetryUpload(1, "none"), false);
});

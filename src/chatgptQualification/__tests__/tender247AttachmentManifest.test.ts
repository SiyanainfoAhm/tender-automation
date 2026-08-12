import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AutomationError } from "../../browserUtils.js";
import type { QualificationAttachmentFile } from "../sourceDocumentResolver.js";
import {
  assertTender247AttachmentCountSafe,
  assertTender247AttachmentValidationPassed,
  assertTender247UploadPathsTopLevelOnly,
  buildAttachmentManifestAudit,
  buildTender247ExpectedManifest,
  filterAttachmentChipCandidates,
  validateDisplayedAttachmentNames,
} from "../tender247AttachmentManifest.js";

function tempFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t247-manifest-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function makeFiles(
  withAiSummary: boolean,
  extra?: QualificationAttachmentFile[],
): QualificationAttachmentFile[] {
  const files: QualificationAttachmentFile[] = [
    {
      kind: "METADATA",
      filePath: tempFile("metadata.json", "{}"),
      fileName: "metadata.json",
      required: true,
    },
  ];
  if (withAiSummary) {
    files.push({
      kind: "AI_SUMMARY",
      filePath: tempFile("AI_Summary.pdf", "%PDF"),
      fileName: "AI_Summary.pdf",
      required: true,
    });
  }
  files.push({
    kind: "DOCUMENT_ARCHIVE",
    filePath: tempFile("Tender_All_Documents.zip", "PK"),
    fileName: "Tender_All_Documents.zip",
    required: true,
  });
  if (extra) {
    files.push(...extra);
  }
  return files;
}

test("AI summary exists -> exactly 3 expected attachments", () => {
  const files = makeFiles(true);
  const manifest = buildTender247ExpectedManifest(files);
  assert.equal(manifest.expectedCount, 3);
  assert.equal(manifest.aiSummaryRequired, true);
  assert.deepEqual(
    manifest.entries.map((entry) => entry.expectedFileName),
    ["metadata.json", "AI_Summary.pdf", "Tender_All_Documents.zip"],
  );
});

test("AI summary absent -> exactly 2 expected attachments", () => {
  const files = makeFiles(false);
  const manifest = buildTender247ExpectedManifest(files);
  assert.equal(manifest.expectedCount, 2);
  assert.equal(manifest.aiSummaryRequired, false);
});

test("ZIP contents are not individually added to upload paths", () => {
  const extracted = tempFile("scope.pdf", "%PDF");
  const normalized = extracted.replace(/\\/g, "/");
  const injected = normalized.replace(
    /[^/]+$/,
    "documents/extracted/scope.pdf",
  );
  assert.throws(
    () => assertTender247UploadPathsTopLevelOnly([injected]),
    (error: unknown) =>
      error instanceof AutomationError &&
      error.code === "CHATGPT_ATTACHMENT_SET_INVALID",
  );
});

test("4 expected files -> block before upload", () => {
  const files = makeFiles(true, [
    {
      kind: "METADATA",
      filePath: tempFile("metadata-copy.json", "{}"),
      fileName: "metadata-copy.json",
      required: false,
    },
  ]);
  const manifest = buildTender247ExpectedManifest(files);
  assert.equal(manifest.expectedCount, 4);
  assert.throws(
    () => assertTender247AttachmentCountSafe(manifest, "100711361"),
    (error: unknown) =>
      error instanceof AutomationError &&
      error.code === "CHATGPT_ATTACHMENT_SET_INVALID",
  );
});

test("duplicate metadata chip -> block send validation", () => {
  const manifest = buildTender247ExpectedManifest(makeFiles(false));
  const validation = validateDisplayedAttachmentNames({
    manifest,
    displayedNames: [
      "metadata.json",
      "metadata(2).json",
      "Tender_All_Documents.zip",
    ],
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.failureReason, "duplicate_metadata");
  assert.throws(
    () =>
      assertTender247AttachmentValidationPassed({
        manifest,
        validation,
        uploadLimitWarningSeen: false,
        sourceTenderId: "100711361",
      }),
    /CHATGPT_ATTACHMENT_VALIDATION_FAILED/,
  );
});

test("visible count mismatch -> block send validation", () => {
  const manifest = buildTender247ExpectedManifest(makeFiles(true));
  const validation = validateDisplayedAttachmentNames({
    manifest,
    displayedNames: ["metadata.json", "Tender_All_Documents.zip"],
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.visibleCount, 2);
  assert.throws(
    () =>
      assertTender247AttachmentValidationPassed({
        manifest,
        validation,
        uploadLimitWarningSeen: false,
        sourceTenderId: "100711361",
      }),
    /CHATGPT_SEND_BLOCKED=true/,
  );
});

test("20-file warning -> do not send", () => {
  const manifest = buildTender247ExpectedManifest(makeFiles(true));
  const validation = validateDisplayedAttachmentNames({
    manifest,
    displayedNames: [
      "metadata.json",
      "AI_Summary.pdf",
      "Tender_All_Documents.zip",
    ],
  });
  assert.equal(validation.ok, true);
  assert.throws(
    () =>
      assertTender247AttachmentValidationPassed({
        manifest,
        validation,
        uploadLimitWarningSeen: true,
        sourceTenderId: "100711361",
      }),
    (error: unknown) =>
      error instanceof AutomationError &&
      error.code === "CHATGPT_UPLOAD_LIMIT_WARNING",
  );
});

test("stale attachment cleanup is reflected in manifest audit", () => {
  const manifest = buildTender247ExpectedManifest(makeFiles(true));
  const validation = validateDisplayedAttachmentNames({
    manifest,
    displayedNames: [
      "metadata.json",
      "AI_Summary.pdf",
      "Tender_All_Documents.zip",
    ],
  });
  const audit = buildAttachmentManifestAudit({
    manifest,
    sourceTenderId: "100711361",
    displayedNames: [
      "metadata.json",
      "AI_Summary.pdf",
      "Tender_All_Documents.zip",
    ],
    filesAssignedCount: 3,
    uploadLimitWarningSeen: false,
    staleAttachmentsFound: 2,
    staleAttachmentsCleared: true,
    validation,
    sendBlocked: false,
  });
  assert.equal(audit.expectedCount, 3);
  assert.equal(audit.visibleCount, 3);
  assert.equal(audit.filesAssignedCount, 3);
  assert.equal(audit.staleAttachmentsFound, 2);
  assert.equal(audit.staleAttachmentsCleared, true);
  assert.equal(audit.validationPassed, true);
  assert.equal(audit.files.length, 3);
  assert.ok(audit.files.every((file) => file.verifiedVisible));
});

test("filterAttachmentChipCandidates removes Remove file labels", () => {
  const filtered = filterAttachmentChipCandidates([
    "Remove file: metadata.json",
    "metadata.json",
    "Remove file 2: Tender_All_Documents.zip",
    "Tender_All_Documents.zip",
  ]);
  assert.deepEqual(filtered, ["metadata.json", "Tender_All_Documents.zip"]);
});

test("duplicate suffix filenames are accepted once each", () => {
  const manifest = buildTender247ExpectedManifest(makeFiles(true));
  const validation = validateDisplayedAttachmentNames({
    manifest,
    displayedNames: [
      "metadata(8).json",
      "AI_Summary(2).pdf",
      "Tender_All_Documents(1).zip",
    ],
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.visibleCount, 3);
});

test("timestamped ChatGPT display names validate and lock", () => {
  const manifest = buildTender247ExpectedManifest(makeFiles(true));
  const displayedNames = [
    "metadata(20260812-084008).json",
    "AI_Summary(20260812-084008).pdf",
    "Tender_All_Documents(20260812-084008).zip",
  ];
  const validation = validateDisplayedAttachmentNames({
    manifest,
    displayedNames,
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.metadataCount, 1);
  assert.equal(validation.aiSummaryCount, 1);
  assert.equal(validation.archiveCount, 1);
  assert.equal(validation.visibleCount, 3);

  assert.doesNotThrow(() =>
    assertTender247AttachmentValidationPassed({
      manifest,
      validation,
      uploadLimitWarningSeen: false,
      sourceTenderId: "100711361",
    }),
  );
});

test("truncateded truncated zip display name still counts as logical zip", () => {
  const manifest = buildTender247ExpectedManifest(makeFiles(true));
  const validation = validateDisplayedAttachmentNames({
    manifest,
    displayedNames: [
      "metadata(20260812-084008).json",
      "AI_Summary(20260812-084008).pdf",
      "Tender_All_Documents(20260812-084...).zip",
    ],
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.archiveCount, 1);
});

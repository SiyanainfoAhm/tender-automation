import assert from "node:assert/strict";
import test from "node:test";
import {
  filterComposerAttachmentDisplayNames,
  parseRemoveFileButtonLabel,
} from "../chatInteraction.js";
import {
  assertTender247AttachmentCountSafe,
  buildTender247ExpectedManifest,
  validateDisplayedAttachmentNames,
} from "../tender247AttachmentManifest.js";
import type { QualificationAttachmentFile } from "../sourceDocumentResolver.js";

test("parseRemoveFileButtonLabel extracts filename from aria-label", () => {
  assert.equal(
    parseRemoveFileButtonLabel("Remove file: metadata.json"),
    "metadata.json",
  );
  assert.equal(
    parseRemoveFileButtonLabel("Remove file 2: AI_Summary.pdf"),
    "AI_Summary.pdf",
  );
});

test("filterComposerAttachmentDisplayNames drops Remove-file labels", () => {
  const filtered = filterComposerAttachmentDisplayNames([
    "Remove file: metadata.json",
    "metadata.json",
    "Remove file 3: Tender_All_Documents.zip",
    "Tender_All_Documents.zip",
  ]);
  assert.deepEqual(filtered, [
    "metadata.json",
    "Tender_All_Documents.zip",
  ]);
});

test("page-like history names do not inflate composer validation when composer has 0", () => {
  const files: QualificationAttachmentFile[] = [
    {
      kind: "METADATA",
      filePath: "/tmp/metadata.json",
      fileName: "metadata.json",
      required: true,
    },
    {
      kind: "DOCUMENT_ARCHIVE",
      filePath: "/tmp/Tender_All_Documents.zip",
      fileName: "Tender_All_Documents.zip",
      required: true,
    },
  ];
  const manifest = buildTender247ExpectedManifest(files);
  const validation = validateDisplayedAttachmentNames({
    manifest,
    displayedNames: [],
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.visibleCount, 0);
});

test("clean composer + 3 uploads validates to count 3", () => {
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
  const manifest = buildTender247ExpectedManifest(files);
  const validation = validateDisplayedAttachmentNames({
    manifest,
    displayedNames: [
      "metadata.json",
      "AI_Summary.pdf",
      "Tender_All_Documents.zip",
    ],
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.visibleCount, 3);
});

test("duplicate metadata in composer blocks validation", () => {
  const files: QualificationAttachmentFile[] = [
    {
      kind: "METADATA",
      filePath: "/tmp/metadata.json",
      fileName: "metadata.json",
      required: true,
    },
    {
      kind: "DOCUMENT_ARCHIVE",
      filePath: "/tmp/Tender_All_Documents.zip",
      fileName: "Tender_All_Documents.zip",
      required: true,
    },
  ];
  const manifest = buildTender247ExpectedManifest(files);
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
});

test(">3 local Tender247 files blocks before upload", () => {
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
    {
      kind: "METADATA",
      filePath: "/tmp/extra.json",
      fileName: "extra.json",
      required: false,
    },
  ];
  const manifest = buildTender247ExpectedManifest(files);
  assert.throws(
    () => assertTender247AttachmentCountSafe(manifest, "103232437"),
    /CHATGPT_ATTACHMENT_SET_INVALID/,
  );
});

test("visible count mismatch blocks send validation", () => {
  const files: QualificationAttachmentFile[] = [
    {
      kind: "METADATA",
      filePath: "/tmp/metadata.json",
      fileName: "metadata.json",
      required: true,
    },
    {
      kind: "DOCUMENT_ARCHIVE",
      filePath: "/tmp/Tender_All_Documents.zip",
      fileName: "Tender_All_Documents.zip",
      required: true,
    },
  ];
  const manifest = buildTender247ExpectedManifest(files);
  const validation = validateDisplayedAttachmentNames({
    manifest,
    displayedNames: ["metadata.json"],
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.visibleCount, 1);
});

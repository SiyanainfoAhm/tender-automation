import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isResumablePendingState,
  type ChatGptTenderState,
} from "../chatgptState.js";
import {
  assembleQualificationAttachmentBundle,
  assertRequiredAttachmentsReady,
  matchesAttachmentChipName,
} from "../sourceDocumentResolver.js";

function makeTender247Folder(withAiSummary: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-t247-"));
  const folder = path.join(root, "T247-100711361");
  fs.mkdirSync(path.join(folder, "documents"), { recursive: true });
  fs.writeFileSync(
    path.join(folder, "documents", "Tender_All_Documents.zip"),
    "PK\x03\x04zip-content",
  );
  if (withAiSummary) {
    fs.writeFileSync(path.join(folder, "AI_Summary.pdf"), "%PDF-1.4 summary");
  }
  const metaDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-"));
  const metadataPath = path.join(metaDir, "metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify({ t247Id: "100711361" }), "utf8");
  return folder;
}

function writeTempMetadata(payload: Record<string, unknown>): {
  metadataPath: string;
  cleanup: () => void;
} {
  const metaDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-bundle-"));
  const metadataPath = path.join(metaDir, "metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify(payload), "utf8");
  return {
    metadataPath,
    cleanup: () => {
      fs.rmSync(metaDir, { recursive: true, force: true });
    },
  };
}

test("1. Tender247 with AI Summary resolves three files", () => {
  const folder = makeTender247Folder(true);
  const meta = writeTempMetadata({ t247Id: "100711361" });
  try {
    const bundle = assembleQualificationAttachmentBundle({
      sourcePortal: "TENDER247",
      sourceTenderId: "100711361",
      localFolderPath: folder,
      metadataPath: meta.metadataPath,
      cleanup: meta.cleanup,
    });
    assert.equal(bundle.expectedAttachmentCount, 3);
    assert.equal(bundle.aiSummaryAvailable, true);
    assert.deepEqual(
      bundle.files.map((f) => f.fileName),
      ["metadata.json", "AI_Summary.pdf", "Tender_All_Documents.zip"],
    );
    assert.ok(bundle.files.every((f) => f.required));
  } finally {
    meta.cleanup();
    fs.rmSync(path.dirname(folder), { recursive: true, force: true });
  }
});

test("2. Tender247 without AI Summary resolves two files", () => {
  const folder = makeTender247Folder(false);
  const meta = writeTempMetadata({ t247Id: "100711361" });
  try {
    const bundle = assembleQualificationAttachmentBundle({
      sourcePortal: "TENDER247",
      sourceTenderId: "100711361",
      localFolderPath: folder,
      metadataPath: meta.metadataPath,
      cleanup: meta.cleanup,
    });
    assert.equal(bundle.expectedAttachmentCount, 2);
    assert.equal(bundle.aiSummaryAvailable, false);
    assert.deepEqual(
      bundle.files.map((f) => f.fileName),
      ["metadata.json", "Tender_All_Documents.zip"],
    );
  } finally {
    meta.cleanup();
    fs.rmSync(path.dirname(folder), { recursive: true, force: true });
  }
});

test("3. Tender247 missing archive cannot submit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-missing-"));
  const folder = path.join(root, "T247-100711361");
  fs.mkdirSync(folder, { recursive: true });
  const meta = writeTempMetadata({ t247Id: "100711361" });
  try {
    assert.throws(
      () =>
        assembleQualificationAttachmentBundle({
          sourcePortal: "TENDER247",
          sourceTenderId: "100711361",
          localFolderPath: folder,
          metadataPath: meta.metadataPath,
          cleanup: meta.cleanup,
        }),
      /CHATGPT_REQUIRED_ATTACHMENT_MISSING/,
    );
  } finally {
    meta.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("4. BidAssist resolves metadata plus one original ZIP", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-ba-"));
  const folder = path.join(root, "BA-GEM-1");
  fs.mkdirSync(path.join(folder, "original"), { recursive: true });
  fs.writeFileSync(
    path.join(folder, "original", "docs-original.zip"),
    "PK\x03\x04zip",
  );
  const meta = writeTempMetadata({
    bidassistId: "GEM-1",
    originalZipFile: "docs-original.zip",
  });
  try {
    const bundle = assembleQualificationAttachmentBundle({
      sourcePortal: "BIDASSIST",
      sourceTenderId: "GEM-1",
      localFolderPath: folder,
      metadataPath: meta.metadataPath,
      cleanup: meta.cleanup,
      rawMetadata: {
        bidassistId: "GEM-1",
        originalZipFile: "docs-original.zip",
      },
    });
    assert.equal(bundle.expectedAttachmentCount, 2);
    assert.deepEqual(
      bundle.files.map((f) => f.fileName),
      ["metadata.json", "docs-original.zip"],
    );
  } finally {
    meta.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("5. BidAssist does not require AI Summary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-ba-noai-"));
  const folder = path.join(root, "BA-GEM-2");
  fs.mkdirSync(path.join(folder, "original"), { recursive: true });
  fs.writeFileSync(path.join(folder, "original", "only.zip"), "PK\x03\x04zip");
  assert.equal(fs.existsSync(path.join(folder, "AI_Summary.pdf")), false);
  const meta = writeTempMetadata({ bidassistId: "GEM-2" });
  try {
    const bundle = assembleQualificationAttachmentBundle({
      sourcePortal: "BIDASSIST",
      sourceTenderId: "GEM-2",
      localFolderPath: folder,
      metadataPath: meta.metadataPath,
      cleanup: meta.cleanup,
      rawMetadata: { originalZipFile: "only.zip" },
    });
    assert.equal(bundle.aiSummaryAvailable, false);
    assert.equal(bundle.aiSummaryPath, null);
    assert.equal(bundle.expectedAttachmentCount, 2);
    assert.ok(!bundle.files.some((f) => f.kind === "AI_SUMMARY"));
  } finally {
    meta.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("6. E2E cannot enter prompt before attachment verification", () => {
  const processSrc = fs.readFileSync(
    path.resolve("src/chatgptQualification/processTenderQualification.ts"),
    "utf8",
  );
  const qualifyStart = processSrc.indexOf("export async function qualifySingleTender");
  const body = processSrc.slice(qualifyStart);
  const uploadIdx = body.indexOf("await uploadQualificationAttachments(");
  const promptIdx = body.indexOf(
    "await enterPromptAndSendWithConfirmedAttachments(",
  );
  assert.ok(uploadIdx > 0, "must call uploadQualificationAttachments");
  assert.ok(
    promptIdx > uploadIdx,
    "prompt send must follow uploadQualificationAttachments",
  );

  const bidSrc = fs.readFileSync(
    path.resolve("src/chatgptQualification/qualifyBidassistTender.ts"),
    "utf8",
  );
  const baFn = bidSrc.indexOf("export async function qualifyBidassistTender");
  const baBody = bidSrc.slice(baFn);
  const baUpload = baBody.indexOf("await uploadQualificationAttachments(");
  const baPrompt = baBody.indexOf(
    "await enterPromptAndSendWithConfirmedAttachments(",
  );
  assert.ok(baUpload > 0 && baPrompt > baUpload);
});

test("7. Prompt-only fallback is rejected", () => {
  const chatSrc = fs.readFileSync(
    path.resolve("src/chatgptQualification/chatInteraction.ts"),
    "utf8",
  );
  assert.doesNotMatch(chatSrc, /CHATGPT_ATTACHMENT_DETECTION_FALLBACK/);
  assert.doesNotMatch(
    chatSrc,
    /sendEnabled && promptReady/,
  );

  assert.throws(
    () =>
      assertRequiredAttachmentsReady({
        sourcePortal: "TENDER247",
        sourceTenderId: "100711361",
        metadataDetected: false,
        tenderArchiveDetected: false,
        bidassistArchiveDetected: false,
        aiSummaryDetected: false,
        aiSummaryRequired: false,
      }),
    /CHATGPT_REQUIRED_ATTACHMENTS_NOT_READY/,
  );
});

test("8. Existing chat without requiredAttachmentsConfirmed is not resumed", () => {
  const state: ChatGptTenderState = {
    t247Id: "100711361",
    chatUrl: "https://chatgpt.com/c/abc-without-attachments",
    status: "response_pending",
    submissionConfirmed: true,
    requiredAttachmentsConfirmed: false,
    updatedAt: new Date().toISOString(),
  };
  assert.equal(isResumablePendingState(state), false);

  const valid: ChatGptTenderState = {
    ...state,
    sourcePortal: "TENDER247",
    sourceTenderId: "100711361",
    requiredAttachmentsConfirmed: true,
    attachmentFileNames: [
      "metadata.json",
      "AI_Summary.pdf",
      "Tender_All_Documents.zip",
    ],
    attachmentCount: 3,
    attachmentHashes: ["a", "b", "c"],
    composerIdentity: "agenttender-TENDER247-100711361-test-token",
  };
  assert.equal(isResumablePendingState(valid), true);
});

test("9. Temporary metadata survives until attachment verification", () => {
  const folder = makeTender247Folder(true);
  let cleaned = false;
  const meta = writeTempMetadata({ t247Id: "100711361" });
  const cleanup = () => {
    cleaned = true;
    meta.cleanup();
  };
  try {
    const bundle = assembleQualificationAttachmentBundle({
      sourcePortal: "TENDER247",
      sourceTenderId: "100711361",
      localFolderPath: folder,
      metadataPath: meta.metadataPath,
      cleanup,
    });
    assert.equal(cleaned, false);
    assert.ok(bundle.metadataPath);
    assert.ok(fs.existsSync(bundle.metadataPath));
    assert.equal(path.basename(bundle.metadataPath), "metadata.json");
    // Simulates verification complete, then cleanup
    assert.equal(cleaned, false);
  } finally {
    cleanup();
    assert.equal(cleaned, true);
    fs.rmSync(path.dirname(folder), { recursive: true, force: true });
  }
});

test("10. Temporary metadata is cleaned afterward", () => {
  const folder = makeTender247Folder(false);
  const meta = writeTempMetadata({ t247Id: "100711361" });
  const metaPath = meta.metadataPath;
  const bundle = assembleQualificationAttachmentBundle({
    sourcePortal: "TENDER247",
    sourceTenderId: "100711361",
    localFolderPath: folder,
    metadataPath: metaPath,
    cleanup: meta.cleanup,
  });
  assert.ok(fs.existsSync(metaPath));
  bundle.cleanup();
  assert.equal(fs.existsSync(metaPath), false);
  fs.rmSync(path.dirname(folder), { recursive: true, force: true });
});

test("attachment chip identity accepts ChatGPT duplicate suffixes", () => {
  assert.ok(matchesAttachmentChipName("metadata(1).json", "metadata.json"));
  assert.ok(matchesAttachmentChipName("AI_Summary(1).pdf", "AI_Summary.pdf"));
  assert.ok(
    matchesAttachmentChipName(
      "Tender_All_Documents(1).zip",
      "Tender_All_Documents.zip",
    ),
  );
  assert.ok(matchesAttachmentChipName("docs-original(2).zip", "docs-original.zip"));
});

test("attachment chip identity accepts timestamped display names", () => {
  assert.ok(
    matchesAttachmentChipName(
      "metadata(20260812-084008).json",
      "metadata.json",
    ),
  );
  assert.ok(
    matchesAttachmentChipName(
      "AI_Summary(20260812-084008).pdf",
      "AI_Summary.pdf",
    ),
  );
  assert.ok(
    matchesAttachmentChipName(
      "Tender_All_Documents(20260812-084008).zip",
      "Tender_All_Documents.zip",
    ),
  );
  assert.ok(
    matchesAttachmentChipName(
      "Tender_All_Documents(20260812-084...).zip",
      "Tender_All_Documents.zip",
    ),
  );
});

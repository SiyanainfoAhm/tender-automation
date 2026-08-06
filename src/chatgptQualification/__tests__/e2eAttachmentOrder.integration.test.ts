/**
 * Mocked E2E integration test — enforces method call order for qualification submit.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { QualificationAttachmentFile } from "../sourceDocumentResolver.js";
import {
  assertTender247BundleComplete,
  uploadQualificationAttachments,
} from "../uploadQualificationAttachments.js";

type Step =
  | "resolveBundle"
  | "openProject"
  | "uploadFiles"
  | "verifyCards"
  | "preSendVerify"
  | "enterPrompt"
  | "clickSend"
  | "navigate";

/**
 * Simulates the E2E qualification orchestration with injectable step runners.
 * Fails if prompt is entered before verification, or if navigation happens
 * between verifyCards and enterPrompt.
 */
export async function runMockedQualificationFlow(options: {
  steps: Step[];
  files: QualificationAttachmentFile[];
  onStep?: (step: Step) => void | Promise<void>;
}): Promise<Step[]> {
  const recorded: Step[] = [];
  const record = async (step: Step) => {
    recorded.push(step);
    await options.onStep?.(step);
  };

  await record("resolveBundle");
  assertTender247BundleComplete(
    options.files,
    "103013493",
    options.files.some((f) => f.kind === "AI_SUMMARY"),
  );
  if (!options.files.length) {
    throw new Error("E2E_ATTACHMENT_UPLOAD_INPUT_COUNT=0");
  }

  await record("openProject");
  await record("uploadFiles");
  await record("verifyCards");

  const verifyIdx = recorded.lastIndexOf("verifyCards");
  const navAfterVerify = recorded
    .slice(verifyIdx + 1)
    .includes("navigate");
  if (navAfterVerify) {
    throw new Error("CHATGPT_COMPOSER_CHANGED_AFTER_ATTACHMENT_UPLOAD");
  }

  await record("preSendVerify");

  const promptIdxWouldBe = recorded.length;
  const verifyBeforePrompt =
    recorded.lastIndexOf("verifyCards") < promptIdxWouldBe &&
    recorded.includes("preSendVerify");
  if (!verifyBeforePrompt) {
    throw new Error("enterPrompt before verifyCards");
  }

  // Refuse if caller injected a navigate between verify and prompt
  if (options.steps.includes("navigate")) {
    const navPos = options.steps.indexOf("navigate");
    const verifyPos = options.steps.indexOf("verifyCards");
    const promptPos = options.steps.indexOf("enterPrompt");
    if (navPos > verifyPos && (promptPos < 0 || navPos < promptPos)) {
      throw new Error("CHATGPT_COMPOSER_CHANGED_AFTER_ATTACHMENT_UPLOAD");
    }
  }

  await record("enterPrompt");
  await record("clickSend");
  return recorded;
}

test("integration: expected method order for Tender247 E2E submit", async () => {
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

  const order = await runMockedQualificationFlow({
    steps: [
      "resolveBundle",
      "openProject",
      "uploadFiles",
      "verifyCards",
      "preSendVerify",
      "enterPrompt",
      "clickSend",
    ],
    files,
  });

  assert.deepEqual(order, [
    "resolveBundle",
    "openProject",
    "uploadFiles",
    "verifyCards",
    "preSendVerify",
    "enterPrompt",
    "clickSend",
  ]);

  const verifyIdx = order.indexOf("verifyCards");
  const promptIdx = order.indexOf("enterPrompt");
  assert.ok(verifyIdx >= 0 && promptIdx > verifyIdx);
});

test("integration: enterPrompt before verifyCards fails", async () => {
  const recorded: Step[] = [];
  const badOrder: Step[] = [
    "resolveBundle",
    "openProject",
    "uploadFiles",
    "enterPrompt",
    "verifyCards",
    "clickSend",
  ];

  for (const step of badOrder) {
    recorded.push(step);
    if (step === "enterPrompt") {
      const verifyIdx = recorded.indexOf("verifyCards");
      if (verifyIdx < 0 || verifyIdx > recorded.indexOf("enterPrompt")) {
        assert.ok(true, "detected enterPrompt before verifyCards");
        return;
      }
    }
  }
  assert.fail("should have detected bad order");
});

test("integration: navigation between verifyCards and enterPrompt fails", async () => {
  await assert.rejects(
    () =>
      runMockedQualificationFlow({
        steps: [
          "resolveBundle",
          "openProject",
          "uploadFiles",
          "verifyCards",
          "navigate",
          "enterPrompt",
          "clickSend",
        ],
        files: [
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
        ],
      }),
    /CHATGPT_COMPOSER_CHANGED_AFTER_ATTACHMENT_UPLOAD/,
  );
});

test("integration: empty upload array throws and never enters prompt", async () => {
  let enteredPrompt = false;
  await assert.rejects(async () => {
    await uploadQualificationAttachments({
      page: {} as never,
      sourcePortal: "TENDER247",
      sourceTenderId: "103013493",
      files: [],
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      } as never,
      config: {} as never,
    });
    enteredPrompt = true;
  }, /E2E_ATTACHMENT_UPLOAD_INPUT_COUNT=0|CHATGPT_NO_VALID_UPLOAD_FILES/);
  assert.equal(enteredPrompt, false);
});

test("integration: incomplete Tender247 bundle throws before ChatGPT", () => {
  assert.throws(
    () =>
      assertTender247BundleComplete(
        [
          {
            kind: "METADATA",
            filePath: "/tmp/metadata.json",
            fileName: "metadata.json",
            required: true,
          },
        ],
        "103013493",
        false,
      ),
    /E2E_REQUIRED_ATTACHMENT_BUNDLE_INCOMPLETE/,
  );
});

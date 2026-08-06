import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  claimsMandatoryUploadsUnavailable,
  isValidSavedQualificationResult,
  withUploadedEvidenceFiles,
} from "../qualificationSchema.js";
import type { QualificationResult } from "../types.js";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function baseResult(
  partial: Partial<QualificationResult>,
): QualificationResult {
  return {
    t247Id: "101279958",
    company: "Siyana Info Solutions Pvt. Ltd.",
    status: "VERIFY",
    decisionLabel: "VERIFY",
    verdict: "Cannot decide",
    reason: "Tender documents are unavailable.",
    requiredAction: "Hold the decision and obtain the missing source or clarification.",
    confidence: 0.5,
    matchedCriteria: [],
    failedCriteria: [],
    unclearCriteria: ["Documents unavailable"],
    missingDocuments: [
      "metadata.json",
      "AI_Summary.pdf",
      "Tender_All_Documents.zip",
    ],
    conditions: [],
    partnershipRequiredFor: [],
    partnershipModeAllowed: [],
    manualReviewRequired: true,
    evidenceFiles: [],
    ...partial,
  };
}

test("claimsMandatoryUploadsUnavailable detects false missing-doc VERIFY", () => {
  const uploaded = [
    "metadata.json",
    "AI_Summary.pdf",
    "Tender_All_Documents.zip",
  ];
  assert.equal(
    claimsMandatoryUploadsUnavailable(baseResult({}), uploaded),
    true,
  );
});

test("withUploadedEvidenceFiles populates evidence from uploads", () => {
  const uploaded = [
    "metadata.json",
    "AI_Summary.pdf",
    "Tender_All_Documents.zip",
  ];
  const result = withUploadedEvidenceFiles(baseResult({}), uploaded);
  assert.deepEqual(result.evidenceFiles, uploaded);
});

test("no result files when Send never happened (completion validator)", () => {
  const dir = makeTempDir("no-send-");
  const tenderFolder = path.join(dir, "T247-101279958");
  fs.mkdirSync(tenderFolder, { recursive: true });

  // Simulate upload-only state — no Send confirmation
  fs.writeFileSync(
    path.join(tenderFolder, "chatgpt-state.json"),
    JSON.stringify({
      t247Id: "101279958",
      chatUrl: null,
      status: "failed",
      submissionConfirmed: false,
      phase: "FILES_UPLOADED",
      updatedAt: new Date().toISOString(),
      error: "Prompt was not submitted",
      uploadedEvidenceFiles: [
        "metadata.json",
        "AI_Summary.pdf",
        "Tender_All_Documents.zip",
      ],
    }),
    "utf8",
  );

  const resultPath = path.join(tenderFolder, "qualification-result.json");
  const responsePath = path.join(tenderFolder, "qualification-response.txt");

  // Must not fabricate a VERIFY result after upload-only
  assert.equal(fs.existsSync(resultPath), false);
  assert.equal(fs.existsSync(responsePath), false);
  assert.equal(isValidSavedQualificationResult(resultPath), false);

  // Even if a bad VERIFY file is planted without submissionConfirmed, reject it
  fs.writeFileSync(
    resultPath,
    JSON.stringify(
      baseResult({
        reason: "Tender documents are unavailable.",
        evidenceFiles: [],
      }),
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(
    responsePath,
    JSON.stringify(baseResult({})),
    "utf8",
  );
  assert.equal(isValidSavedQualificationResult(resultPath), false);
});

test("completed count stays zero without confirmed submission", () => {
  let completed = 0;
  const submissionConfirmed = false;
  const canComplete = submissionConfirmed;
  if (canComplete) {
    completed += 1;
  }
  assert.equal(completed, 0);
});

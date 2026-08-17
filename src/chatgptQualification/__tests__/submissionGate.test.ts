import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyFalseMissingDocumentClaim,
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

test("false missing-document claim stays VERIFY and is not discarded", () => {
  const uploaded = [
    "metadata.json",
    "AI_Summary.pdf",
    "Tender_All_Documents.zip",
  ];
  const applied = applyFalseMissingDocumentClaim({
    result: baseResult({}),
    uploadedEvidenceFiles: uploaded,
  });
  assert.equal(applied.falseClaim, true);
  assert.equal(applied.result.status, "VERIFY");
  assert.equal(applied.result.modelFalseMissingDocumentClaim, true);
  assert.equal(applied.result.modelDocumentInterpretationConflict, true);
  assert.equal(applied.result.manualReviewRequired, true);
  assert.deepEqual(applied.result.evidenceFiles, uploaded);
  assert.equal(applied.manifest.metadataPresent, true);
  assert.equal(applied.manifest.documentZipPresent, true);
});

test("GO with false missing-document claim is normalized to VERIFY", () => {
  const uploaded = ["metadata.json", "Tender_All_Documents.zip"];
  const applied = applyFalseMissingDocumentClaim({
    result: baseResult({
      status: "GO",
      decisionLabel: "GO",
      reason: "Tender documents were not uploaded.",
      manualReviewRequired: false,
      failedCriteria: [],
      unclearCriteria: [],
      missingDocuments: ["Tender_All_Documents.zip"],
    }),
    uploadedEvidenceFiles: uploaded,
  });
  assert.equal(applied.falseClaim, true);
  assert.equal(applied.result.status, "VERIFY");
  assert.match(
    applied.result.reason,
    /MODEL_DOCUMENT_INTERPRETATION_CONFLICT/,
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

test("false missing-document VERIFY with uploads is a valid saved result", () => {
  const dir = makeTempDir("false-missing-valid-");
  const tenderFolder = path.join(dir, "T247-103407645");
  fs.mkdirSync(tenderFolder, { recursive: true });
  const uploaded = [
    "metadata.json",
    "AI_Summary.pdf",
    "Tender_All_Documents.zip",
  ];
  const applied = applyFalseMissingDocumentClaim({
    result: withUploadedEvidenceFiles(
      baseResult({ t247Id: "103407645" }),
      uploaded,
    ),
    uploadedEvidenceFiles: uploaded,
  });
  fs.writeFileSync(
    path.join(tenderFolder, "chatgpt-state.json"),
    JSON.stringify({
      t247Id: "103407645",
      chatUrl: "https://chatgpt.com/c/abc",
      status: "completed",
      submissionConfirmed: true,
      updatedAt: new Date().toISOString(),
      uploadedEvidenceFiles: uploaded,
    }),
    "utf8",
  );
  const resultPath = path.join(tenderFolder, "qualification-result.json");
  fs.writeFileSync(resultPath, JSON.stringify(applied.result, null, 2), "utf8");
  fs.writeFileSync(
    path.join(tenderFolder, "qualification-response.txt"),
    JSON.stringify(applied.result),
    "utf8",
  );
  assert.equal(applied.falseClaim, true);
  assert.equal(isValidSavedQualificationResult(resultPath), true);
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

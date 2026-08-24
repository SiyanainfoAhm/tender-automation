import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { inspectQualificationState } from "../inspectQualificationState.js";
import { TENDER_DECISION_LABELS } from "../types.js";

function makeTender(options: {
  dateFolder: string;
  t247Id: string;
  mode: "canonical" | "text";
  status?: string;
}): string {
  const tenderFolder = path.join(options.dateFolder, `T247-${options.t247Id}`);
  fs.mkdirSync(path.join(tenderFolder, "documents"), { recursive: true });
  const status = options.status ?? "VERIFY";
  const result = {
    sourcePortal: "TENDER247",
    sourceTenderId: options.t247Id,
    t247Id: options.t247Id,
    company: "Siyana Info Solutions Pvt. Ltd.",
    status,
    decisionLabel:
      TENDER_DECISION_LABELS[status as keyof typeof TENDER_DECISION_LABELS] ||
      status,
    verdict: "needs verification",
    reason: "valid detailed qualification for tests",
    requiredAction:
      status === "VERIFY" || status === "NO_GO" ? "Review" : "Proceed",
    confidence: 0.9,
    matchedCriteria: [],
    failedCriteria: [],
    unclearCriteria: status === "VERIFY" ? ["needs human review"] : [],
    missingDocuments: [],
    conditions: [],
    partnershipRequiredFor: [],
    partnershipModeAllowed: [],
    manualReviewRequired: status === "VERIFY" || status === "NO_GO",
    evidenceFiles: ["Tender_All_Documents.zip"],
  };
  if (options.mode === "canonical") {
    fs.writeFileSync(
      path.join(tenderFolder, "qualification-result.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tenderFolder, "qualification-response.txt"),
      JSON.stringify(result),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tenderFolder, "chatgpt-state.json"),
      JSON.stringify({
        t247Id: options.t247Id,
        status: "completed",
        submissionConfirmed: true,
        chatUrl: "https://chatgpt.com/c/test",
        updatedAt: new Date().toISOString(),
      }),
      "utf8",
    );
  } else {
    fs.writeFileSync(
      path.join(tenderFolder, "qualification-text-mode.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tenderFolder, "qualification-text-mode-response.txt"),
      JSON.stringify(result),
      "utf8",
    );
  }
  return tenderFolder;
}

describe("inspectQualificationState", () => {
  it("marks canonical valid result COMPLETE", () => {
    const dateFolder = fs.mkdtempSync(path.join(os.tmpdir(), "qual-state-"));
    makeTender({ dateFolder, t247Id: "111", mode: "canonical" });
    const state = inspectQualificationState({
      dateFolder,
      tenderId: "111",
    });
    assert.equal(state.status, "COMPLETE");
    assert.equal(state.validResponse, true);
    assert.equal(state.skipReason, "VALID_EXISTING_RESPONSE");
  });

  it("marks text-mode valid result COMPLETE", () => {
    const dateFolder = fs.mkdtempSync(path.join(os.tmpdir(), "qual-state-"));
    makeTender({ dateFolder, t247Id: "222", mode: "text", status: "VERIFY" });
    const state = inspectQualificationState({
      dateFolder,
      tenderId: "222",
    });
    assert.equal(state.status, "COMPLETE");
    assert.equal(state.validResponse, true);
    assert.equal(state.qualificationStatus, "VERIFY");
    assert.equal(state.source, "qualification-text-mode");
  });

  it("returns NOT_STARTED when no artifacts exist", () => {
    const dateFolder = fs.mkdtempSync(path.join(os.tmpdir(), "qual-state-"));
    fs.mkdirSync(path.join(dateFolder, "T247-333"), { recursive: true });
    const state = inspectQualificationState({
      dateFolder,
      tenderId: "333",
    });
    assert.equal(state.status, "NOT_STARTED");
    assert.equal(state.validResponse, false);
  });
});

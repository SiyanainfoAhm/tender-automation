/**
 * Fresh vs resume skip semantics + input fingerprint matching.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  evaluateExistingQualificationReuse,
} from "../existingQualificationReuse.js";
import {
  computeQualificationInputFingerprint,
  saveQualificationInputFingerprint,
} from "../qualificationInputFingerprint.js";

const tempDirs: string[] = [];

function makeDateFolder(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qual-reuse-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function minimalZip(payloadMarker: string): Buffer {
  // Empty ZIP EOCD + marker appended so content/hash differs per variant.
  const eocd = Buffer.from([
    0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0,
  ]);
  return Buffer.concat([eocd, Buffer.from(payloadMarker, "utf8")]);
}

function seedReadyTender(options: {
  dateFolder: string;
  t247Id: string;
  status?: string;
  withHash?: boolean;
  zipMarker?: string;
}): string {
  const tenderFolder = path.join(options.dateFolder, `T247-${options.t247Id}`);
  const docs = path.join(tenderFolder, "documents");
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(
    path.join(tenderFolder, "metadata.json"),
    JSON.stringify({ sourceTenderId: options.t247Id, title: "Test" }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(docs, "Tender_All_Documents.zip"),
    minimalZip(options.zipMarker ?? "zip-v1"),
  );
  fs.writeFileSync(
    path.join(tenderFolder, "qualification-response.txt"),
    "assistant response body",
    "utf8",
  );
  fs.writeFileSync(
    path.join(tenderFolder, "qualification-result.json"),
    JSON.stringify(
      {
        sourcePortal: "TENDER247",
        sourceTenderId: options.t247Id,
        t247Id: options.t247Id,
        company: "Siyana Info Solutions Pvt. Ltd.",
        status: options.status ?? "VERIFY",
        decisionLabel: options.status ?? "VERIFY",
        reason: "unit test",
        verdict: "needs verification",
        requiredAction: "Review",
        confidence: 0.5,
        matchedCriteria: [],
        failedCriteria: [],
        unclearCriteria: [],
        missingDocuments: [],
        conditions: [],
        partnershipRequiredFor: [],
        partnershipModeAllowed: [],
        manualReviewRequired: true,
        evidenceFiles: ["Tender_All_Documents.zip"],
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(
    path.join(tenderFolder, "chatgpt-state.json"),
    JSON.stringify(
      {
        t247Id: options.t247Id,
        status: "completed",
        submissionConfirmed: true,
        chatUrl: "https://chatgpt.com/c/abc123",
        phase: "COMPLETED",
      },
      null,
      2,
    ),
    "utf8",
  );

  if (options.withHash !== false) {
    const fp = computeQualificationInputFingerprint({
      dateFolder: options.dateFolder,
      sourceTenderId: options.t247Id,
    });
    saveQualificationInputFingerprint(tenderFolder, fp);
  }

  return tenderFolder;
}

describe("existing qualification reuse", () => {
  it("fresh run never reuses existing VERIFY", () => {
    const dateFolder = makeDateFolder();
    seedReadyTender({ dateFolder, t247Id: "102221347", status: "VERIFY" });

    const decision = evaluateExistingQualificationReuse({
      dateFolder,
      sourceTenderId: "102221347",
      resumeMode: false,
    });

    assert.equal(decision.found, true);
    assert.equal(decision.reuse, false);
    assert.equal(decision.reason, "FRESH_RUN_NO_REUSE");
  });

  it("resume reuses when input hash matches", () => {
    const dateFolder = makeDateFolder();
    seedReadyTender({
      dateFolder,
      t247Id: "102667034",
      status: "VERIFY",
      withHash: true,
    });

    const decision = evaluateExistingQualificationReuse({
      dateFolder,
      sourceTenderId: "102667034",
      resumeMode: true,
    });

    assert.equal(decision.reuse, true);
    assert.equal(decision.inputHashMatch, true);
    assert.equal(decision.reason, "EXISTING_VALID_QUALIFICATION");
  });

  it("resume does not skip when ZIP hash changed", () => {
    const dateFolder = makeDateFolder();
    const tenderFolder = seedReadyTender({
      dateFolder,
      t247Id: "103114493",
      status: "GO",
      withHash: true,
      zipMarker: "zip-v1",
    });

    // Change documents after fingerprint was stored.
    fs.writeFileSync(
      path.join(tenderFolder, "documents", "Tender_All_Documents.zip"),
      minimalZip("zip-CHANGED"),
    );

    const decision = evaluateExistingQualificationReuse({
      dateFolder,
      sourceTenderId: "103114493",
      resumeMode: true,
    });

    assert.equal(decision.reuse, false);
    assert.equal(decision.stale, true);
    assert.equal(decision.inputHashMatch, false);
    assert.equal(decision.reason, "EXISTING_STALE_INPUT");
  });

  it("resume does not skip when stored input hash is missing", () => {
    const dateFolder = makeDateFolder();
    seedReadyTender({
      dateFolder,
      t247Id: "999000111",
      status: "VERIFY",
      withHash: false,
    });

    const decision = evaluateExistingQualificationReuse({
      dateFolder,
      sourceTenderId: "999000111",
      resumeMode: true,
    });

    assert.equal(decision.reuse, false);
    assert.equal(decision.reason, "EXISTING_MISSING_INPUT_HASH");
  });
});

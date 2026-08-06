import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeQualificationResult,
  normalizeTenderDecisionStatus,
  passesStatusSpecificValidation,
  validateQualificationResult,
} from "../qualificationSchema.js";
import {
  TENDER_DECISION_LABELS,
  type QualificationResult,
} from "../types.js";

function base(partial: Partial<QualificationResult>): QualificationResult {
  return {
    t247Id: "102027195",
    company: "Siyana Info Solutions Pvt. Ltd.",
    status: "GO",
    decisionLabel: "",
    verdict: "Suitable",
    reason: "All mandatory gates pass.",
    requiredAction: "",
    confidence: 0.9,
    matchedCriteria: ["Turnover"],
    failedCriteria: [],
    unclearCriteria: [],
    missingDocuments: [],
    conditions: [],
    partnershipRequiredFor: [],
    partnershipModeAllowed: [],
    manualReviewRequired: false,
    ...partial,
  };
}

test("normalizeTenderDecisionStatus maps canonical and legacy statuses", () => {
  assert.equal(normalizeTenderDecisionStatus("GO"), "GO");
  assert.equal(normalizeTenderDecisionStatus("CONDITIONAL GO"), "CONDITIONAL_GO");
  assert.equal(normalizeTenderDecisionStatus("PARTNER BID"), "PARTNER_BID");
  assert.equal(normalizeTenderDecisionStatus("VERIFY"), "VERIFY");
  assert.equal(normalizeTenderDecisionStatus("NO-GO"), "NO_GO");
  assert.equal(normalizeTenderDecisionStatus("WILL_BID"), "GO");
  assert.equal(normalizeTenderDecisionStatus("NO_BID"), "NO_GO");
  assert.equal(normalizeTenderDecisionStatus("PARTNERSHIP"), "PARTNER_BID");
  assert.equal(normalizeTenderDecisionStatus("MAY_BID"), "VERIFY");
});

test("display labels are generated correctly", () => {
  assert.equal(TENDER_DECISION_LABELS.GO, "GO");
  assert.equal(TENDER_DECISION_LABELS.CONDITIONAL_GO, "CONDITIONAL GO");
  assert.equal(TENDER_DECISION_LABELS.PARTNER_BID, "PARTNER BID");
  assert.equal(TENDER_DECISION_LABELS.VERIFY, "VERIFY");
  assert.equal(TENDER_DECISION_LABELS.NO_GO, "NO-GO");
});

test("GO with all mandatory criteria passed", () => {
  const validated = validateQualificationResult(
    base({
      status: "GO",
      matchedCriteria: ["Eligibility", "Scope", "Time"],
      failedCriteria: [],
      unclearCriteria: [],
      missingDocuments: [],
      conditions: [],
      partnershipRequiredFor: [],
      manualReviewRequired: false,
    }),
    "102027195",
  );
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.result.status, "GO");
    assert.equal(validated.result.decisionLabel, "GO");
    assert.match(
      validated.result.requiredAction,
      /Start bid preparation/i,
    );
  }
});

test("CONDITIONAL_GO with owner/action/due date", () => {
  const validated = validateQualificationResult(
    base({
      status: "CONDITIONAL_GO",
      reason: "Affidavit required before bid lock.",
      conditions: [
        {
          condition: "Prepare affidavit",
          action: "Draft and notarize affidavit",
          owner: "Legal",
          dueDate: "2026-08-10",
        },
      ],
    }),
    "102027195",
  );
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.result.status, "CONDITIONAL_GO");
    assert.equal(validated.result.decisionLabel, "CONDITIONAL GO");
    assert.equal(validated.result.conditions.length, 1);
  }
});

test("CONDITIONAL_GO without conditions becomes VERIFY", () => {
  const finalized = finalizeQualificationResult(
    base({
      status: "CONDITIONAL_GO",
      conditions: [],
      unclearCriteria: [],
    }),
  );
  assert.equal(finalized.status, "VERIFY");
  assert.equal(finalized.decisionLabel, "VERIFY");
  assert.equal(finalized.manualReviewRequired, true);
});

test("PARTNER_BID when JV is expressly allowed", () => {
  const validated = validateQualificationResult(
    base({
      status: "PARTNER_BID",
      reason: "Siyana lacks OEM authorization; JV permitted.",
      partnershipRequiredFor: ["OEM authorization"],
      partnershipModeAllowed: ["JV"],
    }),
    "102027195",
  );
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.result.status, "PARTNER_BID");
    assert.equal(validated.result.decisionLabel, "PARTNER BID");
  }
});

test("material gap without partner permission becomes NO_GO", () => {
  const finalized = finalizeQualificationResult(
    base({
      status: "PARTNER_BID",
      reason: "Gap exists but tender forbids consortium.",
      partnershipRequiredFor: ["Turnover"],
      partnershipModeAllowed: [],
    }),
  );
  assert.equal(finalized.status, "NO_GO");
  assert.equal(finalized.decisionLabel, "NO-GO");
});

test("VERIFY for missing RFP/corrigendum/company evidence", () => {
  const validated = validateQualificationResult(
    base({
      status: "VERIFY",
      reason: "Detailed RFP missing from archive.",
      missingDocuments: ["RFP"],
      unclearCriteria: [],
      manualReviewRequired: true,
    }),
    "102027195",
  );
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.result.status, "VERIFY");
    assert.equal(validated.result.manualReviewRequired, true);
    assert.match(validated.result.requiredAction, /Hold the decision/i);
  }
});

test("NO_GO for a mandatory failure", () => {
  const validated = validateQualificationResult(
    base({
      status: "NO_GO",
      reason: "Average turnover below mandatory threshold.",
      failedCriteria: ["Minimum turnover INR 20 crore"],
      manualReviewRequired: false,
    }),
    "102027195",
  );
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.result.status, "NO_GO");
    assert.equal(validated.result.decisionLabel, "NO-GO");
  }
});

test("old WILL_BID maps to GO", () => {
  const validated = validateQualificationResult(
    {
      t247Id: "102027195",
      company: "Siyana Info Solutions Pvt. Ltd.",
      status: "WILL_BID",
      verdict: "Qualified",
      reason: "All criteria met.",
      confidence: 0.8,
      matchedCriteria: ["A"],
      failedCriteria: [],
      unclearCriteria: [],
      missingDocuments: [],
      partnershipRequiredFor: [],
      manualReviewRequired: false,
    },
    "102027195",
  );
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.result.status, "GO");
    assert.equal(validated.result.decisionLabel, "GO");
  }
});

test("old NO_BID maps to NO_GO", () => {
  assert.equal(normalizeTenderDecisionStatus("NO_BID"), "NO_GO");
  const validated = validateQualificationResult(
    {
      t247Id: "102027195",
      status: "NO_BID",
      verdict: "Not qualified",
      reason: "Mandatory turnover failure.",
      confidence: 0.9,
      failedCriteria: ["Turnover"],
      matchedCriteria: [],
      unclearCriteria: [],
      missingDocuments: [],
      partnershipRequiredFor: [],
      manualReviewRequired: false,
    },
    "102027195",
  );
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.result.status, "NO_GO");
    assert.equal(validated.result.decisionLabel, "NO-GO");
  }
});

test("old PARTNERSHIP maps to PARTNER_BID", () => {
  const validated = validateQualificationResult(
    {
      t247Id: "102027195",
      status: "PARTNERSHIP",
      verdict: "Partner required",
      reason: "Siyana lacks experience; JV allowed.",
      confidence: 0.7,
      failedCriteria: [],
      matchedCriteria: [],
      unclearCriteria: [],
      missingDocuments: [],
      partnershipRequiredFor: ["Experience"],
      partnershipModeAllowed: ["Consortium"],
      manualReviewRequired: false,
    },
    "102027195",
  );
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.result.status, "PARTNER_BID");
    assert.equal(validated.result.decisionLabel, "PARTNER BID");
  }
});

test("old MAY_BID maps to VERIFY", () => {
  const validated = validateQualificationResult(
    {
      t247Id: "102027195",
      status: "MAY_BID",
      verdict: "Needs review",
      reason: "RFP incomplete.",
      confidence: 0.5,
      failedCriteria: [],
      matchedCriteria: [],
      unclearCriteria: ["Eligibility clause unclear"],
      missingDocuments: ["Corrigendum"],
      partnershipRequiredFor: [],
      manualReviewRequired: true,
    },
    "102027195",
  );
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.result.status, "VERIFY");
    assert.equal(validated.result.decisionLabel, "VERIFY");
    assert.equal(validated.result.manualReviewRequired, true);
  }
});

test("passesStatusSpecificValidation rejects incomplete CONDITIONAL_GO", () => {
  const check = passesStatusSpecificValidation(
    base({
      status: "CONDITIONAL_GO",
      decisionLabel: "CONDITIONAL GO",
      requiredAction: "Proceed",
      conditions: [{ condition: "x", action: "", owner: "", dueDate: "" }],
    }),
  );
  assert.equal(check.ok, false);
});

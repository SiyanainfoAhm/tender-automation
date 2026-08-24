import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QualificationResult } from "../../chatgptQualification/types.js";
import { qualificationStatusForSupabasePersist, agentQualificationStatusForDatabase } from "../persistQualification.js";

function baseResult(
  overrides: Partial<QualificationResult>,
): QualificationResult {
  return {
    t247Id: "103448921",
    company: "Siyana",
    status: "GO",
    decisionLabel: "GO",
    verdict: "ok",
    reason: "Fits scope",
    requiredAction: "Prepare bid",
    confidence: 0.9,
    matchedCriteria: ["scope"],
    failedCriteria: [],
    unclearCriteria: [],
    missingDocuments: [],
    conditions: [],
    partnershipRequiredFor: [],
    partnershipModeAllowed: [],
    manualReviewRequired: false,
    ...overrides,
  };
}

describe("qualificationStatusForSupabasePersist", () => {
  it("maps agent Will Bid / GO to May Bid / CONDITIONAL_GO", () => {
    const out = qualificationStatusForSupabasePersist(
      baseResult({ status: "GO", decisionLabel: "GO" }),
    );
    assert.equal(out.status, "CONDITIONAL_GO");
    assert.equal(out.remappedFromWillBid, true);
    assert.equal(out.remappedFromNoBid, false);
    assert.equal(out.manualReviewRequired, true);
    assert.match(out.reason, /stored as May Bid/);
    assert.equal(
      (out.rawResult as { supabaseStatusRemap?: string }).supabaseStatusRemap,
      "GO_TO_CONDITIONAL_GO",
    );
  });

  it("keeps PARTNER_BID and VERIFY unchanged", () => {
    assert.equal(
      qualificationStatusForSupabasePersist(
        baseResult({ status: "PARTNER_BID", decisionLabel: "PARTNER BID" }),
      ).status,
      "PARTNER_BID",
    );
    assert.equal(
      qualificationStatusForSupabasePersist(
        baseResult({
          status: "VERIFY",
          decisionLabel: "VERIFY",
          manualReviewRequired: true,
          unclearCriteria: ["need clarification"],
          requiredAction: "Review",
        }),
      ).status,
      "VERIFY",
    );
  });

  it("stores ChatGPT No Bid / NO_GO as VERIFY in Supabase", () => {
    const out = qualificationStatusForSupabasePersist(
      baseResult({
        status: "NO_GO",
        decisionLabel: "NO-GO",
        reason: "Outside preferred geography",
        failedCriteria: ["geography"],
        requiredAction: "Close tender",
        manualReviewRequired: false,
      }),
    );
    assert.equal(out.status, "VERIFY");
    assert.equal(out.decisionLabel, "VERIFY");
    assert.equal(out.remappedFromNoBid, true);
    assert.equal(out.manualReviewRequired, true);
    assert.match(out.reason, /ChatGPT returned No Bid/);
    assert.match(out.reason, /Outside preferred geography/);
    assert.deepEqual(out.unclearCriteria, ["geography"]);
    assert.equal(
      (out.rawResult as { chatgptOriginalStatus?: string }).chatgptOriginalStatus,
      "NO_GO",
    );
    assert.equal(
      (out.rawResult as { supabaseStatusRemap?: string }).supabaseStatusRemap,
      "NO_GO_TO_VERIFY",
    );
  });
});

describe("agentQualificationStatusForDatabase", () => {
  it("maps agent Will Bid to May Bid", () => {
    assert.equal(agentQualificationStatusForDatabase("GO"), "CONDITIONAL_GO");
    assert.equal(agentQualificationStatusForDatabase("WILL_BID"), "CONDITIONAL_GO");
  });

  it("keeps May Bid and Verify from the agent", () => {
    assert.equal(
      agentQualificationStatusForDatabase("CONDITIONAL_GO"),
      "CONDITIONAL_GO",
    );
    assert.equal(agentQualificationStatusForDatabase("VERIFY"), "VERIFY");
  });

  it("does not overwrite a manually set Will Bid", () => {
    assert.equal(
      agentQualificationStatusForDatabase("CONDITIONAL_GO", "GO"),
      "GO",
    );
    assert.equal(agentQualificationStatusForDatabase("VERIFY", "GO"), "GO");
    assert.equal(agentQualificationStatusForDatabase("GO", "GO"), "GO");
  });
});

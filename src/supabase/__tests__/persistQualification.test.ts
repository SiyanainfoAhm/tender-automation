import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QualificationResult } from "../../chatgptQualification/types.js";
import { qualificationStatusForSupabasePersist } from "../persistQualification.js";

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
  it("keeps Will Bid / GO unchanged", () => {
    const out = qualificationStatusForSupabasePersist(
      baseResult({ status: "GO", decisionLabel: "GO" }),
    );
    assert.equal(out.status, "GO");
    assert.equal(out.remappedFromNoBid, false);
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

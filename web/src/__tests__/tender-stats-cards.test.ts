import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Card → URL status mapping used by TenderStatsCards.
 * Kept as a pure module mirror so filters stay aligned with tender-status.ts.
 */
const CARD_STATUS_FILTERS = {
  totalTenders: undefined,
  verify: "verify",
  underEvaluation: "under_evaluation",
  willBid: "will_bid",
  mayBid: "may_bid",
  noBid: "no_bid",
  duplicate: "duplicate",
  partnership: "partnership",
  submitted: "submitted",
  won: "won",
} as const;

function isCardActive(
  cardKey: keyof typeof CARD_STATUS_FILTERS,
  activeStatus: string | undefined,
): boolean {
  const current =
    !activeStatus || activeStatus === "ALL" ? undefined : activeStatus;
  if (cardKey === "totalTenders") return current === undefined;
  return current === CARD_STATUS_FILTERS[cardKey];
}

describe("tender stats card status mapping", () => {
  it("treats Total as active when no status filter", () => {
    assert.equal(isCardActive("totalTenders", "ALL"), true);
    assert.equal(isCardActive("totalTenders", undefined), true);
    assert.equal(isCardActive("verify", "ALL"), false);
  });

  it("activates only the matching status card", () => {
    assert.equal(isCardActive("verify", "verify"), true);
    assert.equal(isCardActive("willBid", "will_bid"), true);
    assert.equal(isCardActive("mayBid", "may_bid"), true);
    assert.equal(isCardActive("noBid", "no_bid"), true);
    assert.equal(isCardActive("underEvaluation", "under_evaluation"), true);
    assert.equal(isCardActive("totalTenders", "verify"), false);
    assert.equal(isCardActive("willBid", "verify"), false);
  });

  it("maps UI cards to filter values used by listTenders", () => {
    assert.equal(CARD_STATUS_FILTERS.verify, "verify");
    assert.equal(CARD_STATUS_FILTERS.willBid, "will_bid");
    assert.equal(CARD_STATUS_FILTERS.mayBid, "may_bid");
    assert.equal(CARD_STATUS_FILTERS.noBid, "no_bid");
    assert.equal(CARD_STATUS_FILTERS.underEvaluation, "under_evaluation");
  });
});

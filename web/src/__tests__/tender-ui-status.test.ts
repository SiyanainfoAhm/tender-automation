import { describe, expect, it } from "vitest";

import {
  getTenderUiStatus,
  qualificationStatusesForFilter,
  tenderUiStatusLabel,
} from "@/lib/tender-status";

describe("tender UI status mapping", () => {
  it("maps VERIFY / CONDITIONAL_GO / null into pipeline buckets", () => {
    expect(getTenderUiStatus("VERIFY")).toBe("verify");
    expect(getTenderUiStatus("CONDITIONAL_GO")).toBe("may_bid");
    expect(getTenderUiStatus("MAY_BID")).toBe("may_bid");
    expect(tenderUiStatusLabel("VERIFY")).toBe("Verify");
    expect(tenderUiStatusLabel("CONDITIONAL_GO")).toBe("May Bid");
    expect(getTenderUiStatus(null)).toBe("under_evaluation");
  });

  it("keeps partnership, will bid, won and no bid distinct", () => {
    expect(getTenderUiStatus("GO")).toBe("will_bid");
    expect(getTenderUiStatus("PARTNER_BID")).toBe("partnership");
    expect(getTenderUiStatus("NO_GO")).toBe("no_bid");
    expect(getTenderUiStatus("WON")).toBe("won");
    expect(getTenderUiStatus("LOST")).toBe("lost");
    expect(getTenderUiStatus("DISQUALIFIED")).toBe("disqualified");
    expect(getTenderUiStatus("CANCELLED")).toBe("cancelled");
    expect(tenderUiStatusLabel("CANCELLED")).toBe("Tender cancelled");
    expect(tenderUiStatusLabel("DISQUALIFIED")).toBe("Disqualified");
    expect(tenderUiStatusLabel("LOST")).toBe("Lost");
  });

  it("expands status filters to the correct DB values", () => {
    expect(qualificationStatusesForFilter("screening")).toEqual({
      kind: "in",
      values: ["VERIFY", "CONDITIONAL_GO"],
    });
    expect(qualificationStatusesForFilter("verify")).toEqual({
      kind: "in",
      values: ["VERIFY"],
    });
    expect(qualificationStatusesForFilter("may_bid")).toEqual({
      kind: "in",
      values: ["CONDITIONAL_GO"],
    });
    expect(qualificationStatusesForFilter("won")).toEqual({
      kind: "in",
      values: ["WON"],
    });
    expect(qualificationStatusesForFilter("GO")).toEqual({
      kind: "in",
      values: ["GO"],
    });
    expect(qualificationStatusesForFilter("cancelled")).toEqual({
      kind: "in",
      values: ["CANCELLED"],
    });
    expect(qualificationStatusesForFilter("lost")).toEqual({
      kind: "in",
      values: ["LOST"],
    });
    expect(qualificationStatusesForFilter("disqualified")).toEqual({
      kind: "in",
      values: ["DISQUALIFIED"],
    });
    expect(qualificationStatusesForFilter("under_evaluation")).toEqual({
      kind: "null",
    });
  });
});

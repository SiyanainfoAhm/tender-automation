import { describe, expect, it } from "vitest";

import {
  getTenderUiStatus,
  qualificationStatusesForFilter,
  tenderUiStatusLabel,
} from "@/lib/tender-status";

describe("tender UI status mapping", () => {
  it("maps VERIFY and CONDITIONAL_GO to Screening without a May Bid bucket", () => {
    expect(getTenderUiStatus("VERIFY")).toBe("screening");
    expect(getTenderUiStatus("CONDITIONAL_GO")).toBe("screening");
    expect(getTenderUiStatus("MAY_BID")).toBe("screening");
    expect(tenderUiStatusLabel("VERIFY")).toBe("Screening");
    expect(tenderUiStatusLabel("CONDITIONAL_GO")).toBe("Screening");
  });

  it("keeps partnership, will bid and no bid distinct", () => {
    expect(getTenderUiStatus("GO")).toBe("will_bid");
    expect(getTenderUiStatus("PARTNER_BID")).toBe("partnership");
    expect(getTenderUiStatus("NO_GO")).toBe("no_bid");
    expect(getTenderUiStatus(null)).toBe("not_evaluated");
  });

  it("expands the Screening filter to VERIFY + CONDITIONAL_GO", () => {
    expect(qualificationStatusesForFilter("screening")).toEqual({
      kind: "in",
      values: ["VERIFY", "CONDITIONAL_GO"],
    });
    expect(qualificationStatusesForFilter("VERIFY")).toEqual({
      kind: "in",
      values: ["VERIFY"],
    });
    expect(qualificationStatusesForFilter("GO")).toEqual({
      kind: "in",
      values: ["GO"],
    });
  });
});

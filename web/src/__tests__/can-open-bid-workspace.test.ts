import { describe, expect, it } from "vitest";

import { canOpenBidWorkspace } from "@/lib/tender-status";

describe("canOpenBidWorkspace", () => {
  it("allows only Will Bid (GO)", () => {
    expect(canOpenBidWorkspace("GO")).toBe(true);
    expect(canOpenBidWorkspace("CONDITIONAL_GO")).toBe(false);
    expect(canOpenBidWorkspace("VERIFY")).toBe(false);
    expect(canOpenBidWorkspace("NO_GO")).toBe(false);
    expect(canOpenBidWorkspace("SUBMITTED")).toBe(false);
    expect(canOpenBidWorkspace(null)).toBe(false);
  });
});

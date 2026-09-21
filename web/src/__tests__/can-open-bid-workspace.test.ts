import { describe, expect, it } from "vitest";

import { canOpenBidWorkspace } from "@/lib/tender-status";

describe("canOpenBidWorkspace", () => {
  it("allows Will Bid and later outcomes", () => {
    expect(canOpenBidWorkspace("GO")).toBe(true);
    expect(canOpenBidWorkspace("SUBMITTED")).toBe(true);
    expect(canOpenBidWorkspace("WON")).toBe(true);
    expect(canOpenBidWorkspace("LOST")).toBe(true);
    expect(canOpenBidWorkspace("CANCELLED")).toBe(true);
    expect(canOpenBidWorkspace("CONDITIONAL_GO")).toBe(false);
    expect(canOpenBidWorkspace("VERIFY")).toBe(false);
    expect(canOpenBidWorkspace("NO_GO")).toBe(false);
    expect(canOpenBidWorkspace(null)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  currentFinancialYearKey,
  financialYearBounds,
  financialYearMonths,
  parseFinancialYearKey,
} from "@/lib/reports/financial-year";
import { computeFunnelConversions, winRate } from "@/lib/reports/funnel";

describe("financial year", () => {
  it("parses FY keys and uses Apr–Mar bounds", () => {
    expect(parseFinancialYearKey("FY 2025-26")).toBe("2025-26");
    expect(parseFinancialYearKey("2025-26")).toBe("2025-26");
    const bounds = financialYearBounds("2025-26");
    expect(bounds.from.getFullYear()).toBe(2025);
    expect(bounds.from.getMonth()).toBe(3);
    expect(bounds.toExclusive.getFullYear()).toBe(2026);
    expect(bounds.toExclusive.getMonth()).toBe(3);
    expect(financialYearMonths("2025-26")).toHaveLength(12);
    expect(financialYearMonths("2025-26")[0]?.label).toBe("Apr 2025");
    expect(financialYearMonths("2025-26")[11]?.label).toBe("Mar 2026");
  });

  it("defaults to the current Indian FY", () => {
    expect(currentFinancialYearKey(new Date("2026-08-17"))).toBe("2026-27");
    expect(currentFinancialYearKey(new Date("2026-03-31"))).toBe("2025-26");
  });
});

describe("funnel conversions", () => {
  it("never exceeds 100% for sequential subsets", () => {
    const conversions = computeFunnelConversions({
      new: 10,
      screening: 8,
      mayBid: 5,
      willBid: 4,
      submitted: 4,
      won: 2,
    });
    for (const item of conversions) {
      expect(item.rate == null || item.rate <= 100).toBe(true);
    }
    const submittedToWon = conversions.find((c) => c.key === "submitted_won");
    expect(submittedToWon?.rate).toBeCloseTo((2 / 6) * 100);
  });

  it("does not invent 150% submitted→won", () => {
    const conversions = computeFunnelConversions({
      new: 10,
      screening: 2,
      mayBid: 1,
      willBid: 1,
      submitted: 4,
      won: 6,
    });
    const submittedToWon = conversions.find((c) => c.key === "submitted_won")!;
    expect(submittedToWon.rate).toBeLessThanOrEqual(100);
    expect(submittedToWon.rate).toBeCloseTo(60);
  });
});

describe("win rate", () => {
  it("uses won / (won + lost) and returns null when undecided", () => {
    expect(winRate(2, 3)).toBeCloseTo(40);
    expect(winRate(0, 0)).toBeNull();
  });
});

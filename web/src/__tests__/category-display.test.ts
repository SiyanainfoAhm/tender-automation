import { describe, expect, it } from "vitest";

import {
  buildTopCategories,
  compactTenderCount,
  formatDecisionStatus,
  normalizeCategoryDisplay,
  resolveAnalyticsCategory,
  truncateCategoryLabel,
} from "@/lib/analytics/category-display";

describe("normalizeCategoryDisplay", () => {
  it("maps Software and IT Solutions to compact label", () => {
    expect(normalizeCategoryDisplay("Software and IT Solutions")).toBe(
      "Software & IT Solutions",
    );
    expect(normalizeCategoryDisplay("software and it solutions")).toBe(
      "Software & IT Solutions",
    );
  });

  it("maps blank to Uncategorized", () => {
    expect(normalizeCategoryDisplay(null)).toBe("Uncategorized");
    expect(normalizeCategoryDisplay("")).toBe("Uncategorized");
    expect(normalizeCategoryDisplay("   ")).toBe("Uncategorized");
  });
});

describe("resolveAnalyticsCategory", () => {
  it("never uses tender title as category", () => {
    expect(
      resolveAnalyticsCategory({
        source_portal: "TENDER247",
        category: "Microsoft Office LTSC Professional Plus 2024",
        title: "Microsoft Office LTSC Professional Plus 2024",
      }),
    ).toBe("Uncategorized");
  });

  it("uses BidAssist portal category, not GEM product labels", () => {
    expect(
      resolveAnalyticsCategory({
        source_portal: "BIDASSIST",
        category: "Annual Maintenance Service - Desktops, Laptops...",
        title: "Some tender title",
      }),
    ).toBe("Software & IT Solutions");
  });

  it("prefers normalized_category over category", () => {
    expect(
      resolveAnalyticsCategory({
        source_portal: "TENDER247",
        normalized_category: "IT Services",
        category: "Garbage title-like value",
      }),
    ).toBe("IT Services");
  });

  it("blank category becomes Uncategorized", () => {
    expect(
      resolveAnalyticsCategory({
        source_portal: "TENDER247",
        category: null,
      }),
    ).toBe("Uncategorized");
  });
});

describe("buildTopCategories", () => {
  it("keeps at most 6 bars and rolls remaining into Other", () => {
    const counts = new Map<string, number>([
      ["A", 10],
      ["B", 9],
      ["C", 8],
      ["D", 7],
      ["E", 6],
      ["F", 5],
      ["G", 4],
      ["H", 3],
    ]);
    const top = buildTopCategories(counts, 6);
    expect(top).toHaveLength(6);
    expect(top[5]?.fullName).toBe("Other");
    expect(top[5]?.count).toBe(12);
    expect(top.every((row) => !/Annual Maintenance|Microsoft Office/i.test(row.fullName))).toBe(
      true,
    );
  });

  it("truncates long labels while preserving fullName", () => {
    const long = "A".repeat(40);
    const top = buildTopCategories(new Map([[long, 2]]), 6);
    expect(top[0]?.name).toBe(truncateCategoryLabel(long));
    expect(top[0]?.fullName).toBe(long);
  });
});

describe("formatDecisionStatus / compactTenderCount", () => {
  it("formats status enums for display", () => {
    expect(formatDecisionStatus("NO_GO")).toBe("NO-GO");
    expect(formatDecisionStatus("CONDITIONAL_GO")).toBe("CONDITIONAL GO");
    expect(formatDecisionStatus("PARTNER_BID")).toBe("PARTNER BID");
    expect(formatDecisionStatus("NOT_EVALUATED")).toBe("Not evaluated");
  });

  it("formats tender counts", () => {
    expect(compactTenderCount(1)).toBe("1 tender");
    expect(compactTenderCount(6)).toBe("6 tenders");
  });
});

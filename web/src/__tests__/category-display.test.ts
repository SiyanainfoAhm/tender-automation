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
  it("never uses tender title or GEM product labels as category", () => {
    expect(
      resolveAnalyticsCategory({
        source_portal: "TENDER247",
        category: "Microsoft Office LTSC Professional Plus 2024",
        title: "Microsoft Office LTSC Professional Plus 2024",
      }),
    ).toBe("Other");
  });

  it("uses stored project_category instead of BidAssist GEM labels", () => {
    expect(
      resolveAnalyticsCategory({
        source_portal: "BIDASSIST",
        project_category: "Support / AMC / Maintenance",
        category: "Annual Maintenance Service - Desktops, Laptops...",
        title: "Some tender title",
      }),
    ).toBe("Support / AMC / Maintenance");
  });

  it("prefers project_category over raw category", () => {
    expect(
      resolveAnalyticsCategory({
        source_portal: "TENDER247",
        project_category: "Custom Software",
        category: "Garbage title-like value",
      }),
    ).toBe("Custom Software");
  });

  it("blank project category becomes Other", () => {
    expect(
      resolveAnalyticsCategory({
        source_portal: "TENDER247",
        category: null,
      }),
    ).toBe("Other");
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
    expect(formatDecisionStatus("NO_GO")).toBe("No Bid");
    expect(formatDecisionStatus("CONDITIONAL_GO")).toBe("May Bid");
    expect(formatDecisionStatus("PARTNER_BID")).toBe("Partnership");
    expect(formatDecisionStatus("NOT_EVALUATED")).toBe("Under Evaluation");
    expect(formatDecisionStatus("CANCELLED")).toBe("Tender cancelled");
  });

  it("formats tender counts", () => {
    expect(compactTenderCount(1)).toBe("1 tender");
    expect(compactTenderCount(6)).toBe("6 tenders");
  });
});

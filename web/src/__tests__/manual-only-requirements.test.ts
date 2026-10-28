import { describe, expect, it } from "vitest";

import { calculateSectionProgress, isManualOnlyRequirement } from "@/lib/bid-checklist";
import { checklistWorkCategory } from "@/lib/will-bid";

describe("manual-only fee / EMD / BOQ requirements", () => {
  it.each([
    "Tender fee (Tender Cost)",
    "Tender fees receipt",
    "Processing Fee payment",
    "EMD Detail",
    "Earnest Money Deposit (EMD)",
    "EMD / Bid Security (FDR or BG)",
    "Financial bid - BOQ rate",
    "Price breakup with GST bifurcation and HSN code",
    "Financial Proposal (separate password-protected file)",
    "Price Bid in MahaTender BOQ template (Annexure II)",
  ])("treats %s as manual only", (name) => {
    expect(isManualOnlyRequirement(name)).toBe(true);
    expect(
      checklistWorkCategory({
        requirementName: name,
        processingType: "AI_DRAFT",
        generationAllowed: true,
        matchedDocumentSource: "TENDER",
      }),
    ).toBe("manual");
  });

  it.each([
    "Bidder Turnover Certificate",
    "Bidding capacity calculation",
    "NSIC / SSI Registration Certificate (for EMD exemption)",
    "Annexure-II Undertaking (terms acceptance, performance security within 15 days)",
    "Technical Bid - required contents",
    "Self-declaration of not being blacklisted / debarred",
  ])("keeps %s automatic", (name) => {
    expect(isManualOnlyRequirement(name)).toBe(false);
  });
});

describe("checklist progress", () => {
  it("counts an item with an attached document as finished", () => {
    const progress = calculateSectionProgress([
      { mandatory: true, category: "COMPLIANCE", completionStatus: "ACTION_REQUIRED", isCompleted: true },
      { mandatory: true, category: "COMPLIANCE", completionStatus: "MISSING", isCompleted: false },
    ]);
    expect(progress).toEqual({ completed: 1, total: 2, percent: 50 });
  });
});

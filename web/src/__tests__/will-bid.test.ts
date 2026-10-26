import { describe, expect, it } from "vitest";
import { checklistWorkCategory } from "@/lib/will-bid";
import { APP_MAIN_NAV } from "@/components/layout/nav-items";
describe("Will Bid", () => {
  it("places its permission-controlled live badge immediately after Bid Fees", () => {
    const index = APP_MAIN_NAV.findIndex((item) => item.href === "/bid-fees");
    expect(APP_MAIN_NAV[index + 1]).toMatchObject({ href: "/will-bid", permission: "bids.view", showCount: true, countKey: "willBidTenders" });
  });
  it.each([
    ["COMPANY_DOC", true, "TENDER", "company"],
    ["AI_DRAFT", false, "COMPANY", "ai"],
    ["MANUAL_ENTRY", true, "COMPANY", "manual"],
    [null, true, null, "ai"],
    [null, false, "COMPANY", "company"],
    [null, false, null, "manual"],
  ])("uses persisted classification before legacy fallbacks (%s)", (processingType, generationAllowed, matchedDocumentSource, expected) => {
    expect(checklistWorkCategory({ processingType: processingType as string | null, generationAllowed: generationAllowed as boolean, matchedDocumentSource: matchedDocumentSource as string | null })).toBe(expected);
  });
});

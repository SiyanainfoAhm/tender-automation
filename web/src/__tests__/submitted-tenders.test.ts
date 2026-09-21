import { describe, expect, it } from "vitest";

import {
  isSubmittedOutcomeStatus,
  summarizeSubmittedTenders,
  type SubmittedTenderListItem,
} from "@/lib/submitted-tenders";

function item(
  partial: Partial<SubmittedTenderListItem> & {
    id: string;
    qualificationStatus: string;
  },
): SubmittedTenderListItem {
  return {
    title: "Tender",
    referenceNo: null,
    organization: null,
    portal: null,
    sourceRegion: null,
    location: null,
    closingDate: null,
    tenderValue: null,
    submittedAt: null,
    submissionReference: null,
    lostReason: null,
    wonProjectId: null,
    updatedAt: null,
    ...partial,
  };
}

describe("submitted tenders helpers", () => {
  it("summarizes outcomes", () => {
    const summary = summarizeSubmittedTenders([
      item({ id: "1", qualificationStatus: "SUBMITTED" }),
      item({ id: "2", qualificationStatus: "WON" }),
      item({ id: "3", qualificationStatus: "LOST", lostReason: "Price" }),
      item({ id: "4", qualificationStatus: "GO" }),
    ]);
    expect(summary).toEqual({
      total: 4,
      submitted: 2,
      won: 1,
      lost: 1,
    });
  });

  it("recognizes outcome statuses", () => {
    expect(isSubmittedOutcomeStatus("SUBMITTED")).toBe(true);
    expect(isSubmittedOutcomeStatus("won")).toBe(true);
    expect(isSubmittedOutcomeStatus("GO")).toBe(false);
  });
});

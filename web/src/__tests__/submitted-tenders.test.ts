import { describe, expect, it } from "vitest";

import {
  isSubmittedOutcomeStatus,
  normalizeL1QcbsMethod,
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
    tenderType: null,
    evaluationMethod: null,
    scrapedDate: null,
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
      duplicate: 0,
    });
  });

  it("counts duplicate status separately from awaiting", () => {
    const summary = summarizeSubmittedTenders([
      item({ id: "1", qualificationStatus: "SUBMITTED" }),
      item({ id: "2", qualificationStatus: "DUPLICATE" }),
      item({ id: "3", qualificationStatus: "CANCELLED" }),
    ]);
    expect(summary).toEqual({
      total: 3,
      submitted: 1,
      won: 0,
      lost: 0,
      duplicate: 1,
    });
  });

  it("recognizes outcome statuses", () => {
    expect(isSubmittedOutcomeStatus("SUBMITTED")).toBe(true);
    expect(isSubmittedOutcomeStatus("won")).toBe(true);
    expect(isSubmittedOutcomeStatus("DUPLICATE")).toBe(true);
    expect(isSubmittedOutcomeStatus("GO")).toBe(false);
  });

  it("normalizes L1 / QCBS tender types", () => {
    expect(normalizeL1QcbsMethod("L1")).toBe("L1");
    expect(normalizeL1QcbsMethod("l1-lowest-bidder")).toBe("L1");
    expect(normalizeL1QcbsMethod("QCBS")).toBe("QCBS");
    expect(normalizeL1QcbsMethod("qcbs-qcbc")).toBe("QCBS");
    expect(normalizeL1QcbsMethod("not-disclosed")).toBeNull();
    expect(normalizeL1QcbsMethod(null)).toBeNull();
  });
});

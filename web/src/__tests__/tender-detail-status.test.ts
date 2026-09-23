import { describe, expect, it } from "vitest";

import { isTenderStatus } from "@/lib/tender-classification";
import {
  resolveDisplayedDetailStatus,
  TENDER_STATUSES,
  tenderDetailStatusChoices,
  type TenderStatus,
} from "@/lib/tender-status";

/**
 * Mirrors mapTenderDetail status resolution — tender column wins over
 * qualification_results so detail matches Tender Management list.
 */
function resolveDetailQualificationStatus(options: {
  tenderQualificationStatus: unknown;
  effectiveQualificationStatus?: unknown;
  qualificationResultStatus?: unknown;
}): TenderStatus | null {
  const asString = (value: unknown): string | null => {
    if (value == null) return null;
    const text = String(value).trim();
    return text || null;
  };
  const qualStatus =
    (asString(options.tenderQualificationStatus) as TenderStatus | null) ??
    (asString(options.effectiveQualificationStatus) as TenderStatus | null) ??
    (asString(options.qualificationResultStatus) as TenderStatus | null);
  return isTenderStatus(qualStatus) ? qualStatus : null;
}

describe("tender detail overview qualification status", () => {
  it("prefers tender.qualification_status over stale qualification_results", () => {
    expect(
      resolveDetailQualificationStatus({
        tenderQualificationStatus: "NO_GO",
        qualificationResultStatus: "VERIFY",
      }),
    ).toBe("NO_GO");
  });

  it("falls back to qualification_results when tender status is null", () => {
    expect(
      resolveDetailQualificationStatus({
        tenderQualificationStatus: null,
        qualificationResultStatus: "GO",
      }),
    ).toBe("GO");
  });

  it("treats missing status as null", () => {
    expect(
      resolveDetailQualificationStatus({
        tenderQualificationStatus: null,
        qualificationResultStatus: null,
      }),
    ).toBeNull();
  });

  it("uses effective_qualification_status before qualification_results", () => {
    expect(
      resolveDetailQualificationStatus({
        tenderQualificationStatus: null,
        effectiveQualificationStatus: "VERIFY",
        qualificationResultStatus: "NO_GO",
      }),
    ).toBe("VERIFY");
  });
});

describe("tender detail status after submission", () => {
  it("hides a leftover Will Bid status once the bid is submitted", () => {
    expect(
      resolveDisplayedDetailStatus({
        qualificationStatus: "GO",
        submitted: true,
      }),
    ).toBe("SUBMITTED");
  });

  it("keeps Won after submission", () => {
    expect(
      resolveDisplayedDetailStatus({
        qualificationStatus: "WON",
        submitted: true,
      }),
    ).toBe("WON");
  });

  it("offers Technical / Financial Rejected from Submitted", () => {
    expect(
      tenderDetailStatusChoices({
        currentStatus: "SUBMITTED",
        submitted: true,
      }),
    ).toEqual(["SUBMITTED", "TECHNICAL_REJECTED", "FINANCIAL_REJECTED"]);
  });

  it("locks Won so earlier statuses are not offered", () => {
    expect(
      tenderDetailStatusChoices({ currentStatus: "WON", submitted: true }),
    ).toEqual(["WON"]);
  });

  it("locks Technical Rejected", () => {
    expect(
      tenderDetailStatusChoices({
        currentStatus: "TECHNICAL_REJECTED",
        submitted: true,
      }),
    ).toEqual(["TECHNICAL_REJECTED"]);
  });

  it("still lists the full pipeline before submission", () => {
    expect(
      tenderDetailStatusChoices({ currentStatus: "GO", submitted: false }),
    ).toEqual(TENDER_STATUSES);
  });

  it("does not offer Under Evaluation in any status choices", () => {
    expect(TENDER_STATUSES).not.toContain("UNDER_EVALUATION");
    expect(
      tenderDetailStatusChoices({ currentStatus: "GO", submitted: false }),
    ).not.toContain("UNDER_EVALUATION");
    expect(
      tenderDetailStatusChoices({
        currentStatus: "SUBMITTED",
        submitted: true,
      }),
    ).not.toContain("UNDER_EVALUATION");
  });
});

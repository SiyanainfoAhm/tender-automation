import { describe, expect, it } from "vitest";

import { isTenderStatus } from "@/lib/tender-classification";
import type { TenderStatus } from "@/lib/tender-status";

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

  it("treats missing status as under evaluation (null)", () => {
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

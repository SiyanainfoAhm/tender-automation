import { describe, expect, it } from "vitest";

import {
  computeSubmissionReadiness,
  lineGst,
  lineSubtotal,
  lineTotal,
  nextDocumentVersion,
} from "@/lib/bid-workspace";
import {
  derivePipelineStage,
  classificationLabel,
} from "@/lib/tender-classification";
import { getCalendarDaysUntilDeadline } from "@/lib/tender-deadline";

describe("classification presentation", () => {
  it("maps stored enums to friendly labels", () => {
    expect(classificationLabel("GO")).toBe("Will Bid");
    expect(classificationLabel("CONDITIONAL_GO")).toBe("Screening");
    expect(classificationLabel("PARTNER_BID")).toBe("Partnership");
    expect(classificationLabel("VERIFY")).toBe("Screening");
    expect(classificationLabel("NO_GO")).toBe("No Bid");
  });

  it("does not mark GO as submitted", () => {
    expect(
      derivePipelineStage({ qualificationStatus: "GO", submitted: false }),
    ).toBe("will_bid");
    expect(
      derivePipelineStage({ qualificationStatus: "GO", submitted: true }),
    ).toBe("submitted");
    expect(
      derivePipelineStage({
        qualificationStatus: "CONDITIONAL_GO",
        submitted: false,
      }),
    ).toBe("screening");
    expect(
      derivePipelineStage({ qualificationStatus: "VERIFY", submitted: false }),
    ).toBe("screening");
  });
});

describe("BOQ calculations", () => {
  it("computes line GST independently of a global rate", () => {
    expect(lineSubtotal(10, 100)).toBe(1000);
    expect(lineGst(10, 100, 18)).toBe(180);
    expect(lineTotal(10, 100, 18)).toBe(1180);
    expect(lineGst(2, 50, 5)).toBe(5);
  });
});

describe("submission readiness", () => {
  it("is explainable from required items", () => {
    const readiness = computeSubmissionReadiness({
      proposalCompleted: 5,
      proposalTotal: 6,
      boqLineCount: 2,
      documentsReady: 8,
      documentsRequired: 10,
      pqMatched: 14,
      pqMandatory: 15,
    });
    expect(readiness.completed).toBe(5 + 1 + 8 + 14);
    expect(readiness.total).toBe(6 + 1 + 10 + 15);
    expect(readiness.incompleteRequired).toBe(1 + 0 + 2 + 1);
    expect(readiness.percent).toBe(
      Math.round((readiness.completed / readiness.total) * 100),
    );
  });
});

describe("document versions", () => {
  it("increments stored versions without random ids", () => {
    expect(nextDocumentVersion(null)).toBe("v1");
    expect(nextDocumentVersion("v1")).toBe("v2");
    expect(nextDocumentVersion("v3.1")).toBe("v4");
  });
});

describe("deadline days", () => {
  it("computes calendar days from a real closing date", () => {
    const now = new Date("2026-08-14T10:00:00");
    expect(getCalendarDaysUntilDeadline("2026-08-16", now)).toBe(2);
    expect(getCalendarDaysUntilDeadline("2026-08-10", now)).toBe(-4);
  });
});

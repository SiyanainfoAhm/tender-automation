import { describe, expect, it } from "vitest";

import {
  EXECUTION_STATUSES,
  EXECUTION_STATUS_LABELS,
  MILESTONE_STATUSES,
  PBG_STATUSES,
  PBG_STATUS_LABELS,
  PAYMENT_STATUSES,
  friendlyWonStatusConstraintError,
  isExecutionStatus,
  isMilestoneStatus,
  isPbgStatus,
  isPaymentStatus,
  normalizePbgStatus,
} from "@/lib/wonTenderStatuses";

describe("wonTenderStatuses", () => {
  it("rejects free-text status values", () => {
    expect(isPbgStatus("Active")).toBe(false);
    expect(isPbgStatus("pending")).toBe(true);
    expect(isExecutionStatus("In Execution")).toBe(false);
    expect(isExecutionStatus("in_execution")).toBe(true);
    expect(isPaymentStatus("Partially Received")).toBe(false);
    expect(isPaymentStatus("partially_received")).toBe(true);
    expect(isMilestoneStatus("Not Started")).toBe(false);
    expect(isMilestoneStatus("not_started")).toBe(true);
  });

  it("exposes labels for every controlled status value", () => {
    for (const status of PBG_STATUSES) {
      expect(PBG_STATUS_LABELS[status]).toBeTruthy();
    }
    for (const status of EXECUTION_STATUSES) {
      expect(EXECUTION_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(PAYMENT_STATUSES).toHaveLength(5);
    expect(MILESTONE_STATUSES).toHaveLength(5);
  });

  it("normalizes optional PBG status for persistence", () => {
    expect(normalizePbgStatus(null)).toBeNull();
    expect(normalizePbgStatus("")).toBeNull();
    expect(normalizePbgStatus("active")).toBe("active");
    expect(() => normalizePbgStatus("bogus")).toThrow(
      /Invalid status selected/,
    );
  });

  it("maps check-constraint errors to a friendly message", () => {
    expect(
      friendlyWonStatusConstraintError(
        new Error(
          'new row for relation "agenttender_won_projects" violates check constraint "agenttender_won_projects_pbg_status_check"',
        ),
      ),
    ).toBe("Invalid status selected. Please choose a valid option.");
    expect(friendlyWonStatusConstraintError(new Error("Network failed"))).toBe(
      null,
    );
  });
});

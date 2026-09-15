import { describe, expect, it } from "vitest";

import {
  EXECUTION_STATUS_OPTIONS,
  MILESTONE_STATUS_OPTIONS,
  PBG_STATUS_OPTIONS,
  displayMilestoneStatus,
  friendlyWonStatusConstraintError,
  parseExecutionStatus,
  parseMilestoneStatus,
  parsePaymentStatus,
  parsePbgStatus,
} from "@/lib/wonTenderStatuses";

describe("won status option mapping", () => {
  it("maps UI labels and mixed case to exact DB values", () => {
    expect(parseExecutionStatus("Awarded")).toBe("awarded");
    expect(parseExecutionStatus("awarded")).toBe("awarded");
    expect(parseExecutionStatus("In Execution")).toBe("in_execution");
    expect(parseExecutionStatus("IN_EXECUTION")).toBe("in_execution");
    expect(parsePbgStatus("Active")).toBe("active");
    expect(parsePbgStatus("active")).toBe("active");
    expect(parsePbgStatus("Pending")).toBe("pending");
    expect(parseMilestoneStatus("Not Started")).toBe("not_started");
    expect(parseMilestoneStatus("in_progress")).toBe("in_progress");
    expect(parseMilestoneStatus("IN PROGRESS")).toBe("in_progress");
    expect(parseMilestoneStatus("Delayed")).toBe("delayed");
    expect(parsePaymentStatus("Partially Received")).toBe("partially_received");
    expect(parseExecutionStatus("Nope")).toBeNull();
    expect(parsePbgStatus("Nope")).toBeNull();
    expect(parseMilestoneStatus("Nope")).toBeNull();
  });

  it("dropdown option values match DB CHECK values exactly", () => {
    expect(EXECUTION_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      "awarded",
      "in_execution",
      "on_hold",
      "completed",
      "cancelled",
    ]);
    expect(PBG_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      "pending",
      "active",
      "released",
      "expired",
      "invoked",
    ]);
    expect(MILESTONE_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      "not_started",
      "in_progress",
      "completed",
      "delayed",
      "on_hold",
    ]);
    expect(
      EXECUTION_STATUS_OPTIONS.find((o) => o.value === "awarded")?.label,
    ).toBe("Awarded");
    expect(PBG_STATUS_OPTIONS.find((o) => o.value === "active")?.label).toBe(
      "Active",
    );
    expect(
      MILESTONE_STATUS_OPTIONS.find((o) => o.value === "not_started")?.label,
    ).toBe("Not Started");
  });

  it("displays overdue incomplete milestones as Delayed", () => {
    expect(
      displayMilestoneStatus({
        status: "in_progress",
        dueDate: "2020-01-01",
        today: "2026-09-15",
      }),
    ).toBe("delayed");
    expect(
      displayMilestoneStatus({
        status: "completed",
        dueDate: "2020-01-01",
        today: "2026-09-15",
      }),
    ).toBe("completed");
    expect(
      displayMilestoneStatus({
        status: "not_started",
        dueDate: "2030-01-01",
        today: "2026-09-15",
      }),
    ).toBe("not_started");
  });

  it("does not treat unrelated check failures as status errors", () => {
    expect(
      friendlyWonStatusConstraintError(
        new Error(
          'new row violates check constraint "agenttender_won_projects_pbg_amount_check"',
        ),
      ),
    ).toBeNull();
    expect(
      friendlyWonStatusConstraintError(
        new Error(
          'violates check constraint "agenttender_won_projects_pbg_status_check"',
        ),
      ),
    ).toBe("Please select a valid status.");
    expect(
      friendlyWonStatusConstraintError(
        new Error(
          'violates check constraint "agenttender_won_project_milestones_status_check"',
        ),
      ),
    ).toBe("Please select a valid status.");
  });
});

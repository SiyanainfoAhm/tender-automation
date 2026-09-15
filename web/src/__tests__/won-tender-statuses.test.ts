import { describe, expect, it } from "vitest";

import {
  EXECUTION_STATUS_OPTIONS,
  PBG_STATUS_OPTIONS,
  friendlyWonStatusConstraintError,
  parseExecutionStatus,
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
    expect(parseExecutionStatus("Nope")).toBeNull();
    expect(parsePbgStatus("Nope")).toBeNull();
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
    expect(
      EXECUTION_STATUS_OPTIONS.find((o) => o.value === "awarded")?.label,
    ).toBe("Awarded");
    expect(PBG_STATUS_OPTIONS.find((o) => o.value === "active")?.label).toBe(
      "Active",
    );
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
  });
});

import { describe, expect, it } from "vitest";

import {
  isUpcomingDeadlineDue,
  isUpcomingDeadlineStatus,
} from "@/lib/dashboard/upcoming-deadlines";

describe("TF-59 Upcoming Deadlines filters", () => {
  it("includes only Will Bid (GO) and May Bid (CONDITIONAL_GO)", () => {
    expect(isUpcomingDeadlineStatus("GO")).toBe(true);
    expect(isUpcomingDeadlineStatus("CONDITIONAL_GO")).toBe(true);
    expect(isUpcomingDeadlineStatus("VERIFY")).toBe(false);
    expect(isUpcomingDeadlineStatus("NO_GO")).toBe(false);
    expect(isUpcomingDeadlineStatus("SUBMITTED")).toBe(false);
    expect(isUpcomingDeadlineStatus(null)).toBe(false);
  });

  it("excludes overdue and keeps due today through the horizon", () => {
    expect(isUpcomingDeadlineDue(-1)).toBe(false);
    expect(isUpcomingDeadlineDue(0)).toBe(true);
    expect(isUpcomingDeadlineDue(45)).toBe(true);
    expect(isUpcomingDeadlineDue(46)).toBe(false);
  });
});

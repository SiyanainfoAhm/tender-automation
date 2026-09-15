import { describe, expect, it } from "vitest";

import { buildWonPortfolioFromProjects } from "@/lib/dashboard/won-portfolio";

describe("buildWonPortfolioFromProjects", () => {
  it("aggregates execution status, values, and milestones from won projects", () => {
    const portfolio = buildWonPortfolioFromProjects([
      {
        executionStatus: "awarded",
        finalAwardValue: 1_000_000,
        milestonesCompleted: 1,
        milestonesTotal: 3,
      },
      {
        executionStatus: "in_execution",
        finalAwardValue: 2_500_000,
        milestonesCompleted: 2,
        milestonesTotal: 4,
      },
      {
        executionStatus: "completed",
        finalAwardValue: 750_000,
        milestonesCompleted: 5,
        milestonesTotal: 5,
      },
      {
        executionStatus: "on_hold",
        finalAwardValue: 100_000,
        milestonesCompleted: 0,
        milestonesTotal: 2,
      },
    ]);

    expect(portfolio.activeProjects).toBe(2);
    expect(portfolio.completed).toBe(1);
    expect(portfolio.inExecutionValue).toBe(3_500_000);
    expect(portfolio.milestonesDone).toBe(8);
    expect(portfolio.milestonesTotal).toBe(14);
    expect(portfolio.byStatus.find((row) => row.key === "awarded")?.count).toBe(
      1,
    );
    expect(
      portfolio.byStatus.find((row) => row.key === "in_execution")?.count,
    ).toBe(1);
    expect(portfolio.byStatus.find((row) => row.key === "completed")?.count).toBe(
      1,
    );
    expect(portfolio.byStatus.find((row) => row.key === "on_hold")?.count).toBe(
      1,
    );
  });

  it("returns empty portfolio when there are no won projects", () => {
    const portfolio = buildWonPortfolioFromProjects([]);
    expect(portfolio.activeProjects).toBe(0);
    expect(portfolio.completed).toBe(0);
    expect(portfolio.inExecutionValue).toBe(0);
    expect(portfolio.milestonesDone).toBe(0);
    expect(portfolio.milestonesTotal).toBe(0);
  });
});

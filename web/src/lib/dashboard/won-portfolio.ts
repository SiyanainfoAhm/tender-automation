import { formatIndianCurrency } from "@/lib/format";
import {
  WON_EXECUTION_STATUS_LABELS,
  WON_EXECUTION_STATUSES,
  type WonExecutionStatus,
  type WonProjectListItem,
} from "@/lib/won-projects";
import type { DashboardWonPortfolio } from "@/lib/dashboard/types";

const STATUS_COLORS: Record<WonExecutionStatus, string> = {
  awarded: "#16a34a",
  in_execution: "#0ea5e9",
  on_hold: "#f59e0b",
  completed: "#64748b",
  cancelled: "#dc2626",
};

function moneyLabel(value: number): string {
  if (value <= 0) return "₹0";
  return formatIndianCurrency(value);
}

function isActiveExecution(status: WonExecutionStatus): boolean {
  return status === "awarded" || status === "in_execution";
}

/** Build dashboard execution portfolio from company won projects. */
export function buildWonPortfolioFromProjects(
  projects: Array<
    Pick<
      WonProjectListItem,
      | "executionStatus"
      | "finalAwardValue"
      | "milestonesCompleted"
      | "milestonesTotal"
    >
  >,
): DashboardWonPortfolio {
  const active = projects.filter((p) => isActiveExecution(p.executionStatus));
  const completed = projects.filter((p) => p.executionStatus === "completed");
  const inExecutionValue = active.reduce(
    (sum, p) => sum + (Number(p.finalAwardValue) || 0),
    0,
  );
  const milestonesDone = projects.reduce(
    (sum, p) => sum + (Number(p.milestonesCompleted) || 0),
    0,
  );
  const milestonesTotal = projects.reduce(
    (sum, p) => sum + (Number(p.milestonesTotal) || 0),
    0,
  );

  const byStatus = WON_EXECUTION_STATUSES.map((status) => {
    const bucket = projects.filter((p) => p.executionStatus === status);
    const totalValue = bucket.reduce(
      (sum, p) => sum + (Number(p.finalAwardValue) || 0),
      0,
    );
    return {
      key: status,
      label: WON_EXECUTION_STATUS_LABELS[status],
      count: bucket.length,
      totalValue,
      color: STATUS_COLORS[status],
      valueLabel: moneyLabel(totalValue),
      progress: 0,
    };
  });

  const maxValue = Math.max(1, ...byStatus.map((b) => b.totalValue));
  const totalContractValue = projects.reduce(
    (sum, p) => sum + (Number(p.finalAwardValue) || 0),
    0,
  );

  return {
    activeProjects: active.length,
    inExecutionValue,
    inExecutionValueLabel: moneyLabel(
      inExecutionValue > 0 ? inExecutionValue : totalContractValue,
    ),
    completed: completed.length,
    milestonesDone,
    milestonesTotal,
    byStatus: byStatus.map((b) => ({
      ...b,
      progress: Math.round((b.totalValue / maxValue) * 100),
    })),
  };
}

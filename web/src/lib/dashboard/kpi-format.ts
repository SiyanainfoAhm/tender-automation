import type { DashboardTimeRange } from "@/lib/dashboard/time-range";

/** Minimum decided bids required before showing win-rate period comparison. */
export const MIN_WIN_RATE_SAMPLE = 3;

export type DashboardKpiTone = "positive" | "negative" | "neutral";
export type DashboardKpiDirection = "up" | "down";

export type DashboardKpiComparison = {
  text: string;
  tone: DashboardKpiTone;
  direction?: DashboardKpiDirection;
};

export type DashboardKpiMetric = {
  key: "totalTenders" | "activeBids" | "winRate" | "pendingReview";
  label: string;
  /** Display string already formatted for the card. */
  value: string;
  comparison: DashboardKpiComparison;
};

function periodPhrase(range: DashboardTimeRange): string {
  return range === "7d" ? "this week" : "vs previous period";
}

/**
 * Period count comparison (Total Tenders).
 * Positive delta = more imports than previous window = positive.
 */
export function formatPeriodCountComparison(options: {
  delta: number;
  range: DashboardTimeRange;
  emptyCurrent: boolean;
  emptyLabel?: string;
}): DashboardKpiComparison {
  const { delta, range, emptyCurrent } = options;
  if (emptyCurrent && delta === 0) {
    return {
      text: options.emptyLabel ?? "No tenders in this period",
      tone: "neutral",
    };
  }
  if (delta === 0) {
    return {
      text: "No change vs previous period",
      tone: "neutral",
    };
  }
  if (delta > 0) {
    return {
      text: `↑ +${delta} ${periodPhrase(range)}`,
      tone: "positive",
      direction: "up",
    };
  }
  return {
    text: `↓ ${Math.abs(delta)} ${periodPhrase(range)}`,
    tone: "negative",
    direction: "down",
  };
}

/**
 * Active Bids: primary is a live snapshot.
 * Comparison uses net entries into the active pipeline during the selected
 * period vs the preceding period (qualified_at / submitted_at) — not a
 * fabricated end-of-period historical snapshot.
 */
export function formatActiveBidsComparison(options: {
  snapshotValue: number;
  enteredDelta: number;
  range: DashboardTimeRange;
}): DashboardKpiComparison {
  if (options.snapshotValue === 0 && options.enteredDelta === 0) {
    return { text: "No active bids", tone: "neutral" };
  }
  if (options.enteredDelta === 0) {
    return {
      text: "No change vs previous period",
      tone: "neutral",
    };
  }
  if (options.enteredDelta > 0) {
    return {
      text: `↑ +${options.enteredDelta} ${periodPhrase(options.range)}`,
      tone: "positive",
      direction: "up",
    };
  }
  return {
    text: `↓ ${Math.abs(options.enteredDelta)} ${periodPhrase(options.range)}`,
    tone: "negative",
    direction: "down",
  };
}

/**
 * Win rate comparison in percentage points (pp), not relative %.
 * Small samples suppress comparison text.
 */
export function formatWinRateComparison(options: {
  currentRate: number | null;
  previousRate: number | null;
  decidedCount: number;
  previousDecidedCount: number;
}): DashboardKpiComparison {
  if (options.decidedCount <= 0) {
    return { text: "No decided bids", tone: "neutral" };
  }
  if (options.decidedCount < MIN_WIN_RATE_SAMPLE) {
    return { text: "Small sample", tone: "neutral" };
  }
  if (
    options.previousRate == null ||
    options.previousDecidedCount < MIN_WIN_RATE_SAMPLE
  ) {
    return { text: "Small sample", tone: "neutral" };
  }
  if (options.currentRate == null) {
    return { text: "No decided bids", tone: "neutral" };
  }

  const pp = Number((options.currentRate - options.previousRate).toFixed(1));
  if (pp === 0) {
    return { text: "No change vs previous period", tone: "neutral" };
  }
  if (pp > 0) {
    return {
      text: `↑ +${pp.toFixed(1)} pp`,
      tone: "positive",
      direction: "up",
    };
  }
  return {
    text: `↓ ${pp.toFixed(1)} pp`,
    tone: "negative",
    direction: "down",
  };
}

/**
 * Pending Review: overdue is always a negative signal when > 0.
 */
export function formatPendingReviewComparison(options: {
  pendingCount: number;
  overdueCount: number;
}): DashboardKpiComparison {
  if (options.pendingCount === 0) {
    return { text: "No pending reviews", tone: "neutral" };
  }
  if (options.overdueCount <= 0) {
    return { text: "No overdue reviews", tone: "positive" };
  }
  return {
    text: `↓ ${options.overdueCount} overdue`,
    tone: "negative",
    direction: "down",
  };
}

export function formatWinRateValue(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${rate.toFixed(1)}%`;
}

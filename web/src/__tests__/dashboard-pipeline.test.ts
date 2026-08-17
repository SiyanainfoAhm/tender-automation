import { describe, expect, it } from "vitest";

import {
  formatActiveBidsComparison,
  formatPendingReviewComparison,
  formatPeriodCountComparison,
  formatWinRateComparison,
  formatWinRateValue,
  MIN_WIN_RATE_SAMPLE,
} from "@/lib/dashboard/kpi-format";
import {
  isActionableQualificationStatus,
  isPendingReviewStatus,
  mapToDashboardPipelineStage,
} from "@/lib/dashboard/pipeline";
import {
  DEFAULT_DASHBOARD_TIME_RANGE,
  parseDashboardTimeRange,
  dashboardRangeDays,
} from "@/lib/dashboard/time-range";

describe("dashboard pipeline mapping", () => {
  it("maps GO to Will Bid and submitted overrides GO", () => {
    expect(
      mapToDashboardPipelineStage({
        qualificationStatus: "GO",
        submitted: false,
      }),
    ).toBe("will_bid");
    expect(
      mapToDashboardPipelineStage({
        qualificationStatus: "GO",
        submitted: true,
      }),
    ).toBe("submitted");
  });

  it("maps May Bid / Partnership / Screening / excludes No Bid", () => {
    expect(
      mapToDashboardPipelineStage({
        qualificationStatus: "CONDITIONAL_GO",
        submitted: false,
      }),
    ).toBe("may_bid");
    expect(
      mapToDashboardPipelineStage({
        qualificationStatus: "PARTNER_BID",
        submitted: false,
      }),
    ).toBe("may_bid");
    expect(
      mapToDashboardPipelineStage({
        qualificationStatus: "VERIFY",
        submitted: false,
      }),
    ).toBe("screening");
    expect(
      mapToDashboardPipelineStage({
        qualificationStatus: "NO_GO",
        submitted: false,
      }),
    ).toBeNull();
  });

  it("treats VERIFY as pending review", () => {
    expect(isPendingReviewStatus("VERIFY")).toBe(true);
    expect(isPendingReviewStatus("GO", true)).toBe(false);
    expect(isActionableQualificationStatus("PARTNER_BID")).toBe(true);
  });
});

describe("dashboard KPI comparisons", () => {
  it("formats total tenders week delta like the wireframe", () => {
    expect(
      formatPeriodCountComparison({
        delta: 3,
        range: "7d",
        emptyCurrent: false,
      }),
    ).toEqual({
      text: "↑ +3 this week",
      tone: "positive",
      direction: "up",
    });

    expect(
      formatPeriodCountComparison({
        delta: -2,
        range: "30d",
        emptyCurrent: false,
      }),
    ).toEqual({
      text: "↓ 2 vs previous period",
      tone: "negative",
      direction: "down",
    });

    expect(
      formatPeriodCountComparison({
        delta: 0,
        range: "7d",
        emptyCurrent: false,
      }).text,
    ).toBe("No change vs previous period");
  });

  it("formats active bids entered-delta comparison", () => {
    expect(
      formatActiveBidsComparison({
        snapshotValue: 5,
        enteredDelta: 2,
        range: "7d",
      }),
    ).toEqual({
      text: "↑ +2 this week",
      tone: "positive",
      direction: "up",
    });
  });

  it("uses percentage points for win rate and small-sample threshold", () => {
    expect(MIN_WIN_RATE_SAMPLE).toBe(3);
    expect(formatWinRateValue(40)).toBe("40.0%");
    expect(formatWinRateValue(null)).toBe("—");

    expect(
      formatWinRateComparison({
        currentRate: 40,
        previousRate: 50,
        decidedCount: 5,
        previousDecidedCount: 2,
      }).text,
    ).toBe("Small sample");

    expect(
      formatWinRateComparison({
        currentRate: 40,
        previousRate: 50,
        decidedCount: 5,
        previousDecidedCount: 4,
      }),
    ).toEqual({
      text: "↓ -10.0 pp",
      tone: "negative",
      direction: "down",
    });

    expect(
      formatWinRateComparison({
        currentRate: 40,
        previousRate: 35,
        decidedCount: 5,
        previousDecidedCount: 4,
      }),
    ).toEqual({
      text: "↑ +5.0 pp",
      tone: "positive",
      direction: "up",
    });
  });

  it("treats overdue pending reviews as negative", () => {
    expect(
      formatPendingReviewComparison({
        pendingCount: 3,
        overdueCount: 1,
      }),
    ).toEqual({
      text: "↓ 1 overdue",
      tone: "negative",
      direction: "down",
    });

    expect(
      formatPendingReviewComparison({
        pendingCount: 3,
        overdueCount: 0,
      }).text,
    ).toBe("No overdue reviews");
  });
});

describe("dashboard time range", () => {
  it("defaults to 30d and parses known keys", () => {
    expect(parseDashboardTimeRange(undefined)).toBe(
      DEFAULT_DASHBOARD_TIME_RANGE,
    );
    expect(parseDashboardTimeRange("7d")).toBe("7d");
    expect(parseDashboardTimeRange("bogus")).toBe("30d");
    expect(dashboardRangeDays("90d")).toBe(90);
    expect(dashboardRangeDays("1y")).toBe(365);
  });
});

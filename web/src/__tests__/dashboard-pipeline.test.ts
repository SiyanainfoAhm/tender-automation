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
  isWonQualificationStatus,
  mapToDashboardPipelineStage,
} from "@/lib/dashboard/pipeline";
import {
  DEFAULT_DASHBOARD_PERIOD,
  parseDashboardDateBasis,
  parseDashboardPeriod,
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

  it("maps Verify / May Bid / Partnership and excludes No Bid / Won", () => {
    expect(
      mapToDashboardPipelineStage({
        qualificationStatus: "VERIFY",
        submitted: false,
      }),
    ).toBe("verify");
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
    ).toBe("partnership");
    expect(
      mapToDashboardPipelineStage({
        qualificationStatus: "NO_GO",
        submitted: false,
      }),
    ).toBeNull();
    expect(
      mapToDashboardPipelineStage({
        qualificationStatus: "WON",
        submitted: true,
      }),
    ).toBeNull();
    expect(isWonQualificationStatus("WON")).toBe(true);
  });

  it("treats VERIFY as pending review", () => {
    expect(isPendingReviewStatus("VERIFY")).toBe(true);
    expect(isPendingReviewStatus("GO", true)).toBe(false);
    expect(isActionableQualificationStatus("PARTNER_BID")).toBe(true);
  });
});

describe("dashboard filters", () => {
  it("parses period and date basis with legacy aliases", () => {
    expect(parseDashboardPeriod("month")).toBe("month");
    expect(parseDashboardPeriod("30d")).toBe("month");
    expect(parseDashboardPeriod("7d")).toBe("week");
    expect(parseDashboardDateBasis("created")).toBe("created");
    expect(parseDashboardDateBasis("scraped")).toBe("scraped");
    expect(DEFAULT_DASHBOARD_PERIOD).toBe("month");
    expect(dashboardRangeDays("quarter")).toBe(90);
  });
});

describe("dashboard KPI comparisons", () => {
  it("formats total tenders week delta", () => {
    expect(
      formatPeriodCountComparison({
        delta: 3,
        range: "week",
        emptyCurrent: false,
      }),
    ).toEqual({
      text: "↑ +3 this week",
      tone: "positive",
      direction: "up",
    });
  });

  it("formats win rate and pending review helpers", () => {
    expect(formatWinRateValue(54.5)).toBe("54.5%");
    expect(formatWinRateValue(null)).toBe("—");
    expect(MIN_WIN_RATE_SAMPLE).toBe(3);
    expect(
      formatWinRateComparison({
        currentRate: null,
        previousRate: null,
        decidedCount: 0,
        previousDecidedCount: 0,
      }).text,
    ).toBe("No decided bids");
    expect(
      formatPendingReviewComparison({
        pendingCount: 2,
        overdueCount: 1,
      }).tone,
    ).toBe("negative");
    expect(
      formatActiveBidsComparison({
        snapshotValue: 0,
        enteredDelta: 0,
        range: "month",
      }).text,
    ).toBe("No active bids");
  });
});

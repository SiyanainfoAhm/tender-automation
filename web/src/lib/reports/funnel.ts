import type { PipelineConversion } from "@/lib/reports/types";

export type FunnelCounts = {
  new: number;
  screening: number;
  mayBid: number;
  willBid: number;
  submitted: number;
  won: number;
};

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

/**
 * Sequential FY-cohort funnel conversions (mutually exclusive stage counts).
 * Each rate is a subset of the previous reached set, so it cannot exceed 100%.
 *
 * New → Screening: share of FY tenders that left unevaluated New
 * Screening → Will Bid: share of evaluated that reached Will Bid or later
 * Will Bid → Submitted: share of Will Bid+ that were submitted
 * Submitted → Won: share of submitted that were won
 */
export function computeFunnelConversions(counts: FunnelCounts): PipelineConversion[] {
  const reachedScreening =
    counts.screening + counts.mayBid + counts.willBid + counts.submitted + counts.won;
  const total = counts.new + reachedScreening;
  const reachedWillBid = counts.willBid + counts.submitted + counts.won;
  const reachedSubmitted = counts.submitted + counts.won;

  return [
    {
      key: "new_screening",
      label: "New → Screening",
      icon: "ri-filter-3-line",
      from: total,
      to: reachedScreening,
      rate: ratio(reachedScreening, total),
    },
    {
      key: "screening_will_bid",
      label: "Screening → Will Bid",
      icon: "ri-thumb-up-line",
      from: reachedScreening,
      to: reachedWillBid,
      rate: ratio(reachedWillBid, reachedScreening),
    },
    {
      key: "will_bid_submitted",
      label: "Will Bid → Submitted",
      icon: "ri-send-plane-line",
      from: reachedWillBid,
      to: reachedSubmitted,
      rate: ratio(reachedSubmitted, reachedWillBid),
    },
    {
      key: "submitted_won",
      label: "Submitted → Won",
      icon: "ri-trophy-line",
      from: reachedSubmitted,
      to: counts.won,
      rate: ratio(counts.won, reachedSubmitted),
    },
  ];
}

export function winRate(won: number, lost: number): number | null {
  const decided = won + lost;
  if (decided <= 0) return null;
  return (won / decided) * 100;
}

export function formatWinRate(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${rate.toFixed(1)}%`;
}

/**
 * Phase-1 run-level screening statuses.
 * Stored values match the application canonical enum
 * (GO / CONDITIONAL_GO / PARTNER_BID / VERIFY / NO_GO).
 * Display aliases: Will Bid / May Bid / Partnership / Verify / No Bid.
 */
export const PHASE1_STATUSES = [
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
  "VERIFY",
  "NO_GO",
] as const;

export type Phase1ScreeningStatus = (typeof PHASE1_STATUSES)[number];

export const PHASE1_STATUS_DISPLAY: Record<Phase1ScreeningStatus, string> = {
  GO: "Will Bid",
  CONDITIONAL_GO: "May Bid",
  PARTNER_BID: "Partnership",
  VERIFY: "Verify",
  NO_GO: "No Bid",
};

/** Statuses that enter expensive Tender247 detail scraping. */
export const DETAIL_SCRAPE_STATUSES = new Set<Phase1ScreeningStatus>([
  "VERIFY",
  "CONDITIONAL_GO",
  "GO",
  "PARTNER_BID",
]);

export function isDetailScrapeStatus(
  status: Phase1ScreeningStatus | null | undefined,
): boolean {
  return Boolean(status && DETAIL_SCRAPE_STATUSES.has(status));
}

export function isPhase1NoBid(
  status: Phase1ScreeningStatus | null | undefined,
): boolean {
  return status === "NO_GO";
}

/**
 * Normalize ChatGPT / Excel status cells onto the canonical Phase-1 enum.
 * MAY_BID is treated as CONDITIONAL_GO (scrape), not VERIFY — Phase-1
 * shortlist semantics, distinct from detailed-qualification MAY_BID→VERIFY.
 */
export function normalizePhase1ScreeningStatus(
  raw: string | null | undefined,
): Phase1ScreeningStatus | null {
  if (!raw) return null;
  const key = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\w]/g, "");
  switch (key) {
    case "GO":
    case "WILL_BID":
    case "WILLBID":
      return "GO";
    case "CONDITIONAL_GO":
    case "CONDITIONALGO":
    case "MAY_BID":
    case "MAYBID":
      return "CONDITIONAL_GO";
    case "PARTNER_BID":
    case "PARTNERBID":
    case "PARTNERSHIP":
      return "PARTNER_BID";
    case "VERIFY":
    case "SCREENING":
      return "VERIFY";
    case "NO_GO":
    case "NOGO":
    case "NO_BID":
    case "NOBID":
      return "NO_GO";
    default:
      return null;
  }
}

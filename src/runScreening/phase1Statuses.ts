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

/** Workbook / ChatGPT Phase-1 tokens used for Tender247 detail selection. */
export const PHASE1_CRAWL_STATUSES = [
  "NO_BID",
  "VERIFY",
  "MAY_BID",
  "WILL_BID",
] as const;

export type Phase1CrawlStatus = (typeof PHASE1_CRAWL_STATUSES)[number];

/**
 * Statuses that enter expensive Tender247 detail scraping.
 * ChatGPT Phase-1 tokens: VERIFY / MAY_BID / WILL_BID only.
 * Canonical aliases (VERIFY / CONDITIONAL_GO / GO) map onto those tokens.
 * PARTNER_BID is not a Phase-1 crawl status.
 */
export const DETAIL_SCRAPE_STATUSES = new Set<Phase1ScreeningStatus>([
  "VERIFY",
  "CONDITIONAL_GO",
  "GO",
]);

export const DETAIL_SCRAPE_CRAWL_STATUSES = new Set<Phase1CrawlStatus>([
  "VERIFY",
  "MAY_BID",
  "WILL_BID",
]);

export function normalizeStatusToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\w]/g, "");
}

export function normalizePhase1CrawlStatus(
  value: unknown,
): Phase1CrawlStatus | null {
  const key = normalizeStatusToken(value);
  switch (key) {
    case "NO_BID":
    case "NOBID":
    case "NO_GO":
    case "NOGO":
      return "NO_BID";
    case "VERIFY":
    case "SCREENING":
      return "VERIFY";
    case "MAY_BID":
    case "MAYBID":
    case "CONDITIONAL_GO":
    case "CONDITIONALGO":
      return "MAY_BID";
    case "WILL_BID":
    case "WILLBID":
    case "GO":
      return "WILL_BID";
    default:
      return null;
  }
}

export function isDetailScrapeCrawlStatus(
  status: Phase1CrawlStatus | null | undefined,
): status is "VERIFY" | "MAY_BID" | "WILL_BID" {
  return Boolean(status && DETAIL_SCRAPE_CRAWL_STATUSES.has(status));
}

export function isDetailScrapeStatus(
  status: Phase1ScreeningStatus | Phase1CrawlStatus | null | undefined,
): boolean {
  return isDetailScrapeCrawlStatus(normalizePhase1CrawlStatus(status));
}

export function isPhase1NoBid(
  status: Phase1ScreeningStatus | Phase1CrawlStatus | null | undefined,
): boolean {
  return normalizePhase1CrawlStatus(status) === "NO_BID";
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

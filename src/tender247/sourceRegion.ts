/** Tender247 Indian vs Global source — shared by scrape, upsert, queue, and web. */

export const TENDER247_SOURCE_REGIONS = ["INDIAN", "GLOBAL"] as const;

export type Tender247SourceRegion = (typeof TENDER247_SOURCE_REGIONS)[number];

export const DEFAULT_TENDER247_SOURCE_REGION: Tender247SourceRegion = "INDIAN";

export const TENDER247_ORIGIN = "https://www.tender247.com";

/**
 * Per-region feed configuration. Global is a separate authenticated list URL,
 * not an Indian-list filter.
 */
export type Tender247SourceConfig = {
  region: Tender247SourceRegion;
  /** Path under tender247.com, e.g. /auth/tender */
  path: string;
  /** Absolute list/dashboard URL for this feed. */
  url: string;
  /** Path prefix used by detail links for this feed. */
  detailPathPrefix: string;
};

export const TENDER247_SOURCES: Record<
  Tender247SourceRegion,
  Tender247SourceConfig
> = {
  INDIAN: {
    region: "INDIAN",
    path: "/auth/tender",
    url: `${TENDER247_ORIGIN}/auth/tender`,
    detailPathPrefix: "/auth/tender",
  },
  GLOBAL: {
    region: "GLOBAL",
    path: "/auth/globaltender",
    url: `${TENDER247_ORIGIN}/auth/globaltender`,
    detailPathPrefix: "/auth/globaltender",
  },
};

export function getTender247Source(
  region: Tender247SourceRegion = DEFAULT_TENDER247_SOURCE_REGION,
): Tender247SourceConfig {
  return TENDER247_SOURCES[region];
}

export function parseTender247SourceRegion(
  raw: string | null | undefined,
): Tender247SourceRegion {
  const token = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (token === "GLOBAL" || token === "INTERNATIONAL") return "GLOBAL";
  if (token === "INDIAN" || token === "INDIA" || token === "") {
    return "INDIAN";
  }
  throw new Error(
    `Invalid --region=${raw}; expected INDIAN or GLOBAL`,
  );
}

export function tender247RegionLabel(region: Tender247SourceRegion): string {
  return region === "GLOBAL" ? "Global" : "Indian";
}

/** True when URL is either authenticated list feed (Indian or Global). */
export function isTender247AuthListUrl(url: string): boolean {
  const lower = String(url || "").toLowerCase();
  return (
    lower.includes("/auth/tender") ||
    lower.includes("/auth/globaltender")
  );
}

/** Region inferred from the current page URL (defaults INDIAN). */
export function tender247RegionFromUrl(url: string): Tender247SourceRegion {
  return /\/auth\/globaltender/i.test(url) ? "GLOBAL" : "INDIAN";
}

/**
 * Parse a Tender247 detail route.
 * Requires `/auth/tender|{globaltender}/{id}/{uuid}` — never id-only.
 */
export function parseTender247DetailRoute(url: string): {
  region: Tender247SourceRegion;
  tenderId: string;
  securityCode: string;
} | null {
  const match = String(url || "").match(
    /\/auth\/(globaltender|tender)\/(\d+)\/([0-9a-f-]{8,})/i,
  );
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    region: /globaltender/i.test(match[1]) ? "GLOBAL" : "INDIAN",
    tenderId: match[2],
    securityCode: match[3],
  };
}

/** True when `url` is the list/detail feed for the given region. */
export function urlMatchesTender247Region(
  url: string,
  region: Tender247SourceRegion,
): boolean {
  const lower = String(url || "").toLowerCase();
  if (region === "GLOBAL") {
    return lower.includes("/auth/globaltender");
  }
  return lower.includes("/auth/tender") && !lower.includes("/auth/globaltender");
}

/** Absolute detail URL for a Tender247 id + optional security code. */
export function tender247DetailUrl(
  region: Tender247SourceRegion,
  t247Id: string,
  securityCode?: string | null,
): string {
  const source = getTender247Source(region);
  const id = String(t247Id || "").trim();
  const code = String(securityCode || "").trim();
  if (code) return `${TENDER247_ORIGIN}${source.detailPathPrefix}/${id}/${code}`;
  return `${TENDER247_ORIGIN}${source.detailPathPrefix}/${id}`;
}

/** Excel / seed file basename for a region + date. */
export function tender247ExcelBasename(
  region: Tender247SourceRegion,
  dateIso: string,
): string {
  if (region === "GLOBAL") {
    return `Tender247_GLOBAL_${dateIso}.xlsx`;
  }
  return `Tender247_${dateIso}.xlsx`;
}

/** Subfolder under downloads/<date> for region-scoped artifacts. */
export function tender247RegionSubdir(region: Tender247SourceRegion): string {
  return region === "GLOBAL" ? "Tender247-GLOBAL" : "Tender247";
}

/**
 * Status-card counts are a facet over the current tender population.
 * They must use every active list filter EXCEPT status (and pagination/sort).
 *
 * Scraped-date exception: the list defaults omitted `date` to "today", but
 * status KPIs (especially Won / Lost) would stay at 0 under that default.
 * When the URL has no scraped-date params, counts use `date=all`. An explicit
 * `date=today` (or other preset) in the URL still scopes the cards.
 */

/** URL/query keys that affect status-card counts (never includes `status`). */
export const TENDER_STATUS_COUNT_PARAM_KEYS = [
  "q",
  "source",
  "region",
  "downloadStatus",
  "dateType",
  "from",
  "to",
  "quickDate",
  "closingPreset",
  "valueBand",
  "emdBand",
  "state",
  "city",
  "category",
  "organization",
  "authority",
  "tenderValueMin",
  "tenderValueMax",
  "emdMin",
  "emdMax",
  "manualReview",
  "qualified",
  "date",
  "selectedDate",
  "createdFrom",
  "createdTo",
  "closingDate",
  "closingFrom",
  "closingTo",
] as const;

export type TenderStatusCountParamKey =
  (typeof TENDER_STATUS_COUNT_PARAM_KEYS)[number];

const STATUS_COUNT_KEY_SET = new Set<string>(TENDER_STATUS_COUNT_PARAM_KEYS);

const SCRAPED_DATE_KEYS = [
  "date",
  "selectedDate",
  "createdFrom",
  "createdTo",
] as const;

function readParam(
  input: URLSearchParams | Record<string, string | string[] | null | undefined>,
  key: string,
): string | null {
  if (input instanceof URLSearchParams) {
    const value = input.get(key);
    return value && value.trim() ? value : null;
  }
  const raw = input[key];
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first && String(first).trim() ? String(first) : null;
  }
  if (raw == null) return null;
  const text = String(raw).trim();
  return text ? text : null;
}

function hasExplicitScrapedDate(
  input: URLSearchParams | Record<string, string | string[] | null | undefined>,
): boolean {
  return SCRAPED_DATE_KEYS.some((key) => Boolean(readParam(input, key)));
}

/**
 * Build the query string for GET /api/tenders/status-counts from the full
 * tender-list URL. Status, page, and sort are intentionally omitted.
 */
export function buildTenderStatusCountSearchParams(
  input: URLSearchParams | Record<string, string | string[] | null | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of TENDER_STATUS_COUNT_PARAM_KEYS) {
    const value = readParam(input, key);
    if (!value) continue;
    if (key === "source" && value === "ALL") continue;
    if (key === "region" && value === "ALL") continue;
    params.set(key, value);
  }
  // Mirror list default only when the user explicitly chose a scraped date.
  if (!hasExplicitScrapedDate(input)) {
    params.set("date", "all");
  }
  // List default region is INDIAN when omitted from the URL.
  if (!params.has("region") && !readParam(input, "region")) {
    params.set("region", "INDIAN");
  }
  return params;
}

export function tenderStatusCountQueryKey(
  input: URLSearchParams | Record<string, string | string[] | null | undefined>,
): string {
  return buildTenderStatusCountSearchParams(input).toString();
}

export function isTenderStatusCountParamKey(key: string): boolean {
  return STATUS_COUNT_KEY_SET.has(key);
}

/**
 * Flatten Next.js page `searchParams` into a plain object for zod parsing.
 * Drops `status` so SSR status-card counts stay status-agnostic.
 */
export function searchParamsForStatusCounts(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TENDER_STATUS_COUNT_PARAM_KEYS) {
    const value = readParam(raw, key);
    if (!value) continue;
    if (key === "source" && value === "ALL") continue;
    if (key === "region" && value === "ALL") continue;
    out[key] = value;
  }
  if (!hasExplicitScrapedDate(raw)) {
    out.date = "all";
  }
  if (!out.region) {
    out.region = "INDIAN";
  }
  return out;
}

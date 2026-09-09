/**
 * Status-card counts are a facet over the current tender population.
 * They must use every active list filter EXCEPT status (and pagination/sort).
 */

/** URL/query keys that affect status-card counts (never includes `status`). */
export const TENDER_STATUS_COUNT_PARAM_KEYS = [
  "q",
  "source",
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
    params.set(key, value);
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
    out[key] = value;
  }
  return out;
}

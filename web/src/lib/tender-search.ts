/** Minimum trimmed length before a tender list search hits the server. */
export const MIN_TENDER_SEARCH_LENGTH = 3;

/** Debounce before committing search text to the URL / API. */
export const TENDER_SEARCH_DEBOUNCE_MS = 450;

/** Indexed / useful fields for list search — avoid large JSON / description. */
export const TENDER_SEARCH_OR_FIELDS = [
  "title",
  "source_tender_id",
  "reference_no",
  "organization",
  "authority",
] as const;

export function trimTenderSearchInput(raw: string | null | undefined): string {
  return String(raw ?? "").trim();
}

/** True when the trimmed input is long enough to run a server search. */
export function shouldRunTenderSearch(raw: string | null | undefined): boolean {
  return trimTenderSearchInput(raw).length >= MIN_TENDER_SEARCH_LENGTH;
}

/**
 * Value to put in the URL / API `q` param.
 * Empty / whitespace / 1–2 chars → `undefined` (no search filter).
 */
export function effectiveTenderSearchQuery(
  raw: string | null | undefined,
): string | undefined {
  const trimmed = trimTenderSearchInput(raw);
  if (trimmed.length < MIN_TENDER_SEARCH_LENGTH) return undefined;
  return trimmed;
}

/** Short helper under the search box when the user typed 1–2 non-space chars. */
export function tenderSearchHint(
  raw: string | null | undefined,
): string | null {
  const trimmed = trimTenderSearchInput(raw);
  if (trimmed.length === 0) return null;
  if (trimmed.length < MIN_TENDER_SEARCH_LENGTH) {
    return "Type at least 3 characters";
  }
  return null;
}

/**
 * Resolve what the next URL `q` should be after local input changes.
 * - Cleared / whitespace → clear server search immediately
 * - 1–2 chars → clear server search (do not query for short terms)
 * - 3+ chars → commit the trimmed term (caller still debounces navigate)
 */
export function nextSearchQueryParam(
  localInput: string,
  currentUrlQuery: string | null | undefined,
): { action: "none" | "clear" | "search"; q?: string } {
  const next = trimTenderSearchInput(localInput);
  const current = trimTenderSearchInput(currentUrlQuery);

  if (next.length === 0 || next.length < MIN_TENDER_SEARCH_LENGTH) {
    if (current.length > 0) return { action: "clear" };
    return { action: "none" };
  }

  if (next === current) return { action: "none" };
  return { action: "search", q: next };
}

export function buildTenderSearchOrFilter(escapedTerm: string): string {
  return TENDER_SEARCH_OR_FIELDS.map(
    (field) => `${field}.ilike.%${escapedTerm}%`,
  ).join(",");
}

/** Accept only the latest async response (stale-request protection). */
export function createRequestSerial() {
  let current = 0;
  return {
    next(): number {
      current += 1;
      return current;
    },
    isLatest(id: number): boolean {
      return id === current;
    },
  };
}

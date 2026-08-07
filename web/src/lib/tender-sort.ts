/**
 * Whitelisted tender-list sort fields (URL key → DB column).
 * Never pass arbitrary URL values to Supabase .order().
 *
 * Status sort uses the DB column `effective_qualification_status` (lexical /
 * stable). Explicit business rank (GO → CONDITIONAL_GO → … → NOT_EVALUATED)
 * is not applied server-side without a generated column or RPC.
 */
export const TENDER_SORT_COLUMNS = {
  title: "title",
  source: "source_portal",
  status: "effective_qualification_status",
  closing: "closing_date",
  value: "tender_value",
  emd: "emd_amount",
  // Legacy / default keys
  updated_at: "updated_at",
  crawled_at: "crawled_at",
  first_seen_at: "first_seen_at",
  tender_value: "tender_value",
  emd_amount: "emd_amount",
  source_portal: "source_portal",
  closing_date: "closing_date",
  qualification_status: "effective_qualification_status",
} as const;

export type TenderSortKey = keyof typeof TENDER_SORT_COLUMNS;

export const DEFAULT_TENDER_SORT_BY = "updated_at" as const;
export const DEFAULT_TENDER_SORT_DIR = "desc" as const;

export function resolveTenderSortColumn(sortBy: string | undefined): string {
  if (!sortBy) return TENDER_SORT_COLUMNS[DEFAULT_TENDER_SORT_BY];
  const mapped = TENDER_SORT_COLUMNS[sortBy as TenderSortKey];
  return mapped ?? TENDER_SORT_COLUMNS[DEFAULT_TENDER_SORT_BY];
}

export function isWhitelistedSortKey(sortBy: string | undefined): boolean {
  return Boolean(sortBy && sortBy in TENDER_SORT_COLUMNS);
}

/** Canonical URL sort keys shown in the table headers. */
export const TABLE_SORT_KEYS = [
  "title",
  "source",
  "status",
  "closing",
  "value",
  "emd",
] as const;

export type TableSortKey = (typeof TABLE_SORT_KEYS)[number];

/**
 * Cycle: unsorted/default → asc → desc → reset to default.
 * Clicking a different column starts at asc.
 */
export function nextSortState(options: {
  currentSortBy: string;
  currentSortDir: "asc" | "desc";
  clicked: TableSortKey;
}): { sortBy: string; sortDir: "asc" | "desc" } | { reset: true } {
  const isActive =
    options.currentSortBy === options.clicked ||
    TENDER_SORT_COLUMNS[options.currentSortBy as TenderSortKey] ===
      TENDER_SORT_COLUMNS[options.clicked];

  if (!isActive) {
    return { sortBy: options.clicked, sortDir: "asc" };
  }
  if (options.currentSortDir === "asc") {
    return { sortBy: options.clicked, sortDir: "desc" };
  }
  return { reset: true };
}

export function normalizeSortKeyForUi(sortBy: string): TableSortKey | null {
  const reverse: Record<string, TableSortKey> = {
    title: "title",
    source: "source",
    source_portal: "source",
    status: "status",
    qualification_status: "status",
    effective_qualification_status: "status",
    closing: "closing",
    closing_date: "closing",
    value: "value",
    tender_value: "value",
    emd: "emd",
    emd_amount: "emd",
  };
  return reverse[sortBy] ?? null;
}

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
  match: "confidence",
  confidence: "confidence",
  created: "created_at",
  created_at: "created_at",
  created_date: "created_at",
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

export const DEFAULT_TENDER_SORT_BY = "created_at" as const;
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
  "created",
  "title",
  "source",
  "status",
  "closing",
  "value",
  "emd",
  "match",
] as const;

export type TableSortKey = (typeof TABLE_SORT_KEYS)[number];

export const TENDER_SORT_MODES = [
  { id: "created_desc", label: "Created: Newest First", sort: "created_at", dir: "desc" },
  { id: "created_asc", label: "Created: Oldest First", sort: "created_at", dir: "asc" },
  { id: "closing_asc", label: "Deadline: Soonest First", sort: "closing", dir: "asc" },
  { id: "closing_desc", label: "Deadline: Latest First", sort: "closing", dir: "desc" },
  { id: "value_desc", label: "Value: High to Low", sort: "value", dir: "desc" },
  { id: "emd_desc", label: "EMD: High to Low", sort: "emd", dir: "desc" },
  { id: "match_desc", label: "Match: High to Low", sort: "match", dir: "desc" },
  { id: "status_asc", label: "Status", sort: "status", dir: "asc" },
] as const;

export function sortModeId(sortBy: string, sortDir: "asc" | "desc"): string {
  const column = resolveTenderSortColumn(sortBy);
  if (column === "created_at") return sortDir === "asc" ? "created_asc" : "created_desc";
  if (column === "closing_date") return sortDir === "asc" ? "closing_asc" : "closing_desc";
  if (column === "tender_value") return sortDir === "desc" ? "value_desc" : "value_desc";
  if (column === "emd_amount") return "emd_desc";
  if (column === "confidence") return "match_desc";
  if (column === "effective_qualification_status") return "status_asc";
  return "created_desc";
}

/**
 * Cycle: unsorted/default → desc for created, otherwise asc → desc → reset.
 * Clicking a different column starts at a natural default for that field.
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

  const startDir: "asc" | "desc" =
    options.clicked === "created" ||
    options.clicked === "value" ||
    options.clicked === "emd" ||
    options.clicked === "match"
      ? "desc"
      : "asc";

  if (!isActive) {
    return { sortBy: options.clicked, sortDir: startDir };
  }
  if (options.currentSortDir === startDir) {
    return {
      sortBy: options.clicked,
      sortDir: startDir === "desc" ? "asc" : "desc",
    };
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
    match: "match",
    confidence: "match",
    created: "created",
    created_at: "created",
    created_date: "created",
  };
  return reverse[sortBy] ?? null;
}

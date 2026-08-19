/**
 * Display helpers for analytics / dashboard charts.
 * No AI inference — normalize and format only.
 */

import {
  getTenderUiStatus,
  TENDER_UI_STATUS_LABELS,
} from "@/lib/tender-status";
import {
  isProjectCategory,
  type ProjectCategory,
} from "@/lib/project-category";

/** Known portal category strings → compact display labels. */
const CATEGORY_DISPLAY_ALIASES: Record<string, string> = {
  "software and it solutions": "Software & IT Solutions",
  "software & it solutions": "Software & IT Solutions",
  "software and it solutions category": "Software & IT Solutions",
};

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word === "&") return "&";
      if (/^[A-Z0-9]+$/.test(word) && word.length <= 4) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Display normalization for category labels.
 * Null/blank → Uncategorized. Never invents classifications from titles.
 */
export function normalizeCategoryDisplay(
  raw: string | null | undefined,
): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return "Uncategorized";

  const alias = CATEGORY_DISPLAY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  return titleCaseWords(trimmed.replace(/\s+/g, " "));
}

export type AnalyticsCategoryRow = {
  source_portal?: string | null;
  category?: string | null;
  project_category?: string | null;
  normalized_category?: string | null;
  /** Never used as a category fallback — reserved to detect misuse. */
  title?: string | null;
};

/**
 * Resolve the category used in Top Categories analytics.
 * Uses stored project_category only. Never displays raw portal titles.
 */
export function resolveAnalyticsCategory(row: AnalyticsCategoryRow): ProjectCategory | "Other" {
  if (isProjectCategory(row.project_category)) {
    return row.project_category;
  }
  if (isProjectCategory(row.normalized_category)) {
    return row.normalized_category;
  }
  return "Other";
}

export type TopCategoryDatum = {
  /** Truncated label for axis ticks. */
  name: string;
  /** Full label for tooltips. */
  fullName: string;
  count: number;
};

export function truncateCategoryLabel(
  label: string,
  maxChars = 28,
): string {
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Top N categories by count; remaining combined into "Other" when needed.
 * At most `maxBars` bars (default 6), including Other when applicable.
 */
export function buildTopCategories(
  counts: Map<string, number> | Record<string, number>,
  maxBars = 6,
): TopCategoryDatum[] {
  const entries =
    counts instanceof Map
      ? [...counts.entries()]
      : Object.entries(counts);

  const sorted = entries
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (sorted.length === 0) return [];

  if (sorted.length <= maxBars) {
    return sorted.map(([fullName, count]) => ({
      name: truncateCategoryLabel(fullName),
      fullName,
      count,
    }));
  }

  const headCount = maxBars - 1;
  const head = sorted.slice(0, headCount);
  const otherCount = sorted
    .slice(headCount)
    .reduce((sum, [, count]) => sum + count, 0);

  return [
    ...head.map(([fullName, count]) => ({
      name: truncateCategoryLabel(fullName),
      fullName,
      count,
    })),
    {
      name: "Other",
      fullName: "Other",
      count: otherCount,
    },
  ];
}

/** Human-readable decision / qualification status for charts and tooltips. */
export function formatDecisionStatus(status: string | null | undefined): string {
  return TENDER_UI_STATUS_LABELS[getTenderUiStatus(status)];
}

/** Compact tender count copy for tooltips: "6 tenders". */
export function compactTenderCount(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  return `${n} tender${n === 1 ? "" : "s"}`;
}

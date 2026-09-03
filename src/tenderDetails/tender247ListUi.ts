import type { Page } from "playwright";

/** Fresh tab badge — accepts plain counts and compact forms like 1.00 K / 518. */
export const FRESH_TAB_BADGE_RE = /Fresh\s*\(\s*[^)]+\s*\)/i;

const T247_ID_IN_TEXT_RE = /T247\s*ID\s*[-–—:]?\s*\d{5,}/i;

export type ParsedListCount = {
  /** Parsed / rounded display value (e.g. 1.00 K → 1000). */
  value: number;
  /** True when K / Lakh / Crore notation lost precision. */
  approximate: boolean;
  /** Inclusive integers that can display as this compact token. */
  min: number;
  max: number;
  /** Original paren token, e.g. "1.00 K" or "518". */
  token: string;
};

function decimalPlaces(coeffText: string): number {
  const dot = coeffText.indexOf(".");
  return dot < 0 ? 0 : coeffText.length - dot - 1;
}

/**
 * Inclusive integer range that rounds to `coefficient` with `decimals`
 * when dividing by `unit` (JS Number#toFixed half-up semantics).
 */
export function compactDisplayRange(
  coefficient: number,
  decimals: number,
  unit: number,
): { min: number; max: number } {
  const target = coefficient.toFixed(decimals);
  const center = Math.round(coefficient * unit);
  let min = center;
  let max = center;
  while (min > 0 && ((min - 1) / unit).toFixed(decimals) === target) {
    min -= 1;
  }
  while (((max + 1) / unit).toFixed(decimals) === target) {
    max += 1;
  }
  return { min, max };
}

/**
 * Parse Tender247 list tab counts: 518, 1.00 K, 1.03 Lakh, etc.
 * Compact suffixes are marked approximate with a rounding range.
 */
export function parseCompactListCountDetails(
  raw: string,
): ParsedListCount | null {
  const token = raw.trim().replace(/,/g, "");
  if (!token) return null;

  const plain = token.match(/^(\d+)$/);
  if (plain) {
    const value = Number(plain[1]);
    if (!Number.isFinite(value)) return null;
    return {
      value,
      approximate: false,
      min: value,
      max: value,
      token,
    };
  }

  const k = token.match(/^([\d.]+)\s*k$/i);
  if (k) {
    const coeffText = k[1]!;
    const coefficient = Number(coeffText);
    if (!Number.isFinite(coefficient)) return null;
    const decimals = decimalPlaces(coeffText);
    const value = Math.round(coefficient * 1_000);
    const { min, max } = compactDisplayRange(coefficient, decimals, 1_000);
    return { value, approximate: true, min, max, token };
  }

  const lakh = token.match(/^([\d.]+)\s*(?:l|lac|lakh)$/i);
  if (lakh) {
    const coeffText = lakh[1]!;
    const coefficient = Number(coeffText);
    if (!Number.isFinite(coefficient)) return null;
    const decimals = decimalPlaces(coeffText);
    const value = Math.round(coefficient * 1_00_000);
    const { min, max } = compactDisplayRange(coefficient, decimals, 1_00_000);
    return { value, approximate: true, min, max, token };
  }

  const crore = token.match(/^([\d.]+)\s*(?:cr|crore|crores)$/i);
  if (crore) {
    const coeffText = crore[1]!;
    const coefficient = Number(coeffText);
    if (!Number.isFinite(coefficient)) return null;
    const decimals = decimalPlaces(coeffText);
    const value = Math.round(coefficient * 1_00_00_000);
    const { min, max } = compactDisplayRange(
      coefficient,
      decimals,
      1_00_00_000,
    );
    return { value, approximate: true, min, max, token };
  }

  const digits = token.match(/([\d.]+)/);
  if (!digits) return null;
  const n = Number(digits[1]);
  if (!Number.isFinite(n)) return null;
  const value = Math.round(n);
  return {
    value,
    approximate: false,
    min: value,
    max: value,
    token,
  };
}

export function parseCompactListCount(raw: string): number | null {
  return parseCompactListCountDetails(raw)?.value ?? null;
}

/** True when an exact Excel row count is consistent with a (possibly compact) web badge. */
export function excelCountMatchesWebBadge(
  web: ParsedListCount | null | undefined,
  excelRowCount: number,
): boolean {
  if (!web) return false;
  if (web.value === excelRowCount) return true;
  if (!web.approximate) return false;
  return excelRowCount >= web.min && excelRowCount <= web.max;
}

export async function isFreshTabBadgeVisible(page: Page): Promise<boolean> {
  return page
    .getByText(FRESH_TAB_BADGE_RE)
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * Detect rendered tender cards even when T247 ID text is split across nodes.
 */
export async function hasVisibleTender247Cards(page: Page): Promise<boolean> {
  if (
    await page
      .getByText(T247_ID_IN_TEXT_RE)
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    return true;
  }

  const detailLink = page.locator('a[href*="/auth/tender/"]').first();
  if (await detailLink.isVisible().catch(() => false)) {
    return true;
  }

  return page
    .evaluate(() => T247_ID_IN_TEXT_RE.test(document.body?.innerText || ""))
    .catch(() => false);
}

export async function readFreshTabCountDetails(
  page: Page,
): Promise<ParsedListCount | null> {
  const fresh = page.getByText(FRESH_TAB_BADGE_RE).first();
  if (!(await fresh.isVisible().catch(() => false))) {
    return null;
  }
  const text = ((await fresh.innerText().catch(() => "")) || "").replace(
    /\s+/g,
    " ",
  );
  const match = text.match(/Fresh\s*\(\s*([^)]+)\s*\)/i);
  if (!match) return null;
  return parseCompactListCountDetails(match[1]!.trim());
}

export async function readFreshTabCount(page: Page): Promise<number> {
  return (await readFreshTabCountDetails(page))?.value ?? 0;
}

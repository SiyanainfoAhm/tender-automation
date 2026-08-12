/**
 * Canonical INR amount parser for Tender247 financial gating.
 *
 * Accepts plain INR numerics (Excel often stores "56261544" without ₹),
 * Indian/western grouping, ₹/Rs/INR prefixes, and Lakh/Crore units.
 *
 * BidAssist keeps its stricter parseIndianCurrencyAmount (requires currency
 * evidence) to avoid parsing prose — do not change BidAssist defaults here.
 */
export type ParsedInrAmount = {
  amountInr: number | null;
  valid: boolean;
  reason?:
    | "empty"
    | "placeholder"
    | "invalid"
    | "no_numeric"
    | "parsed";
  rawText: string | null;
  unitDetected?: string | null;
};

const PLACEHOLDER_RE =
  /^(?:-|—|–|n\/?a|na|n\.?\s*a\.?|not\s+(?:available|disclosed|applicable)|refer\s+documents?|refer\s+docs?|as\s+per\s+(?:rfp|tender(?:\s+document)?)|see\s+(?:the\s+)?documents?)$/i;

const CRORE_RE = /\b(crores?|crs?|cr)\b\.?/i;
const LAKH_RE = /\b(lakhs?|lacs?)\b\.?/i;
const STANDALONE_L_RE =
  /(?:^|[^a-zA-Z])(-?\d+(?:\.\d+)?)\s*L(?:\s|[.,;:]|$)/;
const THOUSAND_RE = /\b(thousands?|k)\b\.?/i;

function stripGrouping(numText: string): string {
  return numText.replace(/,/g, "");
}

function roundMoney(value: number): number {
  if (Number.isInteger(value)) return value;
  return Math.round(value * 100) / 100;
}

function detectUnit(text: string): { unit: string | null; multiplier: number } {
  const lower = text.toLowerCase();
  if (/\d(?:[\s,]*)?(?:crores?|crs?|cr)\b/i.test(lower) || CRORE_RE.test(lower)) {
    return { unit: "crore", multiplier: 10_000_000 };
  }
  if (/\d(?:[\s,]*)?(?:lakhs?|lacs?)\b/i.test(lower) || LAKH_RE.test(lower)) {
    return { unit: "lakh", multiplier: 100_000 };
  }
  if (STANDALONE_L_RE.test(text) || STANDALONE_L_RE.test(lower)) {
    return { unit: "L", multiplier: 100_000 };
  }
  if (THOUSAND_RE.test(lower)) {
    return { unit: "thousand", multiplier: 1_000 };
  }
  return { unit: null, multiplier: 1 };
}

function extractNumeric(text: string, unit: string | null): number | null {
  if (unit === "crore") {
    const m = text.match(
      /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?:crores?|crs?|cr)\b\.?/i,
    );
    if (m) {
      const n = Number(stripGrouping(m[1]!));
      return Number.isFinite(n) ? n : null;
    }
  }
  if (unit === "lakh") {
    const m = text.match(
      /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?)\b\.?/i,
    );
    if (m) {
      const n = Number(stripGrouping(m[1]!));
      return Number.isFinite(n) ? n : null;
    }
  }
  if (unit === "L") {
    const m = text.match(
      /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*L(?:\s|[.,;:]|$)/i,
    );
    if (m) {
      const n = Number(stripGrouping(m[1]!));
      return Number.isFinite(n) ? n : null;
    }
  }
  if (unit === "thousand") {
    const m = text.match(
      /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?:thousands?|k)\b\.?/i,
    );
    if (m) {
      const n = Number(stripGrouping(m[1]!));
      return Number.isFinite(n) ? n : null;
    }
  }

  const compact = text.match(
    /(-?\d+(?:\.\d+)?)(?:lakhs?|lacs?|crores?|crs?|cr)\b/i,
  );
  if (compact) {
    const n = Number(compact[1]);
    return Number.isFinite(n) ? n : null;
  }

  // Entire string is a plain / grouped INR amount (Excel text cells).
  const plainWhole = text.match(
    /^\s*(?:₹|rs\.?|inr)?\s*(-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?:\/-)?\s*$/i,
  );
  if (plainWhole) {
    const n = Number(stripGrouping(plainWhole[1]!));
    return Number.isFinite(n) ? n : null;
  }

  const grouped = text.match(/-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?/);
  if (grouped) {
    const n = Number(stripGrouping(grouped[0]));
    return Number.isFinite(n) ? n : null;
  }

  const plain = text.match(/-?\d+(?:\.\d+)?/);
  if (!plain) return null;
  const n = Number(plain[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an INR amount from Excel / portal text.
 * Plain digit strings are valid INR (unlike BidAssist prose-safe parser).
 */
export function parseInrAmount(value: unknown): ParsedInrAmount {
  if (value === null || value === undefined) {
    return { amountInr: null, valid: false, reason: "empty", rawText: null };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return {
        amountInr: null,
        valid: false,
        reason: "invalid",
        rawText: String(value),
      };
    }
    return {
      amountInr: value,
      valid: true,
      reason: "parsed",
      rawText: String(value),
      unitDetected: null,
    };
  }

  const rawText = String(value).replace(/\u00a0/g, " ").trim();
  if (!rawText) {
    return { amountInr: null, valid: false, reason: "empty", rawText: null };
  }

  if (PLACEHOLDER_RE.test(rawText)) {
    return {
      amountInr: null,
      valid: false,
      reason: "placeholder",
      rawText,
    };
  }

  const { unit, multiplier } = detectUnit(rawText);
  const forNumber = rawText
    .replace(/₹/g, " ")
    .replace(/\binr\b/gi, " ")
    .replace(/\brs\.?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const numeric = extractNumeric(forNumber.length > 0 ? forNumber : rawText, unit);
  if (numeric == null || numeric < 0) {
    return {
      amountInr: null,
      valid: false,
      reason: "no_numeric",
      rawText,
      unitDetected: unit,
    };
  }

  const amountInr = roundMoney(numeric * multiplier);
  return {
    amountInr,
    valid: true,
    reason: "parsed",
    rawText,
    unitDetected: unit,
  };
}

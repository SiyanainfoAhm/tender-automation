/**
 * Shared Indian-currency amount parser for BidAssist (and reusable elsewhere).
 *
 * Unit detection happens BEFORE stripping currency markers. Plain numbers are
 * accepted only when there is strong currency evidence (₹ / Rs / INR / Lac / Cr).
 */

export type ParsedIndianCurrencyAmount = {
  amount: number | null;
  normalizedText: string | null;
  valid: boolean;
  reason?: string;
  unitDetected?: string | null;
  numericComponent?: number | null;
  multiplier?: number | null;
};

const PLACEHOLDER_RE =
  /^(refer\s+documents?|refer\s+docs?|as\s+per\s+(?:rfp|tender(?:\s+document)?)|not\s+(?:available|disclosed|applicable)|n\.?\s*a\.?|na|nil|--|—|–)$/i;

const CURRENCY_ONLY_RE = /^(?:rs\.?|inr|₹|,|\s)+$/i;

/** Crore units (checked before lakh so "crore" wins cleanly). */
const CRORE_UNIT_RE = /\b(crores?|crs?|cr)\b\.?/i;
/** Lakh / lac units — do not use bare "l" here (matched separately). */
const LAKH_UNIT_RE = /\b(lakhs?|lacs?)\b\.?/i;
/**
 * Standalone L as lakh only when it is a dedicated unit token after a number,
 * e.g. "₹25 L" or "25 L." — not the letter L inside "Lac", "valid", etc.
 */
const STANDALONE_L_UNIT_RE =
  /(?:^|[^a-zA-Z])(-?\d+(?:\.\d+)?)\s*L(?:\s|[.,;:]|$)/;

const CURRENCY_MARKER_RE = /(?:₹|\binr\b|\brs\.?\b)/i;

const THOUSAND_UNIT_RE = /\b(thousands?|k)\b\.?/i;

function roundMoney(value: number): number {
  if (Number.isInteger(value)) {
    return value;
  }
  return Math.round(value * 100) / 100;
}

function stripIndianGrouping(numText: string): string {
  return numText.replace(/,/g, "");
}

function detectUnit(
  normalizedLower: string,
  original: string,
): {
  unit: string | null;
  multiplier: number;
} {
  // Compact forms like "25Lac" / "1.5Cr" (no word-boundary before unit).
  if (/\d(?:[\s,]*)?(?:crores?|crs?|cr)\b/i.test(normalizedLower)) {
    return { unit: "crore", multiplier: 10_000_000 };
  }
  if (/\d(?:[\s,]*)?(?:lakhs?|lacs?)\b/i.test(normalizedLower)) {
    return { unit: "lakh", multiplier: 100_000 };
  }
  if (CRORE_UNIT_RE.test(normalizedLower)) {
    return { unit: "crore", multiplier: 10_000_000 };
  }
  if (LAKH_UNIT_RE.test(normalizedLower)) {
    return { unit: "lakh", multiplier: 100_000 };
  }
  if (
    STANDALONE_L_UNIT_RE.test(original) ||
    STANDALONE_L_UNIT_RE.test(normalizedLower)
  ) {
    return { unit: "L", multiplier: 100_000 };
  }
  if (THOUSAND_UNIT_RE.test(normalizedLower)) {
    return { unit: "thousand", multiplier: 1_000 };
  }
  return { unit: null, multiplier: 1 };
}

function hasCurrencyEvidence(
  original: string,
  unit: string | null,
): boolean {
  if (CURRENCY_MARKER_RE.test(original)) return true;
  if (
    unit === "crore" ||
    unit === "lakh" ||
    unit === "L" ||
    unit === "thousand"
  ) {
    return true;
  }
  return false;
}

function extractNumericComponent(
  text: string,
  unit: string | null,
): number | null {
  // Prefer number immediately before a known unit.
  if (unit === "crore") {
    const m = text.match(
      /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?:crores?|crs?|cr)\b\.?/i,
    );
    if (m) {
      const n = Number(stripIndianGrouping(m[1]!));
      return Number.isFinite(n) ? n : null;
    }
  }
  if (unit === "lakh") {
    const m = text.match(
      /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?)\b\.?/i,
    );
    if (m) {
      const n = Number(stripIndianGrouping(m[1]!));
      return Number.isFinite(n) ? n : null;
    }
  }
  if (unit === "L") {
    const m = text.match(
      /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*L(?:\s|[.,;:]|$)/i,
    );
    if (m) {
      const n = Number(stripIndianGrouping(m[1]!));
      return Number.isFinite(n) ? n : null;
    }
  }
  if (unit === "thousand") {
    const m = text.match(
      /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?:thousands?|k)\b\.?/i,
    );
    if (m) {
      const n = Number(stripIndianGrouping(m[1]!));
      return Number.isFinite(n) ? n : null;
    }
  }

  // Compact forms: 25Lac / 1.5Cr (no space) — unit already detected
  const compact = text.match(
    /(-?\d+(?:\.\d+)?)(?:lakhs?|lacs?|crores?|crs?|cr)\b/i,
  );
  if (compact) {
    const n = Number(compact[1]);
    return Number.isFinite(n) ? n : null;
  }

  // Indian / western grouped integers with currency marker context
  const grouped = text.match(/-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?/);
  if (grouped) {
    const n = Number(stripIndianGrouping(grouped[0]));
    return Number.isFinite(n) ? n : null;
  }

  const plain = text.match(/-?\d+(?:\.\d+)?/);
  if (!plain) return null;
  const n = Number(plain[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse tender/EMD amount text into a numeric INR value.
 * Rejects placeholders, currency-only markers, and prose numbers without
 * currency evidence (e.g. "valid for 6 months").
 */
export function parseIndianCurrencyAmount(
  value: unknown,
  options?: { log?: boolean; sourceField?: string },
): ParsedIndianCurrencyAmount {
  const logEnabled = options?.log === true;
  const logParse = (fields: {
    sourceText?: string | null;
    unit?: string | null;
    numericComponent?: number | null;
    multiplier?: number | null;
    amount?: number | null;
  }) => {
    if (!logEnabled) return;
    const sourceField = options?.sourceField ?? "unknown";
    console.log(`FINANCIAL_SOURCE_FIELD=${sourceField}`);
    console.log(`FINANCIAL_SOURCE_TEXT=${fields.sourceText ?? ""}`);
    console.log(`FINANCIAL_UNIT_DETECTED=${fields.unit ?? "none"}`);
    console.log(
      `FINANCIAL_NUMERIC_COMPONENT=${fields.numericComponent ?? "null"}`,
    );
    console.log(`FINANCIAL_MULTIPLIER=${fields.multiplier ?? "null"}`);
    console.log(`FINANCIAL_AMOUNT_INR=${fields.amount ?? "null"}`);
  };

  if (value === null || value === undefined) {
    return { amount: null, normalizedText: null, valid: false, reason: "empty" };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return {
        amount: null,
        normalizedText: null,
        valid: false,
        reason: "invalid_number",
      };
    }
    return {
      amount: value,
      normalizedText: String(value),
      valid: true,
      unitDetected: null,
      numericComponent: value,
      multiplier: 1,
    };
  }

  const original = String(value).replace(/\u00a0/g, " ").trim();
  if (!original) {
    return { amount: null, normalizedText: null, valid: false, reason: "empty" };
  }

  if (PLACEHOLDER_RE.test(original)) {
    return {
      amount: null,
      normalizedText: original,
      valid: false,
      reason: "placeholder",
    };
  }

  if (CURRENCY_ONLY_RE.test(original)) {
    return {
      amount: null,
      normalizedText: null,
      valid: false,
      reason: "currency_marker_only",
    };
  }

  // Detect magnitude from the original string BEFORE stripping markers/units.
  const normalizedLower = original.toLowerCase();
  const { unit, multiplier } = detectUnit(normalizedLower, original);

  if (!hasCurrencyEvidence(original, unit)) {
    logParse({
      sourceText: original,
      unit,
      numericComponent: null,
      multiplier,
      amount: null,
    });
    return {
      amount: null,
      normalizedText: original,
      valid: false,
      reason: "no_currency_evidence",
      unitDetected: unit,
      numericComponent: null,
      multiplier,
    };
  }

  const forNumber = original
    .replace(/₹/g, " ")
    .replace(/\binr\b/gi, " ")
    .replace(/\brs\.?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !forNumber ||
    CURRENCY_ONLY_RE.test(forNumber) ||
    /^[,.\s-]+$/.test(forNumber)
  ) {
    return {
      amount: null,
      normalizedText: null,
      valid: false,
      reason: "currency_marker_only",
    };
  }

  const numericComponent = extractNumericComponent(forNumber, unit);
  if (numericComponent == null || numericComponent < 0) {
    logParse({
      sourceText: original,
      unit,
      numericComponent: null,
      multiplier,
      amount: null,
    });
    return {
      amount: null,
      normalizedText: original,
      valid: false,
      reason: "no_numeric",
      unitDetected: unit,
      numericComponent: null,
      multiplier,
    };
  }

  const amount = roundMoney(numericComponent * multiplier);
  logParse({
    sourceText: original,
    unit,
    numericComponent,
    multiplier,
    amount,
  });

  return {
    amount,
    normalizedText: original,
    valid: true,
    unitDetected: unit,
    numericComponent,
    multiplier,
  };
}

/** True when text is a meaningless currency marker that must not be stored. */
export function isMeaninglessCurrencyText(value: unknown): boolean {
  const parsed = parseIndianCurrencyAmount(value);
  return parsed.reason === "currency_marker_only";
}

function looksLikeMoneyOrPlaceholderText(text: string): boolean {
  if (PLACEHOLDER_RE.test(text)) return true;
  if (CURRENCY_MARKER_RE.test(text)) return true;
  if (CRORE_UNIT_RE.test(text) || LAKH_UNIT_RE.test(text)) return true;
  if (/not\s+required|exempt|nil/i.test(text)) return true;
  if (/^\d/.test(text) && /(?:lac|lakh|cr|crore|inr|rs)/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * Prefer a unit-aware reparse of source text over a stale bare coefficient
 * (e.g. stored 25 from truncated "₹25 L" when text is "₹25 Lac").
 */
export function resolveCanonicalInrAmount(options: {
  amount: number | null | undefined;
  text: string | null | undefined;
}): { amount: number | null; text: string | null } {
  const text =
    options.text == null
      ? null
      : String(options.text).replace(/\u00a0/g, " ").trim() || null;
  const existing =
    typeof options.amount === "number" && Number.isFinite(options.amount)
      ? options.amount
      : null;

  const parsed = text ? parseIndianCurrencyAmount(text) : null;
  if (parsed?.valid && parsed.amount != null) {
    if (
      existing == null ||
      existing === parsed.amount ||
      (parsed.multiplier != null && parsed.multiplier > 1) ||
      (existing < 1_000 && parsed.amount >= 1_000)
    ) {
      return {
        amount: parsed.amount,
        text: parsed.normalizedText || text,
      };
    }
  }

  if (existing != null) {
    // Reject tiny amounts that came from prose (no currency evidence in text).
    if (
      text &&
      existing > 0 &&
      existing < 1_000 &&
      parsed &&
      !parsed.valid &&
      parsed.reason === "no_currency_evidence"
    ) {
      return {
        amount: null,
        text: looksLikeMoneyOrPlaceholderText(text) ? text : null,
      };
    }
    return { amount: existing, text };
  }

  if (parsed && !parsed.valid && parsed.reason === "placeholder" && text) {
    return { amount: null, text };
  }

  if (parsed && parsed.reason === "currency_marker_only") {
    return { amount: null, text: null };
  }

  if (text && !looksLikeMoneyOrPlaceholderText(text)) {
    return { amount: null, text: null };
  }

  return { amount: null, text };
}

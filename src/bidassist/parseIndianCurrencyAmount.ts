/**
 * Shared Indian-currency amount parser for BidAssist (and reusable elsewhere).
 */

export type ParsedIndianCurrencyAmount = {
  amount: number | null;
  normalizedText: string | null;
  valid: boolean;
  reason?: string;
};

const PLACEHOLDER_RE =
  /^(refer\s+documents?|refer\s+docs?|as\s+per\s+(?:rfp|tender(?:\s+document)?)|not\s+(?:available|disclosed|applicable)|n\.?\s*a\.?|na|nil|--|—|–)$/i;

const CURRENCY_ONLY_RE = /^(?:rs\.?|inr|₹|,|\s)+$/i;

function unitMultiplier(unit: string): number {
  const u = unit.toLowerCase().replace(/\./g, "");
  switch (u) {
    case "thousand":
    case "thousands":
    case "k":
      return 1_000;
    case "lac":
    case "lacs":
    case "lakh":
    case "lakhs":
      return 100_000;
    case "cr":
    case "crs":
    case "crore":
    case "crores":
      return 10_000_000;
    default:
      return 1;
  }
}

function roundMoney(value: number): number {
  if (Number.isInteger(value)) {
    return value;
  }
  return Math.round(value * 100) / 100;
}

function stripIndianGrouping(numText: string): string {
  // Indian: 12,00,00,000 or Western: 1,200,000
  return numText.replace(/,/g, "");
}

/**
 * Parse tender/EMD amount text into a numeric INR value.
 * Rejects placeholders and currency-only markers (rs, ₹, INR).
 */
export function parseIndianCurrencyAmount(
  value: unknown,
): ParsedIndianCurrencyAmount {
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

  let text = original
    .replace(/₹/g, "")
    .replace(/\binr\b/gi, "")
    .replace(/\brs\.?\b/gi, "")
    .trim();

  // After stripping currency, reject if nothing meaningful remains
  if (!text || CURRENCY_ONLY_RE.test(text) || /^[,.\s-]+$/.test(text)) {
    return {
      amount: null,
      normalizedText: null,
      valid: false,
      reason: "currency_marker_only",
    };
  }

  const multiplierMatch = text.match(
    /^(-?\d+(?:\.\d+)?)\s*(thousands?|k|lacs?|lakhs?|crores?|crs?|cr\.?)\.?$/i,
  );
  if (multiplierMatch) {
    const base = Number(multiplierMatch[1]);
    const unit = multiplierMatch[2] ?? "";
    if (!Number.isFinite(base)) {
      return {
        amount: null,
        normalizedText: original,
        valid: false,
        reason: "malformed",
      };
    }
    return {
      amount: roundMoney(base * unitMultiplier(unit)),
      normalizedText: original,
      valid: true,
    };
  }

  const embedded = text.match(
    /(-?\d+(?:\.\d+)?)\s*(thousands?|k|lacs?|lakhs?|crores?|crs?|cr\.?)\.?/i,
  );
  if (embedded && /[a-zA-Z]/.test(text)) {
    const base = Number(embedded[1]);
    const unit = embedded[2] ?? "";
    if (Number.isFinite(base)) {
      return {
        amount: roundMoney(base * unitMultiplier(unit)),
        normalizedText: original,
        valid: true,
      };
    }
  }

  // Indian / western grouped integers: 5,61,000 or 12,00,00,000
  const grouped = text.match(/-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?/);
  if (grouped) {
    const num = Number(stripIndianGrouping(grouped[0]));
    if (Number.isFinite(num) && num >= 0) {
      return {
        amount: roundMoney(num),
        normalizedText: original,
        valid: true,
      };
    }
  }

  const plain = text.match(/-?\d+(?:\.\d+)?/);
  if (!plain) {
    return {
      amount: null,
      normalizedText: original,
      valid: false,
      reason: "no_numeric",
    };
  }
  const num = Number(plain[0]);
  if (!Number.isFinite(num) || num < 0) {
    return {
      amount: null,
      normalizedText: original,
      valid: false,
      reason: "malformed",
    };
  }

  return {
    amount: roundMoney(num),
    normalizedText: original,
    valid: true,
  };
}

/** True when text is a meaningless currency marker that must not be stored. */
export function isMeaninglessCurrencyText(value: unknown): boolean {
  const parsed = parseIndianCurrencyAmount(value);
  return parsed.reason === "currency_marker_only";
}

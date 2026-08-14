/**
 * Shared INR display formatters for tenders UI.
 * Stored amounts are always raw INR; crore/lakh conversion is display-only.
 */

const CRORE = 1_00_00_000;
const LAKH = 1_00_000;

export type MoneyDisplay = {
  /** Primary cell text, e.g. "₹6.20 Cr" or "Not disclosed" */
  label: string;
  /** Optional tooltip with full INR or source explanation */
  tooltip: string | null;
  /** Whether this is a numeric amount (for alignment / styling) */
  isNumeric: boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stripNoiseText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Recover when DB stored a bare coefficient (e.g. 25) but source text still
 * carries Lac/Cr units (e.g. "₹25 Lac"). Display must never show "₹25" for lakhs.
 */
export function recoverInrAmountFromText(
  amount: number | null | undefined,
  text: string | null | undefined,
): number | null {
  if (!isFiniteNumber(amount)) return null;
  if (!text) return amount;

  const source = stripNoiseText(text);
  const lower = source.toLowerCase();

  const crore = source.match(
    /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?:crores?|crs?|cr)\b/i,
  );
  if (crore) {
    const coeff = Number(String(crore[1]).replace(/,/g, ""));
    if (Number.isFinite(coeff)) {
      const full = Math.round(coeff * CRORE * 100) / 100;
      if (amount === coeff || (amount < 1_000 && full >= CRORE / 10)) {
        return full;
      }
    }
  }

  const lakh = source.match(
    /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|l(?![a-z]))\b/i,
  );
  if (lakh) {
    const coeff = Number(String(lakh[1]).replace(/,/g, ""));
    if (Number.isFinite(coeff)) {
      const full = Math.round(coeff * LAKH * 100) / 100;
      if (amount === coeff || (amount < 1_000 && full >= LAKH / 10)) {
        return full;
      }
    }
  }

  // Tiny stored amount + prose without currency units → treat as non-numeric.
  if (
    amount > 0 &&
    amount < 1_000 &&
    !/(?:₹|\brs\.?\b|\binr\b|\blakhs?\b|\blacs?\b|\bcrores?\b|\bcr\b)/i.test(
      lower,
    )
  ) {
    return null;
  }

  return amount;
}

/** Title-case source phrases for consistent display. */
export function normalizeMoneySourceText(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = stripNoiseText(raw);
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const known: Record<string, string> = {
    "refer documents": "Refer documents",
    "refer document": "Refer documents",
    "not disclosed": "Not disclosed",
    "as per rfp": "As per RFP",
    "not required": "Not required",
    nil: "Nil",
    exempted: "Exempted",
    exempt: "Exempted",
  };
  if (known[lower]) return known[lower];

  // Preserve short ALL-CAPS tokens; otherwise sentence-case lightly.
  if (trimmed === trimmed.toUpperCase() && trimmed.length <= 12) {
    return trimmed;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function formatCompactUnit(value: number): string {
  // Always two decimals for Cr/L so the unit is never ambiguous.
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * Format a numeric INR amount with an explicit unit for Cr / L.
 * Never returns a bare "₹6.2" without Cr/L when in those ranges.
 *
 * null / undefined / NaN → null (caller decides unavailable copy)
 */
export function formatInrCompactAmount(
  amount: number | null | undefined,
): string | null {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return null;
  }
  if (!Number.isFinite(amount)) {
    return null;
  }

  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);

  if (abs >= CRORE) {
    return `${sign}₹${formatCompactUnit(abs / CRORE)} Cr`;
  }
  if (abs >= LAKH) {
    return `${sign}₹${formatCompactUnit(abs / LAKH)} L`;
  }
  return `${sign}₹${abs.toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;
}

/** Full Indian-grouped rupee string for tooltips. */
export function formatInrFullAmount(
  amount: number | null | undefined,
): string | null {
  if (!isFiniteNumber(amount)) return null;
  const sign = amount < 0 ? "-" : "";
  return `${sign}₹${Math.abs(amount).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;
}

export function formatTenderValue(options: {
  amount?: number | null;
  text?: string | null;
}): MoneyDisplay {
  const recovered = recoverInrAmountFromText(options.amount, options.text);
  if (isFiniteNumber(recovered)) {
    const label = formatInrCompactAmount(recovered)!;
    return {
      label,
      tooltip: formatInrFullAmount(recovered),
      isNumeric: true,
    };
  }

  const normalized = normalizeMoneySourceText(options.text);
  if (normalized) {
    const lower = normalized.toLowerCase();
    const tooltip =
      lower.includes("refer") ||
      lower.includes("not disclosed") ||
      lower.includes("as per")
        ? "Tender value was not disclosed numerically by the source."
        : options.text
          ? stripNoiseText(options.text)
          : null;
    return {
      label: normalized,
      tooltip,
      isNumeric: false,
    };
  }

  return {
    label: "Not disclosed",
    tooltip: null,
    isNumeric: false,
  };
}

export function formatEmdAmount(options: {
  amount?: number | null;
  text?: string | null;
}): MoneyDisplay {
  const recovered = recoverInrAmountFromText(options.amount, options.text);
  if (isFiniteNumber(recovered)) {
    const label = formatInrCompactAmount(recovered)!;
    return {
      label,
      tooltip: formatInrFullAmount(recovered),
      isNumeric: true,
    };
  }

  const normalized = normalizeMoneySourceText(options.text);
  if (normalized) {
    const lower = normalized.toLowerCase();
    const tooltip =
      lower.includes("not required") ||
      lower === "nil" ||
      lower.includes("exempt") ||
      lower.includes("refer") ||
      lower.includes("as per")
        ? "EMD was not provided as a numeric amount by the source."
        : options.text
          ? stripNoiseText(options.text)
          : null;
    return {
      label: normalized,
      tooltip,
      isNumeric: false,
    };
  }

  return {
    label: "Not disclosed",
    tooltip: null,
    isNumeric: false,
  };
}

/**
 * Parse a user-entered INR amount. Accepts raw rupees or Cr/L suffixes.
 * "125000000", "₹ 12.5 Cr", "12.5 crore", "82 L" → numeric INR.
 */
export function parseInrInput(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = stripNoiseText(raw).replace(/₹/g, "").replace(/,/g, "").trim();
  if (!text) return null;

  const crore = text.match(
    /^(-?\d+(?:\.\d+)?)\s*(?:crores?|crs?|cr)$/i,
  );
  if (crore) {
    const n = Number(crore[1]) * CRORE;
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  }

  const lakh = text.match(
    /^(-?\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|l)$/i,
  );
  if (lakh) {
    const n = Number(lakh[1]) * LAKH;
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  }

  const n = Number(text.replace(/\s/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

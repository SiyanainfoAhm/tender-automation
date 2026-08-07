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

/** Title-case source phrases for consistent display. */
export function normalizeMoneySourceText(raw: string | null | undefined): string | null {
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
  const amount = options.amount;
  if (isFiniteNumber(amount)) {
    const label = formatInrCompactAmount(amount)!;
    return {
      label,
      tooltip: formatInrFullAmount(amount),
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
  const amount = options.amount;
  if (isFiniteNumber(amount)) {
    const label = formatInrCompactAmount(amount)!;
    return {
      label,
      tooltip: formatInrFullAmount(amount),
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

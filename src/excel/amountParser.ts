import { cleanCell } from "./types.js";

/**
 * Parse tender amount text into a numeric INR value.
 * Returns "" (blank) when the value is non-numeric / placeholder.
 * Never returns NaN.
 */
export function parseAmount(value: unknown): number | "" {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "";
    }
    return value;
  }

  if (value instanceof Date) {
    return "";
  }

  let text = cleanCell(value);
  if (!text) {
    return "";
  }

  const lower = text.toLowerCase();
  if (
    lower === "refer docs" ||
    lower === "refer document" ||
    lower === "as per tender" ||
    lower === "nil" ||
    lower === "n.a." ||
    lower === "not applicable"
  ) {
    return "";
  }

  // Strip currency labels / symbols
  text = text
    .replace(/₹/g, "")
    .replace(/\binr\b/gi, "")
    .replace(/\brs\.?\b/gi, "")
    .replace(/,/g, "")
    .trim();

  // Multiplier suffixes
  const multiplierMatch = text.match(
    /^(-?\d+(?:\.\d+)?)\s*(thousands?|k|lacs?|lakhs?|crores?|crs?|cr\.?)\.?$/i,
  );
  if (multiplierMatch) {
    const base = Number(multiplierMatch[1]);
    const unit = (multiplierMatch[2] ?? "").toLowerCase().replace(/\./g, "");
    if (!Number.isFinite(base)) {
      return "";
    }
    const multiplier = unitMultiplier(unit);
    return roundMoney(base * multiplier);
  }

  // Embedded unit words: "₹ 98.10 Cr." already partially stripped
  const embedded = text.match(
    /(-?\d+(?:\.\d+)?)\s*(thousands?|k|lacs?|lakhs?|crores?|crs?|cr\.?)\.?/i,
  );
  if (embedded && /[a-zA-Z]/.test(text)) {
    const base = Number(embedded[1]);
    const unit = (embedded[2] ?? "").toLowerCase().replace(/\./g, "");
    if (Number.isFinite(base)) {
      return roundMoney(base * unitMultiplier(unit));
    }
  }

  // Plain number (possibly with trailing junk)
  const plain = text.match(/-?\d+(?:\.\d+)?/);
  if (!plain) {
    return "";
  }
  const num = Number(plain[0]);
  if (!Number.isFinite(num)) {
    return "";
  }
  return num;
}

function unitMultiplier(unit: string): number {
  switch (unit) {
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
  // Keep integer rupees when close; otherwise 2 dp
  if (Number.isInteger(value)) {
    return value;
  }
  return Math.round(value * 100) / 100;
}

/** Normalize Yes/No style exemption fields. */
export function normalizeYesNo(value: unknown): string {
  const text = cleanCell(value).toLowerCase();
  if (!text) {
    return "";
  }
  if (["yes", "y", "true", "1", "exempted", "available"].includes(text)) {
    return "Yes";
  }
  if (["no", "n", "false", "0", "not exempted", "not available"].includes(text)) {
    return "No";
  }
  // Keep original trimmed casing for unexpected values
  return cleanCell(value);
}

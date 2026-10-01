export interface ParsedAmount { display: string; normalized: number | null; currency: string | null }
export function parseBidassistAmount(value: string | null | undefined): ParsedAmount {
  const display = (value ?? "").replace(/\s+/g, " ").trim();
  if (!display) return { display: "", normalized: null, currency: null };
  const numeric = display.match(/[\d,]+(?:\.\d+)?/);
  if (!numeric) return { display, normalized: null, currency: /(?:₹|â‚¹|\b(?:rs\.?|inr)\b)/i.test(display) ? "INR" : null };
  let amount = Number(numeric[0].replace(/,/g, ""));
  if (!Number.isFinite(amount)) amount = NaN;
  const lower = display.toLowerCase();
  if (/\b(?:lac|lacs|lakh|lakhs)\b/.test(lower)) amount *= 100000;
  else if (/\b(?:crore|crores|cr)\b/.test(lower)) amount *= 10000000;
  else if (/\b(?:thousand|k)\b/.test(lower)) amount *= 1000;
  return { display, normalized: Number.isFinite(amount) ? amount : null, currency: /(?:₹|â‚¹|\b(?:rs\.?|inr)\b)/i.test(display) ? "INR" : null };
}
export function parseBidderRank(value: string): string | null { return value.match(/\bL\s*(\d+)\b/i)?.[0].replace(/\s+/g, "").toUpperCase() ?? null; }
export function isAwardedBidder(value: string): boolean { return /\bawarded\b|accepted\s*-?\s*aoc/i.test(value); }
export function normalizeBidderName(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

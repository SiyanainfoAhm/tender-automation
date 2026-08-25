/**
 * Date / currency / status helpers for historical Excel → Supabase backfill.
 * Prefer date-only parsing (no UTC day-shift).
 */
import { parseAmount } from "../excel/amountParser.js";
import { parsePhase1Amount } from "../runScreening/phase1DecisionGuard.js";
import {
  coercePhase1WorkbookStatus,
  type Phase1ScreeningStatus,
} from "../runScreening/phase1Statuses.js";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a calendar day in Asia/Kolkata as YYYY-MM-DD (no UTC shift). */
export function formatIndiaCalendarDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

/**
 * Normalize Excel / string deadlines to YYYY-MM-DD.
 * "04-08-2026" stays 2026-08-04 (never 2026-08-03).
 */
export function toIsoDateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatIndiaCalendarDate(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial (1900 system)
    if (value > 20000 && value < 80000) {
      const utc = Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000;
      // Serial dates are calendar days — use UTC Y-M-D from the serial epoch math
      const d = new Date(utc);
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
    return null;
  }

  const text = String(value).trim();
  if (!text || text === "-" || /^n\/?a$/i.test(text)) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = text.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})(?:\s|$)/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    if (year >= 1990 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // Last resort: parse then India calendar (handles "Wed Aug 12 2026 …")
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return formatIndiaCalendarDate(new Date(parsed));
  }
  return null;
}

export function normalizeCurrencyAmount(raw: unknown): {
  amount: number | null;
  text: string | null;
} {
  if (raw == null || raw === "") return { amount: null, text: null };
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { amount: raw, text: String(raw) };
  }
  const text = String(raw).trim();
  if (!text || text === "-" || /^n\/?a$/i.test(text)) {
    return { amount: null, text: null };
  }
  const amount = parsePhase1Amount(text);
  if (amount == null) {
    const fallback = parseAmount(text);
    return {
      amount: typeof fallback === "number" ? fallback : null,
      text,
    };
  }
  return { amount, text };
}

export function normalizeHistoricalStatus(
  raw: unknown,
): Phase1ScreeningStatus | null {
  return coercePhase1WorkbookStatus(String(raw ?? ""));
}

export function parseExemptionFlag(raw: unknown): boolean | null {
  const text = String(raw ?? "").trim();
  if (!text || text === "-" || text === "20") return null;
  if (/^(yes|y|true|1|applicable|available)$/i.test(text)) return true;
  if (/^(no|n|false|0|na|n\/a|not\s*applicable)$/i.test(text)) return false;
  return null;
}

export function digitsT247(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const id = text.replace(/^T247[-\s]*/i, "");
  const digits = id.replace(/\D/g, "");
  return digits || id.trim();
}

export function cleanText(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Phase-1 screening JSON decisions — ChatGPT returns classification only.
 * Workbook structure is patched locally; GPT must never rebuild the XLSX.
 */
import { jsonrepair } from "jsonrepair";
import {
  coercePhase1WorkbookStatus,
  toPhase1WorkbookStatusLabel,
  type Phase1ScreeningStatus,
} from "./phase1Statuses.js";

export type ScreeningDecisionStatusLabel =
  | "NO_BID"
  | "VERIFY"
  | "MAY_BID"
  | "WILL_BID";

export type ScreeningDecision = {
  t247Id: string;
  screeningStatus: ScreeningDecisionStatusLabel;
  screeningReason: string;
  /** Internal enum used by run workbook / detail queue. */
  statusEnum: Phase1ScreeningStatus;
};

const ALLOWED_LABELS = new Set([
  "NO_BID",
  "VERIFY",
  "MAY_BID",
  "WILL_BID",
]);

export function digitsTenderId(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function extractBalancedJsonArray(text: string): string | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() || trimmed;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) return null;

  const slice = body.slice(start, end + 1);
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice[i]!;
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") depth -= 1;
    else if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  if (depth !== 0) return null;
  return slice;
}

function normalizeStatusLabel(raw: unknown): ScreeningDecisionStatusLabel | null {
  const text = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (ALLOWED_LABELS.has(text)) {
    return text as ScreeningDecisionStatusLabel;
  }
  const coerced = coercePhase1WorkbookStatus(String(raw ?? ""));
  if (!coerced) return null;
  const label = toPhase1WorkbookStatusLabel(coerced);
  return ALLOWED_LABELS.has(label)
    ? (label as ScreeningDecisionStatusLabel)
    : null;
}

function readDecisionFields(row: Record<string, unknown>): {
  t247Id: string;
  statusRaw: unknown;
  reason: string;
} {
  const t247Id = digitsTenderId(
    row.t247_id ??
      row.t247Id ??
      row.T247_ID ??
      row.tender247_id ??
      row.tenderId ??
      row.canonical_id ??
      row.canonicalId,
  );
  const statusRaw =
    row.screening_status ??
    row.screeningStatus ??
    row.status ??
    row.Screening_Status;
  const reason = String(
    row.screening_reason ??
      row.screeningReason ??
      row.reason ??
      row.Screening_Reason ??
      "",
  ).trim();
  return { t247Id, statusRaw, reason };
}

/**
 * Parse ChatGPT screening response into unique decisions keyed by T247 ID.
 */
export function parseScreeningDecisionsJson(
  text: string,
):
  | { ok: true; decisions: ScreeningDecision[]; rawCount: number }
  | { ok: false; error: string } {
  const slice = extractBalancedJsonArray(text);
  if (!slice) {
    return { ok: false, error: "no_balanced_json_array" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    try {
      parsed = JSON.parse(jsonrepair(slice));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `json_parse_failed:${message}` };
    }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: "screening_json_not_array" };
  }

  const byId = new Map<string, ScreeningDecision>();
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const { t247Id, statusRaw, reason } = readDecisionFields(
      item as Record<string, unknown>,
    );
    if (!t247Id) continue;
    const label = normalizeStatusLabel(statusRaw);
    if (!label) continue;
    const statusEnum = coercePhase1WorkbookStatus(label);
    if (!statusEnum) continue;
    byId.set(t247Id, {
      t247Id,
      screeningStatus: label,
      screeningReason: reason || `${label} — classified by Phase-1 screening.`,
      statusEnum,
    });
  }

  return {
    ok: true,
    decisions: [...byId.values()],
    rawCount: parsed.length,
  };
}

/** Fast stability check used by response wait loop. */
export function tryParseScreeningDecisionsJson(text: string): {
  ok: boolean;
  count: number;
} {
  const parsed = parseScreeningDecisionsJson(text);
  if (!parsed.ok) return { ok: false, count: 0 };
  return { ok: parsed.decisions.length > 0, count: parsed.decisions.length };
}

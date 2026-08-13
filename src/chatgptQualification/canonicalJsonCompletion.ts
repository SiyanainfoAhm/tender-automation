/**
 * Canonical qualification JSON completion — assistant text is authoritative.
 * Stale Stop/generation UI must not block once JSON is valid and stable.
 */
export const CANONICAL_STATUS_VALUES = [
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
  "VERIFY",
  "NO_GO",
] as const;

export type CanonicalStatus = (typeof CANONICAL_STATUS_VALUES)[number];

export const REQUIRED_JSON_STABLE_POLLS = 3;
export const DEFAULT_POST_JSON_UI_GRACE_MS = 5_000;

export type CanonicalJsonParseResult =
  | {
      ok: true;
      status: CanonicalStatus;
      object: Record<string, unknown>;
    }
  | { ok: false; reason: string };

export function getPostJsonUiGraceMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number.parseInt(env.CHATGPT_POST_JSON_UI_GRACE_MS || "5000", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_POST_JSON_UI_GRACE_MS;
}

function extractBalancedJsonSlice(text: string): string | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  const slice = trimmed.slice(start, end + 1);
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
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  if (depth !== 0) return null;
  return slice;
}

/**
 * Fast-path: parseable JSON object with a canonical qualification status.
 */
export function tryParseCanonicalQualificationJson(
  text: string,
  expectedT247Id?: string,
): CanonicalJsonParseResult {
  const slice = extractBalancedJsonSlice(text);
  if (!slice) {
    return { ok: false, reason: "no_balanced_json_object" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return { ok: false, reason: "json_parse_failed" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "not_object" };
  }

  const obj = parsed as Record<string, unknown>;
  const statusRaw = obj.status;
  if (typeof statusRaw !== "string") {
    return { ok: false, reason: "missing_status" };
  }
  const status = statusRaw.trim().toUpperCase();
  if (
    !CANONICAL_STATUS_VALUES.includes(status as CanonicalStatus) &&
    // Accept legacy aliases that normalize later
    !["WILL_BID", "NO_BID", "PARTNERSHIP", "MAY_BID"].includes(status)
  ) {
    return { ok: false, reason: `invalid_status=${statusRaw}` };
  }

  if (expectedT247Id) {
    const idFields = [obj.t247Id, obj.sourceTenderId, obj.tenderId]
      .filter((v) => typeof v === "string")
      .map((v) => String(v));
    const hay = `${JSON.stringify(obj)}`;
    const hasId =
      idFields.some((v) => v.includes(expectedT247Id)) ||
      hay.includes(expectedT247Id);
    if (!hasId) {
      return { ok: false, reason: "tender_id_mismatch" };
    }
  }

  // Prefer normalized canonical status when legacy alias present
  let canonicalStatus = status as CanonicalStatus;
  if (status === "WILL_BID") canonicalStatus = "GO";
  if (status === "NO_BID") canonicalStatus = "NO_GO";
  if (status === "PARTNERSHIP") canonicalStatus = "PARTNER_BID";
  if (status === "MAY_BID") canonicalStatus = "CONDITIONAL_GO";
  if (!CANONICAL_STATUS_VALUES.includes(canonicalStatus)) {
    return { ok: false, reason: `invalid_status=${statusRaw}` };
  }

  return { ok: true, status: canonicalStatus, object: obj };
}

export type JsonStabilityState = {
  stablePolls: number;
  lastHash: string | null;
  validJsonSeen: boolean;
  firstValidAtMs: number | null;
  /** When stablePolls first reached required threshold. */
  stableSinceMs: number | null;
};

export function createJsonStabilityState(): JsonStabilityState {
  return {
    stablePolls: 0,
    lastHash: null,
    validJsonSeen: false,
    firstValidAtMs: null,
    stableSinceMs: null,
  };
}

export type JsonStabilityTickResult = {
  state: JsonStabilityState;
  validJson: boolean;
  schemaValid: boolean;
  stable: boolean;
  shouldComplete: boolean;
  ignoreStaleStop: boolean;
  status: CanonicalStatus | null;
};

/**
 * Advance JSON stability counters from assistant text.
 * Completion may proceed even if Stop remains visible after grace.
 */
export function tickCanonicalJsonStability(options: {
  text: string;
  textHash: string;
  expectedT247Id?: string;
  previous: JsonStabilityState;
  nowMs: number;
  stopStillVisible: boolean;
  postJsonUiGraceMs?: number;
  requiredStablePolls?: number;
}): JsonStabilityTickResult {
  const required =
    options.requiredStablePolls ?? REQUIRED_JSON_STABLE_POLLS;
  const graceMs = options.postJsonUiGraceMs ?? DEFAULT_POST_JSON_UI_GRACE_MS;
  const parsed = tryParseCanonicalQualificationJson(
    options.text,
    options.expectedT247Id,
  );

  let state: JsonStabilityState = { ...options.previous };

  if (!parsed.ok) {
    state = {
      stablePolls: 0,
      lastHash: options.textHash,
      validJsonSeen: false,
      firstValidAtMs: null,
      stableSinceMs: null,
    };
    return {
      state,
      validJson: false,
      schemaValid: false,
      stable: false,
      shouldComplete: false,
      ignoreStaleStop: false,
      status: null,
    };
  }

  if (!state.validJsonSeen) {
    state = {
      validJsonSeen: true,
      firstValidAtMs: options.nowMs,
      stablePolls: 1,
      lastHash: options.textHash,
      stableSinceMs: null,
    };
  } else if (state.lastHash === options.textHash) {
    const nextPolls = state.stablePolls + 1;
    state = {
      ...state,
      stablePolls: nextPolls,
      lastHash: options.textHash,
      stableSinceMs:
        nextPolls >= required
          ? (state.stableSinceMs ?? options.nowMs)
          : null,
    };
  } else {
    // Text changed — reset stability
    state = {
      validJsonSeen: true,
      firstValidAtMs: options.nowMs,
      stablePolls: 1,
      lastHash: options.textHash,
      stableSinceMs: null,
    };
  }

  const stable = state.stablePolls >= required;
  const graceElapsed =
    state.stableSinceMs != null &&
    options.nowMs - state.stableSinceMs >= graceMs;
  const ignoreStaleStop =
    stable && options.stopStillVisible && graceElapsed;
  const shouldComplete =
    stable && (!options.stopStillVisible || graceElapsed);

  return {
    state,
    validJson: true,
    schemaValid: true,
    stable,
    shouldComplete,
    ignoreStaleStop,
    status: parsed.status,
  };
}

/**
 * Meaningful activity: text/count/label changes — NOT sticky Stop alone.
 */
export function isMeaningfulResponseActivityChange(options: {
  previousAssistantCount: number;
  nextAssistantCount: number;
  previousTextHash: string;
  nextTextHash: string;
  previousTextLength: number;
  nextTextLength: number;
  previousGenerationLabel: string;
  nextGenerationLabel: string;
}): boolean {
  if (options.previousAssistantCount !== options.nextAssistantCount) {
    return true;
  }
  if (options.previousTextHash !== options.nextTextHash) return true;
  if (options.previousTextLength !== options.nextTextLength) return true;
  if (options.previousGenerationLabel !== options.nextGenerationLabel) {
    return true;
  }
  return false;
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export interface PrescreenConfig {
  enabled: boolean;
  tenderValueMaxInr: number;
  tender247EmdMaxInr: number;
  minLeadDays: number;
  tender247RequireItRelevance: boolean;
  bidassistRequireItRelevance: boolean;
  rulesVersion: string;
  timezone: string;
}

export function loadPrescreenConfig(
  env: NodeJS.ProcessEnv = process.env,
): PrescreenConfig {
  return {
    enabled: parseBool(env.PRESCREEN_ENABLED, true),
    tenderValueMaxInr: parseNumber(
      env.PRESCREEN_TENDER_VALUE_MAX_INR,
      50_000_000,
    ),
    tender247EmdMaxInr: parseNumber(
      env.PRESCREEN_TENDER247_EMD_MAX_INR,
      1_500_000,
    ),
    minLeadDays: Math.max(0, Math.floor(parseNumber(env.PRESCREEN_MIN_LEAD_DAYS, 1))),
    tender247RequireItRelevance: parseBool(
      env.PRESCREEN_TENDER247_REQUIRE_IT_RELEVANCE,
      true,
    ),
    bidassistRequireItRelevance: parseBool(
      env.PRESCREEN_BIDASSIST_REQUIRE_IT_RELEVANCE,
      false,
    ),
    rulesVersion:
      env.PRESCREEN_RULES_VERSION?.trim() || "2026-08-06-v2",
    timezone: env.PRESCREEN_TIMEZONE?.trim() || "Asia/Kolkata",
  };
}

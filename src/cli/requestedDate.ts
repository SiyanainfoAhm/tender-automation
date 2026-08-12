/**
 * Canonical requested-date resolver for Tender247 / complete pipelines.
 *
 * Root cause of the historical `--date` bug (Windows PowerShell + npm):
 *   `npm run script -- --date=YYYY-MM-DD` often yields empty `process.argv`
 *   because PowerShell consumes the `--` separator. npm still exposes the
 *   value as `npm_config_date`, which this resolver reads as fallback.
 *   Direct `npx tsx … --date=…` always has argv; both paths must agree.
 *
 * Priority:
 *   CLI --date / --date=YYYY-MM-DD
 *     → npm_config_date (Windows PowerShell / npm forwarding fallback)
 *     → TENDER247_DATE / DATE env
 *     → current Asia/Kolkata calendar date (never UTC calendar day)
 *
 * Explicit malformed dates are rejected (never silently replaced with today).
 */
import {
  getArgOrNpmConfig,
  getArgValue,
  getNpmConfigValue,
  hasBooleanFlag,
  isValidIsoDate,
} from "../prescreen/prescreenBackfillArgs.js";
import { getIndiaTodayIsoDate } from "../dateUtils.js";

export type ResolveRequestedDateOptions = {
  /** When true, an explicit --date (or npm_config_date) is required. */
  requireExplicit?: boolean;
  /** Override "now" for tests. */
  now?: Date;
  env?: NodeJS.ProcessEnv;
};

export type ResolveRequestedDateResult = {
  requestedDate: string;
  source: "cli" | "npm_config" | "env" | "india_today";
  rawArgv: string[];
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidIsoDate(date: string, label = "--date"): string {
  const trimmed = date.trim();
  if (!ISO_DATE_RE.test(trimmed) || !isValidIsoDate(trimmed)) {
    throw new Error(`Invalid ${label}=${date}; expected YYYY-MM-DD`);
  }
  return trimmed;
}

/**
 * Resolve the immutable business date for a pipeline run from argv (+ env fallbacks).
 */
export function resolveRequestedDate(
  argv: string[],
  options: ResolveRequestedDateOptions = {},
): ResolveRequestedDateResult {
  const env = options.env ?? process.env;
  const rawArgv = [...argv];

  const fromCli = getArgValue(argv, "date");
  if (fromCli !== undefined) {
    return {
      requestedDate: assertValidIsoDate(fromCli, "--date"),
      source: "cli",
      rawArgv,
    };
  }

  const fromNpm = getNpmConfigValue("date", env);
  if (fromNpm !== undefined) {
    return {
      requestedDate: assertValidIsoDate(fromNpm, "npm_config_date"),
      source: "npm_config",
      rawArgv,
    };
  }

  const fromEnv =
    env.TENDER247_DATE?.trim() ||
    env.DATE?.trim() ||
    undefined;
  if (fromEnv) {
    return {
      requestedDate: assertValidIsoDate(fromEnv, "DATE"),
      source: "env",
      rawArgv,
    };
  }

  if (options.requireExplicit) {
    throw new Error(
      "Missing --date=YYYY-MM-DD (also checked npm_config_date / TENDER247_DATE / DATE)",
    );
  }

  return {
    requestedDate: getIndiaTodayIsoDate(options.now),
    source: "india_today",
    rawArgv,
  };
}

/** Convenience: date string only. */
export function resolveRequestedDateIso(
  argv: string[],
  options?: ResolveRequestedDateOptions,
): string {
  return resolveRequestedDate(argv, options).requestedDate;
}

/**
 * Hard consistency check for date propagation across layers.
 * Throws DATE_PROPAGATION_MISMATCH when any provided value differs.
 */
export function assertDatePropagationAgreement(
  requestedDate: string,
  labels: Record<string, string | null | undefined>,
): void {
  const expected = assertValidIsoDate(requestedDate, "requestedDate");
  for (const [label, value] of Object.entries(labels)) {
    if (value == null || value === "") continue;
    const actual = String(value).trim();
    if (actual !== expected) {
      throw new Error(
        `DATE_PROPAGATION_MISMATCH requested=${expected} ${label}=${actual}`,
      );
    }
  }
}

export function logRawArgv(argv: string[], prefix = "COMPLETE_E2E_RAW_ARGV"): void {
  console.log(`${prefix}=${JSON.stringify(argv)}`);
}

/**
 * Reconstruct effective CLI flags from npm_config_* when PowerShell emptied argv.
 * Used only for logging / diagnostics.
 */
export function effectiveArgvFromNpmConfig(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const out: string[] = [];
  const date = getNpmConfigValue("date", env);
  if (date) out.push(`--date=${date}`);
  if (hasBooleanFlag([], "dry-run-date", env)) out.push("--dry-run-date");
  if (hasBooleanFlag([], "cli-only", env)) out.push("--cli-only");
  if (hasBooleanFlag([], "resume", env)) out.push("--resume");
  const limit = getNpmConfigValue("limit", env);
  if (limit) out.push(`--limit=${limit}`);
  const chatgptLimit =
    getNpmConfigValue("chatgpt-limit", env) ||
    getNpmConfigValue("chatgpt_limit", env);
  if (chatgptLimit) out.push(`--chatgpt-limit=${chatgptLimit}`);
  const mode = getNpmConfigValue("mode", env);
  if (mode) out.push(`--mode=${mode}`);
  return out;
}

export {
  getArgOrNpmConfig,
  getArgValue,
  getNpmConfigValue,
  hasBooleanFlag,
  isValidIsoDate,
};

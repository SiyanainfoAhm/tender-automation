/**
 * CLI argument helpers for pre-screen backfill.
 * Supports both `--name=value` and `--name value`.
 *
 * On Windows PowerShell, `npm run script -- --date=...` often fails to
 * forward args (PowerShell consumes `--`). npm then exposes the values as
 * `npm_config_date`, `npm_config_source`, etc. We fall back to those.
 */

export function getArgValue(
  args: string[],
  name: string,
): string | undefined {
  const equalsPrefix = `--${name}=`;
  const equalsArg = args.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsArg) {
    const value = equalsArg.slice(equalsPrefix.length).trim();
    return value || undefined;
  }

  const index = args.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < args.length) {
    const value = args[index + 1]!;
    if (!value.startsWith("--")) {
      const trimmed = value.trim();
      return trimmed || undefined;
    }
  }

  return undefined;
}

/** Read npm-forwarded config when PowerShell swallows script args. */
export function getNpmConfigValue(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const key = `npm_config_${name.replace(/-/g, "_")}`;
  const value = env[key]?.trim();
  // npm sets bare `--flag` to "true"; treat that as absent for valued flags
  if (!value || value === "true" || value === "false") {
    return undefined;
  }
  return value;
}

export function getArgOrNpmConfig(
  args: string[],
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return getArgValue(args, name) ?? getNpmConfigValue(name, env);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) {
    return false;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export type PrescreenBackfillSource = "TENDER247" | "BIDASSIST";

export type ParsedPrescreenBackfillArgs = {
  ok: true;
  dateIso: string;
  source: PrescreenBackfillSource | null;
  sourceLabel: "ALL" | PrescreenBackfillSource;
  id: string | null;
};

export type ParsedPrescreenBackfillError = {
  ok: false;
  error:
    | "MISSING_DATE"
    | "INVALID_DATE"
    | "INVALID_PRESCREEN_SOURCE";
  message: string;
  value?: string;
};

export function parsePrescreenBackfillArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedPrescreenBackfillArgs | ParsedPrescreenBackfillError {
  const date = getArgOrNpmConfig(argv, "date", env);
  const sourceRaw = getArgOrNpmConfig(argv, "source", env);
  const idRaw = getArgOrNpmConfig(argv, "id", env);

  if (!date) {
    return {
      ok: false,
      error: "MISSING_DATE",
      message:
        "Usage: npm run backfill:prescreen -- --date=YYYY-MM-DD [--source=tender247|bidassist] [--id=SOURCE_TENDER_ID]",
    };
  }

  if (!isValidIsoDate(date)) {
    return {
      ok: false,
      error: "INVALID_DATE",
      message: `INVALID_PRESCREEN_DATE=${date}`,
      value: date,
    };
  }

  let source: PrescreenBackfillSource | null = null;
  if (sourceRaw !== undefined) {
    const normalized = sourceRaw.trim().toLowerCase();
    if (normalized === "tender247") {
      source = "TENDER247";
    } else if (normalized === "bidassist") {
      source = "BIDASSIST";
    } else {
      return {
        ok: false,
        error: "INVALID_PRESCREEN_SOURCE",
        message: `INVALID_PRESCREEN_SOURCE=${sourceRaw}`,
        value: sourceRaw,
      };
    }
  }

  return {
    ok: true,
    dateIso: date,
    source,
    sourceLabel: source ?? "ALL",
    id: idRaw?.trim() || null,
  };
}

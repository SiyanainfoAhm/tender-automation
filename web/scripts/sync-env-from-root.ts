import fs from "node:fs";
import path from "node:path";

const rootEnvPath = path.resolve(import.meta.dirname, "../../.env");
const webEnvPath = path.resolve(import.meta.dirname, "../.env");

const rootEnv = fs.readFileSync(rootEnvPath, "utf8");

function get(key: string, source = rootEnv): string {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
  return match ? match[1]!.trim().replace(/^["']|["']$/g, "") : "";
}

/** Keys that live only in web/.env and must survive sync-from-root. */
const WEB_ONLY_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_INGESTION_MODEL",
  "NEXT_PUBLIC_APP_NAME",
  "POWER_AUTOMATE_PASSWORD_RESET_EMAIL_URL",
  "POWER_AUTOMATE_EMAIL_URL",
  "TENDERFLOW_APP_URL",
  "AGENTTENDER_PASSWORD_RESET_MINUTES",
  "AGENTTENDER_REMEMBER_ME_HOURS",
] as const;

function preserveWebOnlyBlock(existingWebEnv: string): string[] {
  const lines: string[] = [];
  for (const key of WEB_ONLY_KEYS) {
    const value = get(key, existingWebEnv);
    if (value) lines.push(`${key}=${value}`);
  }

  const hasOpenAi = lines.some((l) => l.startsWith("OPENAI_API_KEY="));
  const hasModel = lines.some((l) => l.startsWith("OPENAI_INGESTION_MODEL="));

  const out: string[] = [
    "# Web-only settings (preserved across sync; not read from root .env).",
  ];
  out.push(...lines.filter((l) => !l.startsWith("OPENAI_")));
  out.push("");
  out.push("# Bid Workspace document ingestion (web-only).");
  if (hasOpenAi) {
    out.push(lines.find((l) => l.startsWith("OPENAI_API_KEY="))!);
  } else {
    out.push("OPENAI_API_KEY=");
  }
  if (hasModel) {
    out.push(lines.find((l) => l.startsWith("OPENAI_INGESTION_MODEL="))!);
  } else {
    out.push("OPENAI_INGESTION_MODEL=gpt-5-mini");
  }
  return out;
}

const url = get("SUPABASE_URL");
const key = get("SUPABASE_SECRET_KEY") || get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("Missing SUPABASE_URL or service key in root .env");
  process.exit(1);
}

const existingWeb = fs.existsSync(webEnvPath)
  ? fs.readFileSync(webEnvPath, "utf8")
  : "";

const lines = [
  `SUPABASE_URL=${url}`,
  `SUPABASE_SECRET_KEY=${key}`,
  `SUPABASE_SERVICE_ROLE_KEY=${key}`,
  "AGENTTENDER_SESSION_COOKIE=agenttender_session",
  "AGENTTENDER_SESSION_HOURS=8",
  "AGENTTENDER_LOGIN_MAX_ATTEMPTS=5",
  "AGENTTENDER_LOCK_MINUTES=15",
  `DOCUMENT_EXPIRY_SOON_DAYS=${get("DOCUMENT_EXPIRY_SOON_DAYS") || "30"}`,
  "",
  ...preserveWebOnlyBlock(existingWeb),
  "",
  "# Azure Blob secrets stay in root / Edge Functions only.",
  "",
];

fs.writeFileSync(webEnvPath, lines.join("\n"), "utf8");
console.log(
  "web/.env synchronized from root (ok); preserved web-only keys including OPENAI_*",
);

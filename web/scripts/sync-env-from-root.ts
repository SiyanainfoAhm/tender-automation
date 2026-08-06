import fs from "node:fs";
import path from "node:path";

const rootEnv = fs.readFileSync(
  path.resolve(import.meta.dirname, "../../.env"),
  "utf8",
);

function get(key: string): string {
  const match = rootEnv.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1]!.trim() : "";
}

const url = get("SUPABASE_URL");
const key = get("SUPABASE_SECRET_KEY") || get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("Missing SUPABASE_URL or service key in root .env");
  process.exit(1);
}

const out = [
  `SUPABASE_URL=${url}`,
  `SUPABASE_SECRET_KEY=${key}`,
  `SUPABASE_SERVICE_ROLE_KEY=${key}`,
  "AGENTTENDER_SESSION_COOKIE=agenttender_session",
  "AGENTTENDER_SESSION_HOURS=8",
  "AGENTTENDER_LOGIN_MAX_ATTEMPTS=5",
  "AGENTTENDER_LOCK_MINUTES=15",
  "NEXT_PUBLIC_APP_NAME=Siyana Tender Intelligence",
  "",
].join("\n");

fs.writeFileSync(path.resolve(import.meta.dirname, "../.env"), out, "utf8");
console.log("web/.env synchronized from root (ok)");

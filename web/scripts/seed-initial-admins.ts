/**
 * One-time seed for the four initial ADMIN accounts.
 * Password from AGENTTENDER_INITIAL_ADMIN_PASSWORD in .env.local only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { seedInitialAdmins } from "../src/server/seed/initialAdmins.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(root, "..");

function loadEnv(): void {
  const localPath = path.join(webRoot, ".env.local");
  const envPath = path.join(webRoot, ".env");
  if (fs.existsSync(localPath)) {
    dotenv.config({ path: localPath });
  }
  dotenv.config({ path: envPath });
}

async function main(): Promise<void> {
  loadEnv();

  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const password = process.env.AGENTTENDER_INITIAL_ADMIN_PASSWORD;
  const force =
    (process.env.AGENTTENDER_FORCE_ADMIN_PASSWORD_RESET || "false")
      .trim()
      .toLowerCase() === "true";

  if (!url || !key) {
    throw new Error("SUPABASE_URL and service key are required");
  }
  if (!password) {
    throw new Error(
      "AGENTTENDER_INITIAL_ADMIN_PASSWORD is required (set in web/.env.local)",
    );
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results = await seedInitialAdmins(supabase, {
    password,
    forcePasswordReset: force,
  });

  console.log("SEED_INITIAL_ADMINS_COMPLETE");
  console.log(`count=${results.length}`);
  for (const row of results) {
    console.log(
      `user=${row.email} role=${row.role} must_change_password=${row.must_change_password}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

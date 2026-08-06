import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL?.trim();

  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const table =
    process.env.SUPABASE_TENDER_TABLE?.trim() ||
    "agenttender_tenders";

  if (!url) {
    throw new Error("SUPABASE_URL is missing from .env");
  }

  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is missing from .env",
    );
  }

  console.log("SUPABASE_CONNECTION_TEST_START");
  console.log(`SUPABASE_PROJECT_URL=${url}`);
  console.log(`SUPABASE_TENDER_TABLE=${table}`);

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase
    .from(table)
    .select("id, source_portal, source_tender_id")
    .limit(1);

  if (error) {
    throw new Error(
      `SUPABASE_CONNECTION_TEST_FAILED: ${error.message}`,
    );
  }

  console.log("SUPABASE_CONNECTION_TEST_SUCCESS");
  console.log(`SUPABASE_ROWS_RETURNED=${data?.length ?? 0}`);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : String(error);

  console.error(message);
  process.exitCode = 1;
});

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

function resolveSupabaseKey(): string | undefined {
  return (
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    undefined
  );
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && resolveSupabaseKey());
}

/** Service-role client for crawler/qualification upserts and reads. */
export function getSupabaseAdminClient(): SupabaseClient {
  if (cached) {
    return cached;
  }
  const url = process.env.SUPABASE_URL?.trim();
  const key = resolveSupabaseKey();
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env",
    );
  }
  cached = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

/** Test helper — clear the singleton between unit tests. */
export function resetSupabaseAdminClientForTests(): void {
  cached = null;
}

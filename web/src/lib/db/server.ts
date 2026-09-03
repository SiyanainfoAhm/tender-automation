import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveServiceKey(): string {
  return (
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

let cached: SupabaseClient | null = null;

/** Server-only Supabase client with service role. Never import from client components. */
export function getServerSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = requireEnv("SUPABASE_URL");
  const key = resolveServiceKey();
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY",
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

/** @deprecated Prefer `@/lib/errors/app-error` — kept for compatibility. */
export { createCorrelationId } from "@/lib/errors/app-error";

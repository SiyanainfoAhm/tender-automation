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
let tender247MirrorCached: SupabaseClient | null = null;

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

/**
 * Service-role client for the separate Tender247 integration database. It is
 * deliberately distinct from the canonical application database client.
 */
export function getTender247MirrorSupabase(): SupabaseClient {
  if (tender247MirrorCached) return tender247MirrorCached;
  const url = requireEnv("TENDER247_MIRROR_SUPABASE_URL");
  const key = process.env.TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error(
      "Missing TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  tender247MirrorCached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return tender247MirrorCached;
}

/** @deprecated Prefer `@/lib/errors/app-error` — kept for compatibility. */
export { createCorrelationId } from "@/lib/errors/app-error";

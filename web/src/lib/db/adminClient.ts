import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DATABASE_REQUEST_TIMEOUT_MS = 30_000;

async function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Supabase request timed out after ${DATABASE_REQUEST_TIMEOUT_MS}ms`)), DATABASE_REQUEST_TIMEOUT_MS);
  const upstream = init?.signal;
  const abort = () => controller.abort(upstream?.reason);
  upstream?.addEventListener("abort", abort, { once: true });
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); upstream?.removeEventListener("abort", abort); }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function client(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timeoutFetch },
  });
}

/** Runtime-neutral service client: safe for Next server code and Node CLIs. */
export function createAdminSupabaseClient(): SupabaseClient {
  return client(requiredEnvironment("SUPABASE_URL"), requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"));
}

/** Runtime-neutral client for the separate Tender247 mirror project. */
export function createTender247MirrorSupabaseClient(): SupabaseClient {
  return client(
    requiredEnvironment("TENDER247_MIRROR_SUPABASE_URL"),
    requiredEnvironment("TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY"),
  );
}

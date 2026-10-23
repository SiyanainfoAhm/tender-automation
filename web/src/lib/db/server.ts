import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthSession } from "@/server/auth/session";

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
 * Request-scoped privileged client for a confirmed custom-auth human session.
 *
 * Tender Automation does not use Supabase Auth.  The database's terminal
 * status guard therefore cannot infer a human actor from `auth.uid()` when a
 * server-side service key performs the write.  These headers carry the
 * identity that was already validated by `requirePermissionStrict`; they are
 * deliberately created only on the server and are never available to browser
 * code or automation clients.
 *
 * Do not use this for scheduled jobs, importers, or AI/automation writes.
 */
export function humanActorHeaders(
  session: Pick<AuthSession, "sessionId" | "user">,
): Record<string, string> {
  return {
    "x-agenttender-actor": "human",
    "x-agenttender-actor-type": "human",
    "x-agenttender-authenticated": "true",
    "x-agenttender-user-id": session.user.id,
    "x-agenttender-actor-user-id": session.user.id,
    "x-agenttender-session-id": session.sessionId,
  };
}

export function getHumanActorServerSupabase(
  session: Pick<AuthSession, "sessionId" | "user">,
): SupabaseClient {
  const url = requireEnv("SUPABASE_URL");
  const key = resolveServiceKey();
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  // This must not share the module-level client: the actor headers are scoped
  // to one authenticated request and must never bleed into a later job.
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: humanActorHeaders(session) },
  });
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

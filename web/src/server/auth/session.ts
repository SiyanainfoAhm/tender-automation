import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/db/server";
import type { UserRole } from "@/lib/validations";

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  companyId: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

export type AuthSession = {
  sessionId: string;
  user: SessionUser;
  expiresAt: string;
};

const COOKIE_NAME =
  process.env.AGENTTENDER_SESSION_COOKIE?.trim() || "agenttender_session";

function sessionHours(): number {
  const n = Number.parseInt(
    process.env.AGENTTENDER_SESSION_HOURS || "8",
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 8;
}

function maxAttempts(): number {
  const n = Number.parseInt(
    process.env.AGENTTENDER_LOGIN_MAX_ATTEMPTS || "5",
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function lockMinutes(): number {
  const n = Number.parseInt(
    process.env.AGENTTENDER_LOCK_MINUTES || "15",
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 15;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

async function requestMeta(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;
  return { ip, userAgent: h.get("user-agent") };
}

export async function recordAuthEvent(options: {
  userId?: string | null;
  attemptedEmail?: string | null;
  eventType: string;
  success: boolean;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getServerSupabase();
  const meta = await requestMeta();
  await supabase.from("agenttender_auth_events").insert({
    user_id: options.userId ?? null,
    attempted_email: options.attemptedEmail ?? null,
    event_type: options.eventType,
    success: options.success,
    ip_address: meta.ip,
    user_agent: meta.userAgent,
    reason: options.reason ?? null,
    metadata: options.metadata ?? {},
  });
}

type DbUser = {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  role: UserRole;
  company_id: string | null;
  is_active: boolean;
  must_change_password: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
};

export type LoginResult =
  | { ok: true; user: SessionUser; mustChangePassword: boolean }
  | { ok: false; code: "INVALID" | "LOCKED" | "INACTIVE"; message: string };

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResult> {
  const supabase = getServerSupabase();
  const normalized = email.trim().toLowerCase();
  const meta = await requestMeta();

  const { data: user, error } = await supabase
    .from("agenttender_users")
    .select(
      "id, email, full_name, password_hash, role, company_id, is_active, must_change_password, failed_login_attempts, locked_until, last_login_at",
    )
    .ilike("email", normalized)
    .maybeSingle();

  if (error || !user) {
    await recordAuthEvent({
      attemptedEmail: normalized,
      eventType: "LOGIN_FAILED",
      success: false,
      reason: "user_not_found",
    });
    return {
      ok: false,
      code: "INVALID",
      message: "Unable to sign in with those credentials.",
    };
  }

  const row = user as DbUser;

  if (!row.is_active) {
    await recordAuthEvent({
      userId: row.id,
      attemptedEmail: normalized,
      eventType: "LOGIN_FAILED",
      success: false,
      reason: "inactive",
    });
    return {
      ok: false,
      code: "INACTIVE",
      message: "Unable to sign in with those credentials.",
    };
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    await recordAuthEvent({
      userId: row.id,
      attemptedEmail: normalized,
      eventType: "LOGIN_FAILED",
      success: false,
      reason: "locked",
    });
    return {
      ok: false,
      code: "LOCKED",
      message: `Account temporarily locked. Try again after ${new Date(row.locked_until).toLocaleString()}.`,
    };
  }

  const { data: verified, error: verifyError } = await supabase.rpc(
    "agenttender_verify_password",
    {
      plain_password: password,
      stored_hash: row.password_hash,
    },
  );

  if (verifyError || verified !== true) {
    const attempts = (row.failed_login_attempts || 0) + 1;
    const patch: Record<string, unknown> = {
      failed_login_attempts: attempts,
    };
    let locked = false;
    if (attempts >= maxAttempts()) {
      patch.locked_until = new Date(
        Date.now() + lockMinutes() * 60_000,
      ).toISOString();
      locked = true;
    }
    await supabase.from("agenttender_users").update(patch).eq("id", row.id);
    await recordAuthEvent({
      userId: row.id,
      attemptedEmail: normalized,
      eventType: locked ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
      success: false,
      reason: locked ? "max_attempts" : "bad_password",
    });
    if (locked) {
      return {
        ok: false,
        code: "LOCKED",
        message: `Account locked for ${lockMinutes()} minutes after too many failed attempts.`,
      };
    }
    return {
      ok: false,
      code: "INVALID",
      message: "Unable to sign in with those credentials.",
    };
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(
    Date.now() + sessionHours() * 60 * 60_000,
  ).toISOString();

  const { error: sessionError } = await supabase
    .from("agenttender_user_sessions")
    .insert({
      user_id: row.id,
      token_hash: tokenHash,
      ip_address: meta.ip,
      user_agent: meta.userAgent,
      expires_at: expiresAt,
    });

  if (sessionError) {
    throw new Error("Unable to create session");
  }

  await supabase
    .from("agenttender_users")
    .update({
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  await recordAuthEvent({
    userId: row.id,
    attemptedEmail: normalized,
    eventType: "LOGIN_SUCCESS",
    success: true,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });

  const sessionUser: SessionUser = {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    companyId: row.company_id ?? null,
    mustChangePassword: row.must_change_password,
    lastLoginAt: row.last_login_at,
  };

  return {
    ok: true,
    user: sessionUser,
    mustChangePassword: row.must_change_password,
  };
}

export async function logoutCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    const supabase = getServerSupabase();
    const tokenHash = hashSessionToken(token);
    const { data: session } = await supabase
      .from("agenttender_user_sessions")
      .select("id, user_id")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (session) {
      await supabase
        .from("agenttender_user_sessions")
        .update({
          revoked_at: new Date().toISOString(),
          revoke_reason: "logout",
        })
        .eq("id", session.id);
      await recordAuthEvent({
        userId: session.user_id,
        eventType: "LOGOUT",
        success: true,
      });
    }
  }
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const supabase = getServerSupabase();
  const tokenHash = hashSessionToken(token);

  const { data: session } = await supabase
    .from("agenttender_user_sessions")
    .select("id, user_id, expires_at, revoked_at, last_seen_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await recordAuthEvent({
      userId: session.user_id,
      eventType: "SESSION_EXPIRED",
      success: false,
    });
    return null;
  }

  const { data: user } = await supabase
    .from("agenttender_users")
    .select(
      "id, email, full_name, role, company_id, is_active, must_change_password, last_login_at",
    )
    .eq("id", session.user_id)
    .maybeSingle();

  if (!user || !user.is_active) return null;

  const lastSeen = session.last_seen_at
    ? new Date(session.last_seen_at).getTime()
    : 0;
  if (Date.now() - lastSeen > 5 * 60_000) {
    await supabase
      .from("agenttender_user_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", session.id);
  }

  return {
    sessionId: session.id,
    expiresAt: session.expires_at,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role as UserRole,
      companyId: (user.company_id as string) || null,
      mustChangePassword: user.must_change_password,
      lastLoginAt: user.last_login_at,
    },
  };
}

export async function requireSession(options?: {
  allowMustChangePassword?: boolean;
}): Promise<AuthSession> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (
    session.user.mustChangePassword &&
    !options?.allowMustChangePassword
  ) {
    redirect("/change-password");
  }
  return session;
}

export async function requireRole(
  ...roles: UserRole[]
): Promise<AuthSession> {
  const session = await requireSession({ allowMustChangePassword: false });
  if (!roles.includes(session.user.role)) {
    redirect("/dashboard");
  }
  return session;
}

export async function hashPassword(plain: string): Promise<string> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase.rpc("agenttender_hash_password", {
    plain_password: plain,
  });
  if (error || typeof data !== "string") {
    throw new Error(error?.message || "Unable to hash password");
  }
  return data;
}

export { COOKIE_NAME, maxAttempts, lockMinutes };

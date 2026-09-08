import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { getServerSupabase } from "@/lib/db/server";
import { hashPassword, recordAuthEvent } from "@/server/auth/session";
import { revokeAllSessionsExcept } from "@/server/repositories/userRepository";

const DEFAULT_RESET_TTL_MINUTES = 60;

function resetTtlMinutes(): number {
  const n = Number.parseInt(
    process.env.AGENTTENDER_PASSWORD_RESET_MINUTES || String(DEFAULT_RESET_TTL_MINUTES),
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RESET_TTL_MINUTES;
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generatePasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export type PasswordResetRequestResult =
  | { ok: true; emailSent: boolean; resetUrl?: string; email?: string }
  | { ok: false; error: string };

/**
 * Creates a one-time reset token for an active user.
 * Callers must not reveal whether the email exists.
 */
export async function createPasswordResetTokenForEmail(
  email: string,
): Promise<
  | { found: false }
  | {
      found: true;
      userId: string;
      email: string;
      fullName: string;
      rawToken: string;
      expiresAt: Date;
    }
> {
  const supabase = getServerSupabase();
  const normalized = email.trim().toLowerCase();

  const { data: user } = await supabase
    .from("agenttender_users")
    .select("id, email, full_name, is_active")
    .ilike("email", normalized)
    .maybeSingle();

  if (!user || !user.is_active) {
    return { found: false };
  }

  const rawToken = generatePasswordResetToken();
  const tokenHash = hashPasswordResetToken(rawToken);
  const expiresAt = new Date(Date.now() + resetTtlMinutes() * 60_000);

  // Invalidate any unused tokens for this user.
  await supabase
    .from("agenttender_password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("used_at", null);

  const { error } = await supabase.from("agenttender_password_reset_tokens").insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }

  await recordAuthEvent({
    userId: user.id,
    attemptedEmail: normalized,
    eventType: "PASSWORD_RESET_REQUESTED",
    success: true,
  });

  return {
    found: true,
    userId: user.id,
    email: user.email,
    fullName: user.full_name,
    rawToken,
    expiresAt,
  };
}

export async function consumePasswordResetToken(options: {
  rawToken: string;
  newPassword: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = getServerSupabase();
  const tokenHash = hashPasswordResetToken(options.rawToken.trim());

  const { data: row } = await supabase
    .from("agenttender_password_reset_tokens")
    .select("id, user_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!row) {
    return { ok: false, message: "This reset link is invalid or has expired." };
  }
  if (row.used_at) {
    return { ok: false, message: "This reset link has already been used." };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, message: "This reset link is invalid or has expired." };
  }

  const passwordHash = await hashPassword(options.newPassword);
  const now = new Date().toISOString();

  const { error: userError } = await supabase
    .from("agenttender_users")
    .update({
      password_hash: passwordHash,
      must_change_password: false,
      password_changed_at: now,
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq("id", row.user_id);

  if (userError) {
    return { ok: false, message: "Unable to update password. Please try again." };
  }

  await supabase
    .from("agenttender_password_reset_tokens")
    .update({ used_at: now })
    .eq("id", row.id);

  // Mark any other outstanding tokens used.
  await supabase
    .from("agenttender_password_reset_tokens")
    .update({ used_at: now })
    .eq("user_id", row.user_id)
    .is("used_at", null);

  await revokeAllSessionsExcept(row.user_id, null);

  await recordAuthEvent({
    userId: row.user_id,
    eventType: "PASSWORD_RESET",
    success: true,
    reason: "self_service_token",
  });

  return { ok: true };
}

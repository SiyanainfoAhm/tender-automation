import "server-only";

import { getServerSupabase } from "@/lib/db/server";

export type UserSessionRow = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: string;
  lastSeenAt: string;
  createdAt: string;
  revokedAt: string | null;
};

export async function listUserSessions(
  userId: string,
): Promise<UserSessionRow[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_user_sessions")
    .select(
      "id, ip_address, user_agent, expires_at, last_seen_at, created_at, revoked_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: row.id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeSession(
  sessionId: string,
  userId: string,
  reason = "user_revoke",
): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_user_sessions")
    .update({
      revoked_at: new Date().toISOString(),
      revoke_reason: reason,
    })
    .eq("id", sessionId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

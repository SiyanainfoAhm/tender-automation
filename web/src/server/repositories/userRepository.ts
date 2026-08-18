import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import { hashPassword, recordAuthEvent } from "@/server/auth/session";
import {
  assertAdminMutationAllowed,
  assertUserDeletionAllowed,
  countActiveAdmins,
  type AdminGuardUser,
} from "@/server/auth/admin-guards";
import {
  mapRowToSafeUser,
  SAFE_USER_SELECT,
  ADMIN_SAFE_USER_SELECT,
  type SafeAgentTenderUser,
} from "@/server/auth/safe-user";
import type { UserRole } from "@/lib/validations";

export type SafeUser = SafeAgentTenderUser & {
  failedLoginAttempts?: number;
  lockedUntil?: string | null;
};

function mapAdminUser(row: Record<string, unknown>): SafeUser {
  return {
    ...mapRowToSafeUser(row),
    failedLoginAttempts: Number(row.failed_login_attempts || 0),
    lockedUntil: (row.locked_until as string) || null,
  };
}

export async function listUsers(options?: {
  companyId?: string;
}): Promise<SafeUser[]> {
  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_users")
    .select(ADMIN_SAFE_USER_SELECT)
    .order("created_at", { ascending: false });

  if (options?.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => mapAdminUser(r as Record<string, unknown>));
}

export async function getUserById(id: string): Promise<SafeUser | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_users")
    .select(ADMIN_SAFE_USER_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapAdminUser(data as Record<string, unknown>) : null;
}

export async function getUserByEmail(
  email: string,
): Promise<SafeAgentTenderUser | null> {
  const supabase = getServerSupabase();
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase
    .from("agenttender_users")
    .select(SAFE_USER_SELECT)
    .ilike("email", normalized)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRowToSafeUser(data as Record<string, unknown>) : null;
}

export async function createUser(options: {
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  createdBy: string;
  companyId?: string | null;
}): Promise<SafeUser> {
  const supabase = getServerSupabase();
  const passwordHash = await hashPassword(options.password);
  const { data, error } = await supabase
    .from("agenttender_users")
    .insert({
      email: options.email.toLowerCase(),
      full_name: options.fullName,
      password_hash: passwordHash,
      role: options.role,
      company_id: options.companyId ?? null,
      must_change_password: true,
      created_by: options.createdBy,
      password_changed_at: new Date().toISOString(),
    })
    .select(ADMIN_SAFE_USER_SELECT)
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("agenttender_user_preferences").insert({
    user_id: data.id,
  });

  await recordAuthEvent({
    userId: options.createdBy,
    attemptedEmail: options.email,
    eventType: "USER_CREATED",
    success: true,
  });

  return mapAdminUser(data as Record<string, unknown>);
}

/**
 * Public self-registration. Creates a NEW company (never defaults to Siyana),
 * then an ADMIN user linked to that company (company creator).
 */
export async function registerPublicUser(options: {
  email: string;
  fullName: string;
  password: string;
  company: {
    name: string;
    industry?: string;
    companyType?: string;
    phone?: string;
    website?: string;
    location?: string;
  };
}): Promise<SafeUser> {
  const existing = await getUserByEmail(options.email);
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const { createCompany } = await import("./companyRepository");
  const company = await createCompany({
    name: options.company.name,
    industryType: options.company.industry || options.company.companyType || null,
    businessLocation: options.company.location || null,
    website: options.company.website || null,
  });

  const supabase = getServerSupabase();
  const passwordHash = await hashPassword(options.password);
  const { data, error } = await supabase
    .from("agenttender_users")
    .insert({
      email: options.email.toLowerCase(),
      full_name: options.fullName,
      password_hash: passwordHash,
      role: "ADMIN",
      company_id: company.id,
      must_change_password: false,
      created_by: null,
      password_changed_at: new Date().toISOString(),
    })
    .select(ADMIN_SAFE_USER_SELECT)
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("agenttender_user_preferences").insert({
    user_id: data.id,
    preferences: {
      companySignup: {
        phone: options.company.phone || "",
        companyType: options.company.companyType || "",
      },
    },
  });

  await supabase
    .from("agenttender_users")
    .update({ created_by: data.id })
    .eq("id", data.id);

  await recordAuthEvent({
    userId: data.id,
    attemptedEmail: options.email,
    eventType: "USER_CREATED",
    success: true,
  });

  return mapAdminUser(data as Record<string, unknown>);
}

export async function updateUser(
  id: string,
  patch: {
    fullName?: string;
    email?: string;
    role?: UserRole;
    isActive?: boolean;
    mustChangePassword?: boolean;
  },
  actorId: string,
): Promise<SafeUser> {
  const supabase = getServerSupabase();
  const target = await getUserById(id);
  if (!target) throw new Error("User not found");

  const companyUsers = target.companyId
    ? await listUsers({ companyId: target.companyId })
    : await listUsers();
  const guard = assertAdminMutationAllowed({
    actorId,
    target: target as AdminGuardUser,
    patch,
    activeAdminCount: countActiveAdmins(companyUsers as AdminGuardUser[]),
  });
  if (!guard.ok) throw new Error(guard.message);

  if (patch.email) {
    const normalized = patch.email.trim().toLowerCase();
    const existing = await getUserByEmail(normalized);
    if (existing && existing.id !== id) {
      throw new Error("Email is already in use");
    }
  }

  const update: Record<string, unknown> = {};
  if (patch.fullName != null) update.full_name = patch.fullName;
  if (patch.email != null) update.email = patch.email.trim().toLowerCase();
  if (patch.role != null) update.role = patch.role;
  if (patch.isActive != null) update.is_active = patch.isActive;
  if (patch.mustChangePassword != null) {
    update.must_change_password = patch.mustChangePassword;
  }

  const { data, error } = await supabase
    .from("agenttender_users")
    .update(update)
    .eq("id", id)
    .select(ADMIN_SAFE_USER_SELECT)
    .single();
  if (error) throw new Error(error.message);

  if (patch.isActive === false) {
    await recordAuthEvent({
      userId: actorId,
      eventType: "USER_DISABLED",
      success: true,
      reason: id,
    });
  } else if (patch.isActive === true) {
    await recordAuthEvent({
      userId: actorId,
      eventType: "USER_ENABLED",
      success: true,
      reason: id,
    });
  } else if (patch.fullName || patch.email || patch.role) {
    await recordAuthEvent({
      userId: actorId,
      eventType: "USER_UPDATED",
      success: true,
      reason: id,
    });
  }

  return mapAdminUser(data as Record<string, unknown>);
}

export async function updateOwnProfile(options: {
  userId: string;
  fullName: string;
  email: string;
  currentPassword?: string;
}): Promise<{ ok: true; user: SafeAgentTenderUser } | { ok: false; message: string }> {
  const supabase = getServerSupabase();
  const fullName = options.fullName.trim();
  const email = options.email.trim().toLowerCase();

  if (!fullName) return { ok: false, message: "Full name is required" };
  if (!email.includes("@")) return { ok: false, message: "Invalid email" };

  const existing = await getUserByEmail(email);
  if (existing && existing.id !== options.userId) {
    return { ok: false, message: "Email is already in use" };
  }

  if (options.currentPassword) {
    const { data: row } = await supabase
      .from("agenttender_users")
      .select("password_hash")
      .eq("id", options.userId)
      .maybeSingle();
    if (!row) return { ok: false, message: "User not found" };
    const { data: verified } = await supabase.rpc("agenttender_verify_password", {
      plain_password: options.currentPassword,
      stored_hash: row.password_hash,
    });
    if (verified !== true) {
      return { ok: false, message: "Current password is incorrect" };
    }
  }

  const { data, error } = await supabase
    .from("agenttender_users")
    .update({ full_name: fullName, email })
    .eq("id", options.userId)
    .select(SAFE_USER_SELECT)
    .single();

  if (error) return { ok: false, message: error.message };

  await recordAuthEvent({
    userId: options.userId,
    eventType: "USER_UPDATED",
    success: true,
    reason: "profile",
  });

  return { ok: true, user: mapRowToSafeUser(data as Record<string, unknown>) };
}

export async function unlockUser(id: string): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_users")
    .update({ locked_until: null, failed_login_attempts: 0 })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function resetUserPassword(options: {
  userId: string;
  temporaryPassword: string;
  actorId: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const passwordHash = await hashPassword(options.temporaryPassword);
  const { error } = await supabase
    .from("agenttender_users")
    .update({
      password_hash: passwordHash,
      must_change_password: true,
      password_changed_at: new Date().toISOString(),
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq("id", options.userId);
  if (error) throw new Error(error.message);

  await revokeAllSessionsExcept(options.userId, null);
  await recordAuthEvent({
    userId: options.actorId,
    eventType: "PASSWORD_RESET",
    success: true,
    reason: options.userId,
  });
}

export async function changeOwnPassword(options: {
  userId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (options.currentPassword === options.newPassword) {
    return {
      ok: false,
      message: "New password must differ from the current password",
    };
  }

  const supabase = getServerSupabase();
  const { data: user } = await supabase
    .from("agenttender_users")
    .select("password_hash")
    .eq("id", options.userId)
    .maybeSingle();
  if (!user) return { ok: false, message: "User not found" };

  const { data: verified } = await supabase.rpc("agenttender_verify_password", {
    plain_password: options.currentPassword,
    stored_hash: user.password_hash,
  });
  if (verified !== true) {
    return { ok: false, message: "Current password is incorrect" };
  }

  const passwordHash = await hashPassword(options.newPassword);
  const { error } = await supabase
    .from("agenttender_users")
    .update({
      password_hash: passwordHash,
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq("id", options.userId);
  if (error) return { ok: false, message: error.message };

  await revokeAllSessionsExcept(options.userId, options.currentSessionId);

  await recordAuthEvent({
    userId: options.userId,
    eventType: "PASSWORD_CHANGED",
    success: true,
  });

  return { ok: true };
}

export async function revokeAllSessionsExcept(
  userId: string,
  keepSessionId: string | null,
): Promise<void> {
  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_user_sessions")
    .update({
      revoked_at: new Date().toISOString(),
      revoke_reason: "sessions_revoked",
    })
    .eq("user_id", userId)
    .is("revoked_at", null);

  if (keepSessionId) {
    query = query.neq("id", keepSessionId);
  }

  const { error } = await query;
  if (error) throw new Error(error.message);

  await recordAuthEvent({
    userId,
    eventType: "SESSIONS_REVOKED",
    success: true,
  });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await revokeAllSessionsExcept(userId, null);
}

export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<void> {
  await revokeAllSessionsExcept(userId, currentSessionId);
}

export async function deleteCompanyUser(options: {
  userId: string;
  actorId: string;
  companyId: string;
}): Promise<void> {
  const target = await getUserById(options.userId);
  if (!target || target.companyId !== options.companyId) {
    throw new Error("User not found in your company.");
  }

  const companyUsers = await listUsers({ companyId: options.companyId });
  const guard = assertUserDeletionAllowed({
    actorId: options.actorId,
    target: target as AdminGuardUser,
    activeAdminCount: countActiveAdmins(companyUsers as AdminGuardUser[]),
  });
  if (!guard.ok) throw new Error(guard.message);

  await recordAuthEvent({
    userId: options.actorId,
    attemptedEmail: target.email,
    eventType: "USER_DISABLED",
    success: true,
    reason: `deleted:${target.id}`,
  });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_users")
    .delete()
    .eq("id", target.id)
    .eq("company_id", options.companyId)
    .select("id");

  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new Error("User not found in your company.");
  }
}

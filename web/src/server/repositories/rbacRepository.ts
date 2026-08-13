import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getServerSupabase } from "@/lib/db/server";
import {
  PERMISSION_CATALOG,
  ROLE_PERMISSIONS,
  type PermissionKey,
} from "@/lib/rbac/permissions";
import type { UserRole } from "@/lib/validations";

/** Upsert permission catalog + role mappings from code (idempotent). */
export async function syncPermissionCatalog(): Promise<void> {
  const supabase = getServerSupabase();

  for (const perm of PERMISSION_CATALOG) {
    const { error } = await supabase.from("agenttender_permissions").upsert(
      {
        key: perm.key,
        name: perm.name,
        category: perm.category,
        description: perm.description ?? null,
        sort_order: perm.sortOrder,
      },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
  }

  const { data: rows, error: listError } = await supabase
    .from("agenttender_permissions")
    .select("id, key");
  if (listError) throw new Error(listError.message);

  const byKey = new Map(
    (rows || []).map((r) => [String(r.key), String(r.id)]),
  );

  // Replace role mappings for known roles
  for (const [role, keys] of Object.entries(ROLE_PERMISSIONS) as [
    UserRole,
    PermissionKey[],
  ][]) {
    await supabase
      .from("agenttender_role_permissions")
      .delete()
      .eq("role", role);

    const inserts = keys
      .map((key) => {
        const permissionId = byKey.get(key);
        if (!permissionId) return null;
        return { role, permission_id: permissionId };
      })
      .filter(
        (row): row is { role: UserRole; permission_id: string } => row != null,
      );

    if (inserts.length > 0) {
      const { error } = await supabase
        .from("agenttender_role_permissions")
        .insert(inserts);
      if (error) throw new Error(error.message);
    }
  }
}

export type CompanyInvitation = {
  id: string;
  companyId: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  status: "pending" | "accepted" | "expired" | "cancelled";
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
};

function mapInvite(row: Record<string, unknown>): CompanyInvitation {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    email: String(row.email),
    fullName: (row.full_name as string) || null,
    role: row.role as UserRole,
    status: row.status as CompanyInvitation["status"],
    invitedBy: (row.invited_by as string) || null,
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
  };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function listCompanyInvitations(options: {
  companyId: string;
  status?: CompanyInvitation["status"];
}): Promise<CompanyInvitation[]> {
  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_company_user_invitations")
    .select("*")
    .eq("company_id", options.companyId)
    .order("created_at", { ascending: false });

  if (options.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => mapInvite(r as Record<string, unknown>));
}

export async function countPendingInvites(companyId: string): Promise<number> {
  const supabase = getServerSupabase();
  const { count, error } = await supabase
    .from("agenttender_company_user_invitations")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function createCompanyInvitation(options: {
  companyId: string;
  email: string;
  fullName?: string | null;
  role: UserRole;
  invitedBy: string;
  expiresInDays?: number;
}): Promise<{ invite: CompanyInvitation; rawToken: string }> {
  const email = options.email.trim().toLowerCase();
  const supabase = getServerSupabase();

  // Expire stale pending invites for same email
  await supabase
    .from("agenttender_company_user_invitations")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", options.companyId)
    .eq("status", "pending")
    .ilike("email", email);

  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + (options.expiresInDays ?? 7) * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("agenttender_company_user_invitations")
    .insert({
      company_id: options.companyId,
      email,
      full_name: options.fullName?.trim() || null,
      role: options.role,
      status: "pending",
      invited_by: options.invitedBy,
      token_hash: hashInviteToken(rawToken),
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return {
    invite: mapInvite(data as Record<string, unknown>),
    rawToken,
  };
}

export async function cancelCompanyInvitation(options: {
  companyId: string;
  invitationId: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_company_user_invitations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", options.invitationId)
    .eq("company_id", options.companyId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}

export async function acceptCompanyInvitation(options: {
  companyId: string;
  invitationId: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_company_user_invitations")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", options.invitationId)
    .eq("company_id", options.companyId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}

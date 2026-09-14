import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import type { UserRole } from "@/lib/validations";

export type CompanyMembership = {
  id: string;
  userId: string;
  companyId: string;
  role: UserRole;
  status: "active" | "disabled";
  createdAt: string;
  companyName?: string;
};

function mapMembership(row: Record<string, unknown>): CompanyMembership {
  const company = row.company as Record<string, unknown> | null | undefined;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    companyId: String(row.company_id),
    role: row.role as UserRole,
    status: (row.status as "active" | "disabled") || "active",
    createdAt: String(row.created_at),
    companyName: company?.name ? String(company.name) : undefined,
  };
}

export async function listMembershipsForUser(
  userId: string,
): Promise<CompanyMembership[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_memberships")
    .select(
      "id, user_id, company_id, role, status, created_at, company:agenttender_companies(name)",
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => mapMembership(row as Record<string, unknown>));
}

export async function getMembership(
  userId: string,
  companyId: string,
): Promise<CompanyMembership | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_memberships")
    .select(
      "id, user_id, company_id, role, status, created_at, company:agenttender_companies(name)",
    )
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapMembership(data as Record<string, unknown>);
}

export async function ensureActiveMembership(
  userId: string,
  companyId: string | null | undefined,
): Promise<{ companyId: string; role: UserRole } | null> {
  if (companyId) {
    const membership = await getMembership(userId, companyId);
    if (membership && membership.status === "active") {
      return { companyId: membership.companyId, role: membership.role };
    }
  }

  const memberships = await listMembershipsForUser(userId);
  const first = memberships[0];
  if (!first) return null;

  if (first.companyId !== companyId) {
    await switchActiveCompany({ userId, companyId: first.companyId });
  }
  return { companyId: first.companyId, role: first.role };
}

export async function createMembership(options: {
  userId: string;
  companyId: string;
  role: UserRole;
  createdBy?: string | null;
}): Promise<CompanyMembership> {
  const existing = await getMembership(options.userId, options.companyId);
  if (existing) {
    if (existing.status === "active") {
      throw new Error("User is already a member of this company.");
    }
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("agenttender_company_memberships")
      .update({
        status: "active",
        role: options.role,
      })
      .eq("id", existing.id)
      .select(
        "id, user_id, company_id, role, status, created_at, company:agenttender_companies(name)",
      )
      .single();
    if (error) throw new Error(error.message);
    return mapMembership(data as Record<string, unknown>);
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_memberships")
    .insert({
      user_id: options.userId,
      company_id: options.companyId,
      role: options.role,
      status: "active",
      created_by: options.createdBy ?? null,
    })
    .select(
      "id, user_id, company_id, role, status, created_at, company:agenttender_companies(name)",
    )
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("User is already a member of this company.");
    }
    throw new Error(error.message);
  }
  return mapMembership(data as Record<string, unknown>);
}

export async function updateMembershipRole(options: {
  userId: string;
  companyId: string;
  role: UserRole;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_company_memberships")
    .update({ role: options.role })
    .eq("user_id", options.userId)
    .eq("company_id", options.companyId)
    .eq("status", "active");
  if (error) throw new Error(error.message);

  // Keep users.role in sync when this company is active.
  await supabase
    .from("agenttender_users")
    .update({ role: options.role })
    .eq("id", options.userId)
    .eq("company_id", options.companyId);
}

export async function removeMembership(options: {
  userId: string;
  companyId: string;
}): Promise<{ remainingCompanyId: string | null }> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_company_memberships")
    .delete()
    .eq("user_id", options.userId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);

  const remaining = await listMembershipsForUser(options.userId);
  if (remaining.length === 0) {
    await supabase
      .from("agenttender_users")
      .update({ company_id: null })
      .eq("id", options.userId);
    return { remainingCompanyId: null };
  }

  const { data: user } = await supabase
    .from("agenttender_users")
    .select("company_id")
    .eq("id", options.userId)
    .maybeSingle();

  if (user?.company_id === options.companyId) {
    await switchActiveCompany({
      userId: options.userId,
      companyId: remaining[0]!.companyId,
    });
    return { remainingCompanyId: remaining[0]!.companyId };
  }

  return { remainingCompanyId: (user?.company_id as string) || remaining[0]!.companyId };
}

export async function switchActiveCompany(options: {
  userId: string;
  companyId: string;
}): Promise<{ companyId: string; role: UserRole }> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase.rpc("agenttender_switch_active_company", {
    p_user_id: options.userId,
    p_company_id: options.companyId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.company_id) {
    throw new Error("Unable to switch company.");
  }
  return {
    companyId: String(row.company_id),
    role: row.role as UserRole,
  };
}

export async function createCompanyForExistingUser(options: {
  userId: string;
  name: string;
  industryType?: string | null;
  businessLocation?: string | null;
  website?: string | null;
  makeActive?: boolean;
}): Promise<{ companyId: string; membershipId: string }> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase.rpc("agenttender_create_company_for_user", {
    p_user_id: options.userId,
    p_name: options.name,
    p_industry_type: options.industryType ?? null,
    p_business_location: options.businessLocation ?? null,
    p_website: options.website ?? null,
    p_make_active: options.makeActive !== false,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.company_id || !row?.membership_id) {
    throw new Error("Company creation did not return ids.");
  }
  return {
    companyId: String(row.company_id),
    membershipId: String(row.membership_id),
  };
}

export async function listMemberUserIdsForCompany(
  companyId: string,
): Promise<Array<{ userId: string; role: UserRole }>> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_memberships")
    .select("user_id, role")
    .eq("company_id", companyId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    userId: String(row.user_id),
    role: row.role as UserRole,
  }));
}

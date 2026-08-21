"use server";

import { revalidatePath } from "next/cache";

import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { getServerSupabase } from "@/lib/db/server";

export type Tender247AccountListItem = {
  id: string;
  label: string;
  username: string;
  isActive: boolean;
  lastUsedAt: string | null;
  sortOrder: number;
};

export type AccountActionResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; error: string };

function encryptPassword(plain: string): string {
  // Mirror crawler crypto (same env keys). Implemented inline to avoid importing
  // Node crawler modules into the Next bundle.
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const raw =
    process.env.CREDENTIALS_ENCRYPTION_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "tenderflow-dev-only-change-me";
  const key = crypto.createHash("sha256").update(raw).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export async function listTender247AccountsAction(): Promise<
  Tender247AccountListItem[]
> {
  const session = await requirePermissionStrict("settings.view");
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_tender247_accounts")
    .select("id, label, username, is_active, last_used_at, sort_order")
    .eq("company_id", session.companyId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: String(row.id),
    label: String(row.label),
    username: String(row.username),
    isActive: Boolean(row.is_active),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    sortOrder: Number(row.sort_order) || 0,
  }));
}

export async function createTender247AccountAction(input: {
  label: string;
  username: string;
  password: string;
}): Promise<AccountActionResult> {
  try {
    const session = await requirePermissionStrict("integrations.manage");
    const label = input.label.trim();
    const username = input.username.trim();
    const password = input.password;
    if (!label) return { ok: false, error: "Label is required." };
    if (!username) return { ok: false, error: "Username is required." };
    if (!password) return { ok: false, error: "Password is required." };

    const supabase = getServerSupabase();
    const { data: existing } = await supabase
      .from("agenttender_company_tender247_accounts")
      .select("sort_order")
      .eq("company_id", session.companyId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextOrder = (Number(existing?.[0]?.sort_order) || 0) + 1;

    const { data, error } = await supabase
      .from("agenttender_company_tender247_accounts")
      .insert({
        company_id: session.companyId,
        portal: "TENDER247",
        label,
        username,
        encrypted_password: encryptPassword(password),
        is_active: true,
        sort_order: nextOrder,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    revalidatePath("/settings");
    return {
      ok: true,
      id: String(data.id),
      message: "Tender247 account added.",
    };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unable to create account.",
    };
  }
}

export async function updateTender247AccountAction(input: {
  id: string;
  label?: string;
  username?: string;
  password?: string;
  isActive?: boolean;
}): Promise<AccountActionResult> {
  try {
    const session = await requirePermissionStrict("integrations.manage");
    const patch: Record<string, unknown> = {};
    if (input.label !== undefined) patch.label = input.label.trim();
    if (input.username !== undefined) patch.username = input.username.trim();
    if (input.password) patch.encrypted_password = encryptPassword(input.password);
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const supabase = getServerSupabase();
    const { error } = await supabase
      .from("agenttender_company_tender247_accounts")
      .update(patch)
      .eq("company_id", session.companyId)
      .eq("id", input.id);
    if (error) throw new Error(error.message);

    revalidatePath("/settings");
    return { ok: true, message: "Account updated." };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unable to update account.",
    };
  }
}

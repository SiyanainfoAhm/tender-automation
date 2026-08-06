import type { SupabaseClient } from "@supabase/supabase-js";
import { initialAdminPasswordSchema } from "@/lib/validations";
import type { SafeAdminSeedResult } from "@/server/auth/safe-user";

export const initialAdmins = [
  { email: "mpatel@mitajacorp.com", fullName: "M Patel" },
  { email: "jaimin.shah@thinfo.in", fullName: "Jaimin Shah" },
  { email: "deven.patel@siyanainfo.com", fullName: "Deven Patel" },
  { email: "gourav.gupta@siyanainfo.com", fullName: "Gourav Gupta" },
] as const;

export type SeedInitialAdminsOptions = {
  password: string;
  forcePasswordReset?: boolean;
};

export async function hashPasswordWithDb(
  supabase: SupabaseClient,
  plain: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("agenttender_hash_password", {
    plain_password: plain,
  });
  if (error || typeof data !== "string") {
    throw new Error(error?.message || "Password hashing failed");
  }
  return data;
}

/** Idempotent upsert of the four initial ADMIN accounts. */
export async function seedInitialAdmins(
  supabase: SupabaseClient,
  options: SeedInitialAdminsOptions,
): Promise<SafeAdminSeedResult[]> {
  const parsed = initialAdminPasswordSchema.safeParse(options.password);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || "Invalid password");
  }

  const results: SafeAdminSeedResult[] = [];
  let passwordHash: string | null = null;

  async function ensureHash(): Promise<string> {
    if (!passwordHash) {
      passwordHash = await hashPasswordWithDb(supabase, options.password);
    }
    return passwordHash;
  }

  for (const admin of initialAdmins) {
    const email = admin.email.trim().toLowerCase();

    const { data: existing } = await supabase
      .from("agenttender_users")
      .select("id, email, full_name, role, must_change_password, password_hash")
      .ilike("email", email)
      .maybeSingle();

    const basePatch = {
      full_name: admin.fullName,
      role: "ADMIN" as const,
      is_active: true,
      must_change_password: true,
      failed_login_attempts: 0,
      locked_until: null,
    };

    let userId: string;
    let eventType: "USER_CREATED" | "PASSWORD_RESET";

    if (existing) {
      userId = existing.id;
      const updatePatch: Record<string, unknown> = { ...basePatch };
      if (options.forcePasswordReset) {
        updatePatch.password_hash = await ensureHash();
        updatePatch.password_changed_at = new Date().toISOString();
        eventType = "PASSWORD_RESET";
      } else {
        eventType = "USER_CREATED";
      }

      const { error } = await supabase
        .from("agenttender_users")
        .update(updatePatch)
        .eq("id", userId);
      if (error) throw new Error(error.message);

      if (options.forcePasswordReset) {
        await supabase.from("agenttender_auth_events").insert({
          user_id: userId,
          attempted_email: email,
          event_type: "PASSWORD_RESET",
          success: true,
          reason: "seed_force_reset",
          metadata: { source: "seed-initial-admins" },
        });
      }
    } else {
      const { data: created, error } = await supabase
        .from("agenttender_users")
        .insert({
          email,
          ...basePatch,
          password_hash: await ensureHash(),
          password_changed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      userId = created.id;
      eventType = "USER_CREATED";

      await supabase.from("agenttender_auth_events").insert({
        user_id: userId,
        attempted_email: email,
        event_type: eventType,
        success: true,
        reason: "seed_create",
        metadata: { source: "seed-initial-admins" },
      });
    }

    const { data: prefs } = await supabase
      .from("agenttender_user_preferences")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!prefs) {
      await supabase.from("agenttender_user_preferences").insert({
        user_id: userId,
      });
    }

    const { data: safe } = await supabase
      .from("agenttender_users")
      .select("id, email, full_name, role, must_change_password")
      .eq("id", userId)
      .single();

    if (!safe) throw new Error(`Failed to read seeded user ${email}`);

    results.push({
      id: safe.id,
      email: safe.email,
      full_name: safe.full_name,
      role: safe.role,
      must_change_password: safe.must_change_password,
    });
  }

  return results;
}

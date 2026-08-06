/**
 * Bootstrap the first ADMIN user.
 * Reads AGENTTENDER_BOOTSTRAP_ADMIN_* from env — never pass password on CLI.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const passwordSchema = z
  .string()
  .min(12)
  .regex(/[A-Z]/)
  .regex(/[a-z]/)
  .regex(/[0-9]/)
  .regex(/[^A-Za-z0-9]/);

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const email = process.env.AGENTTENDER_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const fullName = process.env.AGENTTENDER_BOOTSTRAP_ADMIN_NAME?.trim();
  const password = process.env.AGENTTENDER_BOOTSTRAP_ADMIN_PASSWORD;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  }
  if (!email || !fullName || !password) {
    throw new Error(
      "AGENTTENDER_BOOTSTRAP_ADMIN_EMAIL, AGENTTENDER_BOOTSTRAP_ADMIN_NAME, and AGENTTENDER_BOOTSTRAP_ADMIN_PASSWORD are required",
    );
  }

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    throw new Error(
      "Bootstrap password must be 12+ chars with upper, lower, number, and special character",
    );
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing } = await supabase
    .from("agenttender_users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (existing) {
    throw new Error(`Administrator already exists: ${email}`);
  }

  const { data: hash, error: hashError } = await supabase.rpc(
    "agenttender_hash_password",
    { plain_password: password },
  );
  if (hashError || typeof hash !== "string") {
    throw new Error(hashError?.message || "Password hashing failed");
  }

  const { data: user, error } = await supabase
    .from("agenttender_users")
    .insert({
      email,
      full_name: fullName,
      password_hash: hash,
      role: "ADMIN",
      must_change_password: true,
      password_changed_at: new Date().toISOString(),
    })
    .select("id, email")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await supabase.from("agenttender_user_preferences").insert({
    user_id: user.id,
  });

  console.log("ADMIN_CREATED");
  console.log(`email=${user.email}`);
  console.log("must_change_password=true");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

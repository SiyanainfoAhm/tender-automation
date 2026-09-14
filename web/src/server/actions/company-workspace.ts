"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import {
  createCompanyForExistingUser,
  listMembershipsForUser,
  switchActiveCompany,
} from "@/server/repositories/membershipRepository";
import { getServerSupabase } from "@/lib/db/server";
import { isOptionalPhoneValidAnyCountry } from "@/lib/validations/phone-rules";

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}
const createCompanySchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  industry: z.string().trim().max(120).optional().or(z.literal("")),
  companyType: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isOptionalPhoneValidAnyCountry(v), "Enter a valid phone number"),
  website: z.string().trim().max(300).optional().or(z.literal("")),
  location: z.string().trim().max(200).optional().or(z.literal("")),
});

export async function createCompanyAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string }> {
  const session = await requireSession();
  const parsed = createCompanySchema.safeParse({
    companyName: formData.get("companyName"),
    industry: formData.get("industry") || "",
    companyType: formData.get("companyType") || "",
    phone: formData.get("phone") || "",
    website: formData.get("website") || "",
    location: formData.get("location") || "",
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message || "Unable to create company",
    };
  }

  try {
    const result = await createCompanyForExistingUser({
      userId: session.user.id,
      name: parsed.data.companyName,
      industryType: parsed.data.industry || parsed.data.companyType || null,
      businessLocation: parsed.data.location || null,
      website: parsed.data.website || null,
      makeActive: true,
    });

    if (parsed.data.phone || parsed.data.companyType) {
      const supabase = getServerSupabase();
      const { data: prefs } = await supabase
        .from("agenttender_user_preferences")
        .select("preferences")
        .eq("user_id", session.user.id)
        .maybeSingle();
      const current =
        (prefs?.preferences as Record<string, unknown> | null) || {};
      await supabase.from("agenttender_user_preferences").upsert(
        {
          user_id: session.user.id,
          preferences: {
            ...current,
            companySignup: {
              phone: parsed.data.phone || "",
              companyType: parsed.data.companyType || "",
              companyId: result.companyId,
            },
          },
        },
        { onConflict: "user_id" },
      );
    }

    revalidatePath("/", "layout");
    revalidatePath("/company-profile");
    revalidatePath("/dashboard");
    redirect("/company-profile");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return {
      error:
        error instanceof Error ? error.message : "Unable to create company",
    };
  }
}

export async function switchCompanyAction(
  companyId: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireSession();
    if (!companyId) return { error: "Company is required." };

    await switchActiveCompany({
      userId: session.user.id,
      companyId,
    });

    revalidatePath("/", "layout");
    revalidatePath("/dashboard");
    revalidatePath("/tenders");
    revalidatePath("/won-tenders");
    revalidatePath("/bid-fees");
    revalidatePath("/documents");
    revalidatePath("/users");
    revalidatePath("/company-profile");
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to switch company",
    };
  }
}

export async function listMyCompaniesAction(): Promise<
  Array<{ id: string; name: string; role: string; active: boolean }>
> {
  const session = await requireSession();
  const memberships = await listMembershipsForUser(session.user.id);
  return memberships.map((m) => ({
    id: m.companyId,
    name: m.companyName || "Company",
    role: m.role,
    active: m.companyId === session.user.companyId,
  }));
}

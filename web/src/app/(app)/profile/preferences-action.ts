"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { preferencesSchema } from "@/lib/validations";
import { updateUserPreferences } from "@/server/repositories/savedViewRepository";

export async function saveProfilePreferencesAction(
  formData: FormData,
): Promise<void> {
  const session = await requireSession();
  const parsed = preferencesSchema.safeParse({
    theme: "light",
    tableDensity: formData.get("tableDensity") || undefined,
    sidebarCollapsed:
      formData.get("sidebarCollapsed") == null
        ? undefined
        : formData.get("sidebarCollapsed") === "true",
    defaultDateFilter: formData.get("defaultDateFilter") || null,
  });
  if (!parsed.success) return;
  await updateUserPreferences(session.user.id, parsed.data);
  revalidatePath("/profile");
  revalidatePath("/settings");
}

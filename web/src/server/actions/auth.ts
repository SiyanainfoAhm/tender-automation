"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  loginWithPassword,
  logoutCurrentSession,
  requireRole,
  requireSession,
  getSession,
} from "@/server/auth/session";
import {
  loginSchema,
  createUserSchema,
  changePasswordSchema,
  savedViewSchema,
  preferencesSchema,
  updateUserSchema,
  resetPasswordSchema,
  profileUpdateSchema,
  signupSchema,
} from "@/lib/validations";
import { sendTenderFlowUserInvite } from "@/lib/email/tenderflow-user-invite";
import {
  createUser,
  updateUser,
  unlockUser,
  resetUserPassword,
  changeOwnPassword,
  revokeAllSessions,
  revokeOtherSessions,
  updateOwnProfile,
  registerPublicUser,
} from "@/server/repositories/userRepository";
import {
  createSavedView,
  deleteSavedView,
  updateSavedView,
  updateUserPreferences,
} from "@/server/repositories/savedViewRepository";
import { revokeSession } from "@/server/repositories/sessionRepository";

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export async function loginAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; locked?: boolean }> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Unable to sign in with those credentials." };
  }

  try {
    const result = await loginWithPassword(
      parsed.data.email,
      parsed.data.password,
    );
    if (!result.ok) {
      return {
        error: result.message,
        locked: result.code === "LOCKED",
      };
    }
    if (result.mustChangePassword) {
      redirect("/change-password");
    }
    redirect("/dashboard");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { error: "Unable to sign in with those credentials." };
  }
}

export async function logoutAction(): Promise<void> {
  await logoutCurrentSession();
  redirect("/login");
}

export async function signupAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string }> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    companyName: formData.get("companyName"),
    industry: formData.get("industry") || "",
    companyType: formData.get("companyType") || "",
    phone: formData.get("phone") || "",
    website: formData.get("website") || "",
    location: formData.get("location") || "",
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message || "Unable to create account",
    };
  }

  try {
    await registerPublicUser({
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      password: parsed.data.password,
      company: {
        name: parsed.data.companyName,
        industry: parsed.data.industry || undefined,
        companyType: parsed.data.companyType || undefined,
        phone: parsed.data.phone || undefined,
        website: parsed.data.website || undefined,
        location: parsed.data.location || undefined,
      },
    });

    const result = await loginWithPassword(
      parsed.data.email,
      parsed.data.password,
    );
    if (!result.ok) {
      return {
        error:
          "Account created, but automatic sign-in failed. Please sign in manually.",
      };
    }
    redirect("/dashboard");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return {
      error:
        error instanceof Error ? error.message : "Unable to create account",
    };
  }
}

export async function createUserAction(formData: FormData): Promise<{
  error?: string;
  ok?: boolean;
  userCreated?: boolean;
  inviteSent?: boolean;
  warning?: string;
}> {
  const { requirePermissionStrict } = await import("@/server/auth/permissions");
  const session = await requirePermissionStrict("users.invite");
  const parsed = createUserSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Invalid input" };
  }
  try {
    const created = await createUser({
      ...parsed.data,
      createdBy: session.user.id,
      companyId: session.companyId,
    });
    const emailResult = await sendTenderFlowUserInvite({
      mode: "initial",
      name: created.fullName,
      email: created.email,
      temporaryPassword: parsed.data.password,
    });
    revalidatePath("/users");
    if (!emailResult.ok) {
      console.error("[TenderFlow invite] invitation email failed", {
        userId: created.id,
        email: created.email,
      });
      return {
        ok: true,
        userCreated: true,
        inviteSent: false,
        warning: "User created, but the invitation email could not be sent.",
      };
    }
    console.info("[TenderFlow invite] invitation sent", {
      userId: created.id,
      email: created.email,
    });
    return { ok: true, userCreated: true, inviteSent: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to create user",
    };
  }
}

export async function updateUserAction(
  userId: string,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const { requirePermissionStrict, hasPermission } = await import(
    "@/server/auth/permissions"
  );
  const session = await requirePermissionStrict("users.edit");
  const parsed = updateUserSchema.safeParse({
    fullName: formData.get("fullName") || undefined,
    email: formData.get("email") || undefined,
    role: formData.get("role") || undefined,
    isActive:
      formData.get("isActive") == null
        ? undefined
        : formData.get("isActive") === "true",
    mustChangePassword:
      formData.get("mustChangePassword") == null
        ? undefined
        : formData.get("mustChangePassword") === "true",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Invalid input" };
  }
  if (
    parsed.data.role &&
    !hasPermission(session.user.role, "users.manage_roles")
  ) {
    return { error: "You cannot change roles." };
  }
  try {
    const target = await import("@/server/repositories/userRepository").then(
      (m) => m.getUserById(userId),
    );
    if (!target || target.companyId !== session.companyId) {
      return { error: "User not found in your company." };
    }
    await updateUser(userId, parsed.data, session.user.id);
    revalidatePath("/users");
    revalidatePath(`/users/${userId}`);
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to update user",
    };
  }
}

export async function unlockUserAction(userId: string): Promise<void> {
  await requireRole("ADMIN");
  await unlockUser(userId);
  revalidatePath("/users");
}

export async function resetPasswordAction(formData: FormData): Promise<{
  error?: string;
  ok?: boolean;
}> {
  const session = await requireRole("ADMIN");
  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get("userId"),
    temporaryPassword: formData.get("temporaryPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Invalid input" };
  }
  try {
    await resetUserPassword({
      userId: parsed.data.userId,
      temporaryPassword: parsed.data.temporaryPassword,
      actorId: session.user.id,
    });
    revalidatePath("/users");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to reset password",
    };
  }
}

export async function revokeAllSessionsAction(userId: string): Promise<void> {
  await requireRole("ADMIN");
  await revokeAllSessions(userId);
  revalidatePath(`/users/${userId}`);
}

export async function changePasswordAction(formData: FormData): Promise<{
  error?: string;
  ok?: boolean;
}> {
  const session = await requireSession({ allowMustChangePassword: true });
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Invalid password" };
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return { error: "New password must differ from the current password" };
  }

  const result = await changeOwnPassword({
    userId: session.user.id,
    currentSessionId: session.sessionId,
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
  });
  if (!result.ok) return { error: result.message };

  revalidatePath("/profile");
  revalidatePath("/change-password");

  if (session.user.mustChangePassword) {
    redirect("/dashboard");
  }
  return { ok: true };
}

export async function updateProfileAction(formData: FormData): Promise<{
  error?: string;
  ok?: boolean;
}> {
  const session = await requireSession();
  const parsed = profileUpdateSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    currentPassword: formData.get("currentPassword") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Invalid profile data" };
  }

  const result = await updateOwnProfile({
    userId: session.user.id,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    currentPassword: parsed.data.currentPassword,
  });
  if (!result.ok) return { error: result.message };

  revalidatePath("/profile");
  return { ok: true };
}

export async function revokeOtherSessionsAction(): Promise<void> {
  const session = await requireSession();
  await revokeOtherSessions(session.user.id, session.sessionId);
  revalidatePath("/profile");
}

export async function saveViewAction(formData: FormData): Promise<{
  error?: string;
  ok?: boolean;
}> {
  const session = await requireSession();
  const rawFilters = String(formData.get("filters") || "{}");
  const rawSort = String(formData.get("sortConfig") || "{}");
  const rawCols = String(formData.get("visibleColumns") || "[]");
  let filters = {};
  let sortConfig = {};
  let visibleColumns: string[] = [];
  try {
    filters = JSON.parse(rawFilters);
    sortConfig = JSON.parse(rawSort);
    visibleColumns = JSON.parse(rawCols);
  } catch {
    return { error: "Invalid view payload" };
  }
  const parsed = savedViewSchema.safeParse({
    name: formData.get("name"),
    isDefault: formData.get("isDefault") === "true",
    filters,
    sortConfig,
    visibleColumns,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Invalid view" };
  }
  await createSavedView({
    userId: session.user.id,
    ...parsed.data,
  });
  revalidatePath("/saved-views");
  revalidatePath("/tenders");
  return { ok: true };
}

export async function deleteViewAction(viewId: string): Promise<void> {
  const session = await requireSession();
  await deleteSavedView(viewId, session.user.id);
  revalidatePath("/saved-views");
}

export async function setDefaultViewAction(viewId: string): Promise<void> {
  const session = await requireSession();
  await updateSavedView(viewId, session.user.id, { isDefault: true });
  revalidatePath("/saved-views");
}

export async function updatePreferencesAction(formData: FormData): Promise<{
  error?: string;
  ok?: boolean;
}> {
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
  if (!parsed.success) {
    return { error: "Invalid preferences" };
  }
  await updateUserPreferences(session.user.id, parsed.data);
  revalidatePath("/settings");
  revalidatePath("/profile");
  return { ok: true };
}

export async function revokeOwnSessionAction(sessionId: string): Promise<void> {
  const session = await requireSession();
  await revokeSession(sessionId, session.user.id);
  revalidatePath("/profile");
}

/** For change-password page gate */
export async function getChangePasswordSession() {
  return getSession();
}

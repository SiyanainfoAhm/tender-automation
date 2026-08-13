"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { USER_ROLES, passwordSchema, type UserRole } from "@/lib/validations";
import { hasPermission, requirePermissionStrict } from "@/server/auth/permissions";
import {
  acceptCompanyInvitation,
  cancelCompanyInvitation,
  createCompanyInvitation,
  syncPermissionCatalog,
} from "@/server/repositories/rbacRepository";
import {
  createUser,
  getUserByEmail,
  getUserById,
  updateUser,
} from "@/server/repositories/userRepository";

const inviteSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().max(120).optional().or(z.literal("")),
  role: z.enum(USER_ROLES),
  temporaryPassword: passwordSchema,
});

export async function inviteCompanyUserAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requirePermissionStrict("users.invite");
    const parsed = inviteSchema.safeParse({
      email: formData.get("email"),
      fullName: formData.get("fullName") || "",
      role: formData.get("role"),
      temporaryPassword: formData.get("temporaryPassword"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid invite" };
    }

    if (
      !hasPermission(session.user.role, "users.manage_roles") &&
      parsed.data.role === "ADMIN"
    ) {
      return { error: "You cannot invite users as Admin." };
    }

    const existing = await getUserByEmail(parsed.data.email);
    if (existing?.companyId === session.companyId) {
      return { error: "This user is already a member of your company." };
    }
    if (existing) {
      return {
        error:
          "An account with this email already exists in another workspace.",
      };
    }

    const { invite } = await createCompanyInvitation({
      companyId: session.companyId,
      email: parsed.data.email,
      fullName: parsed.data.fullName || null,
      role: parsed.data.role,
      invitedBy: session.user.id,
    });

    await createUser({
      email: parsed.data.email,
      fullName:
        parsed.data.fullName || parsed.data.email.split("@")[0] || "User",
      password: parsed.data.temporaryPassword,
      role: parsed.data.role,
      createdBy: session.user.id,
      companyId: session.companyId,
    });

    await acceptCompanyInvitation({
      companyId: session.companyId,
      invitationId: invite.id,
    });

    revalidatePath("/users");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to invite user",
    };
  }
}

export async function updateCompanyMemberAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requirePermissionStrict("users.edit");
    const userId = String(formData.get("userId") || "");
    if (!userId) return { error: "Missing user" };

    const target = await getUserById(userId);
    if (!target || target.companyId !== session.companyId) {
      return { error: "User not found in your company." };
    }

    const roleRaw = formData.get("role");
    const role = roleRaw ? (String(roleRaw) as UserRole) : undefined;
    if (role && !hasPermission(session.user.role, "users.manage_roles")) {
      return { error: "You cannot change roles." };
    }

    await updateUser(
      userId,
      {
        fullName: formData.get("fullName")
          ? String(formData.get("fullName"))
          : undefined,
        role,
        isActive:
          formData.get("isActive") == null
            ? undefined
            : formData.get("isActive") === "true",
      },
      session.user.id,
    );

    revalidatePath("/users");
    revalidatePath(`/users/${userId}`);
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to update member",
    };
  }
}

export async function deactivateCompanyMemberAction(
  userId: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requirePermissionStrict("users.deactivate");
    const target = await getUserById(userId);
    if (!target || target.companyId !== session.companyId) {
      return { error: "User not found in your company." };
    }

    await updateUser(userId, { isActive: false }, session.user.id);
    revalidatePath("/users");
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to remove member",
    };
  }
}

export async function cancelInviteAction(
  invitationId: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requirePermissionStrict("users.invite");
    await cancelCompanyInvitation({
      companyId: session.companyId,
      invitationId,
    });
    revalidatePath("/users");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to cancel invite",
    };
  }
}

export async function ensureRbacCatalogAction(): Promise<void> {
  await syncPermissionCatalog();
}

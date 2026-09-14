"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { generateCompanyTemporaryPassword } from "@/lib/auth/temporary-password";
import { sendTenderFlowUserInvite } from "@/lib/email/tenderflow-user-invite";
import type {
  InviteUserActionResult,
  ResendInviteActionResult,
} from "@/lib/users/invite-results";
import { USER_ROLES, type UserRole } from "@/lib/validations";
import { hasPermission, requirePermissionStrict } from "@/server/auth/permissions";
import { getCompanyById } from "@/server/repositories/companyRepository";
import {
  acceptCompanyInvitation,
  cancelCompanyInvitation,
  createCompanyInvitation,
  syncPermissionCatalog,
} from "@/server/repositories/rbacRepository";
import {
  createUser,
  deleteCompanyUser,
  getUserByEmail,
  getUserById,
  resetUserPassword,
  updateUser,
} from "@/server/repositories/userRepository";

const inviteSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().max(120).optional().or(z.literal("")),
  role: z.enum(USER_ROLES),
});

export async function inviteCompanyUserAction(
  _prev: unknown,
  formData: FormData,
): Promise<InviteUserActionResult> {
  try {
    const session = await requirePermissionStrict("users.invite");
    const parsed = inviteSchema.safeParse({
      email: formData.get("email"),
      fullName: formData.get("fullName") || "",
      role: formData.get("role"),
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
    if (existing) {
      const { getMembership, createMembership } = await import(
        "@/server/repositories/membershipRepository"
      );
      const membership = await getMembership(existing.id, session.companyId);
      if (membership?.status === "active") {
        return { error: "User is already a member of this company." };
      }

      await createMembership({
        userId: existing.id,
        companyId: session.companyId,
        role: parsed.data.role,
        createdBy: session.user.id,
      });

      try {
        await createCompanyInvitation({
          companyId: session.companyId,
          email: parsed.data.email,
          fullName: parsed.data.fullName || existing.fullName,
          role: parsed.data.role,
          invitedBy: session.user.id,
        });
      } catch {
        /* optional audit invite row — membership is the access grant */
      }

      const company = await getCompanyById(session.companyId);
      const emailResult = await sendTenderFlowUserInvite({
        mode: "initial",
        name: existing.fullName,
        email: existing.email,
        temporaryPassword: "(use your existing password)",
      });

      revalidatePath("/users");

      if (!emailResult.ok) {
        return {
          ok: true,
          userCreated: false,
          inviteSent: false,
          warning:
            "Added to this company. Notification email could not be sent — ask them to sign in with their existing password.",
        };
      }

      console.info("[TenderFlow invite] existing user added to company", {
        userId: existing.id,
        companyId: session.companyId,
        companyName: company?.name,
      });

      return {
        ok: true,
        userCreated: false,
        inviteSent: true,
        warning:
          "Existing account linked to this company. They can sign in with their current password.",
      };
    }

    const company = await getCompanyById(session.companyId);
    const invitationDate = new Date();
    const temporaryPassword = generateCompanyTemporaryPassword(
      company?.name || "User",
      invitationDate,
    );

    const { invite } = await createCompanyInvitation({
      companyId: session.companyId,
      email: parsed.data.email,
      fullName: parsed.data.fullName || null,
      role: parsed.data.role,
      invitedBy: session.user.id,
    });

    const created = await createUser({
      email: parsed.data.email,
      fullName:
        parsed.data.fullName || parsed.data.email.split("@")[0] || "User",
      password: temporaryPassword,
      role: parsed.data.role,
      createdBy: session.user.id,
      companyId: session.companyId,
    });

    await acceptCompanyInvitation({
      companyId: session.companyId,
      invitationId: invite.id,
    });

    const emailResult = await sendTenderFlowUserInvite({
      mode: "initial",
      name: created.fullName,
      email: created.email,
      temporaryPassword,
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
      error: error instanceof Error ? error.message : "Unable to invite user",
    };
  }
}

export async function resendTenderFlowInviteAction(
  userId: string,
): Promise<ResendInviteActionResult> {
  try {
    const session = await requirePermissionStrict("users.invite");
    if (!userId) {
      return { error: "User not found." };
    }

    const user = await getUserById(userId);
    const { getMembership } = await import(
      "@/server/repositories/membershipRepository"
    );
    const membership = user
      ? await getMembership(userId, session.companyId)
      : null;
    if (!user || !membership || membership.status !== "active") {
      return { error: "User not found." };
    }
    if (!user.email) {
      return { error: "This user does not have an email address." };
    }

    const company = user.companyId
      ? await getCompanyById(user.companyId)
      : null;
    const temporaryPassword = generateCompanyTemporaryPassword(
      company?.name || "User",
      new Date(),
    );
    await resetUserPassword({
      userId: user.id,
      temporaryPassword,
      actorId: session.user.id,
    });

    const emailResult = await sendTenderFlowUserInvite({
      mode: "resend",
      name: user.fullName || user.email,
      email: user.email,
      temporaryPassword,
    });

    if (!emailResult.ok) {
      console.error("[TenderFlow invite] resend email failed", {
        userId: user.id,
        email: user.email,
      });
      return {
        error:
          "A new temporary password was generated, but the invitation email could not be sent. Please retry Resend Invite.",
        passwordReset: true,
        inviteSent: false,
      };
    }

    console.info("[TenderFlow invite] invitation sent", {
      userId: user.id,
      email: user.email,
    });
    return { ok: true, inviteSent: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to resend invitation",
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
    const { getMembership, updateMembershipRole } = await import(
      "@/server/repositories/membershipRepository"
    );
    const membership = target
      ? await getMembership(userId, session.companyId)
      : null;
    if (!target || !membership || membership.status !== "active") {
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
        // Role is scoped to this company membership, not a global overwrite
        // of other companies — handled below via updateMembershipRole.
        isActive:
          formData.get("isActive") == null
            ? undefined
            : formData.get("isActive") === "true",
      },
      session.user.id,
    );

    if (role) {
      await updateMembershipRole({
        userId,
        companyId: session.companyId,
        role,
      });
    }

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
  return deleteCompanyMemberAction(userId);
}

export async function deleteCompanyMemberAction(
  userId: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requirePermissionStrict("users.deactivate");
    await deleteCompanyUser({
      userId,
      actorId: session.user.id,
      companyId: session.companyId,
    });
    revalidatePath("/users");
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to delete member",
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

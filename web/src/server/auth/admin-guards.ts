import type { UserRole } from "@/lib/validations";

export type AdminGuardUser = {
  id: string;
  role: UserRole;
  isActive: boolean;
};

/** Prevent removing or demoting the last active administrator. */
export function assertAdminMutationAllowed(options: {
  actorId: string;
  target: AdminGuardUser;
  patch: {
    role?: UserRole;
    isActive?: boolean;
  };
  activeAdminCount: number;
}): { ok: true } | { ok: false; message: string } {
  const { actorId, target, patch, activeAdminCount } = options;

  if (patch.isActive === false && target.id === actorId) {
    return { ok: false, message: "You cannot disable your own account." };
  }

  const demotingAdmin =
    target.role === "ADMIN" &&
    patch.role != null &&
    patch.role !== "ADMIN";

  const disablingAdmin =
    target.role === "ADMIN" && patch.isActive === false;

  if ((demotingAdmin || disablingAdmin) && activeAdminCount <= 1) {
    return {
      ok: false,
      message: "Your company must have at least one active administrator.",
    };
  }

  return { ok: true };
}

export function countActiveAdmins(users: AdminGuardUser[]): number {
  return users.filter((u) => u.role === "ADMIN" && u.isActive).length;
}

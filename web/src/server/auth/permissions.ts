import "server-only";

import { redirect } from "next/navigation";
import {
  roleHasPermission,
  type PermissionKey,
} from "@/lib/rbac/permissions";
import type { UserRole } from "@/lib/validations";
import {
  CompanyAccessError,
  requireCompanySession,
} from "@/server/auth/company-access";
import type { AuthSession } from "@/server/auth/session";

export function hasPermission(
  role: UserRole,
  permission: PermissionKey,
): boolean {
  return roleHasPermission(role, permission);
}

export function sessionHasPermission(
  session: AuthSession,
  permission: PermissionKey,
): boolean {
  return hasPermission(session.user.role, permission);
}

/** Page/route gate — redirects when permission is missing. */
export async function requirePermission(
  permission: PermissionKey,
): Promise<AuthSession & { companyId: string }> {
  const session = await requireCompanySession();
  if (!sessionHasPermission(session, permission)) {
    redirect("/dashboard");
  }
  return session;
}

/** Action/API gate — throws CompanyAccessError when permission is missing. */
export async function requirePermissionStrict(
  permission: PermissionKey,
): Promise<AuthSession & { companyId: string }> {
  const session = await requireCompanySession();
  if (!sessionHasPermission(session, permission)) {
    throw new CompanyAccessError(
      "FORBIDDEN",
      `Missing permission: ${permission}`,
    );
  }
  return session;
}

export function assertPermission(
  role: UserRole,
  permission: PermissionKey,
  message?: string,
): void {
  if (!hasPermission(role, permission)) {
    throw new CompanyAccessError(
      "FORBIDDEN",
      message || `Missing permission: ${permission}`,
    );
  }
}

import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { UserManagementClient } from "@/components/users/user-management-client";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { listCompanyInvitations } from "@/server/repositories/rbacRepository";
import { listUsers } from "@/server/repositories/userRepository";

type UsersPageProps = {
  searchParams?: Promise<{ tab?: string }>;
};

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const session = await requirePermission("users.view");
  const params = (await searchParams) || {};
  const initialTab =
    params.tab === "permissions" ? "permissions" : "members";

  // Matrix/auth use in-code ROLE_PERMISSIONS. Do not call syncPermissionCatalog
  // on every page load — it rewrites role_permissions and stalls the RSC stream.

  const [members, pendingInvites] = await Promise.all([
    listUsers({ companyId: session.companyId }),
    listCompanyInvitations({
      companyId: session.companyId,
      status: "pending",
    }),
  ]);

  const livePending = pendingInvites
    .filter((inv) => new Date(inv.expiresAt).getTime() > Date.now())
    .map((inv) => ({
      id: inv.id,
      email: inv.email,
      fullName: inv.fullName,
      role: inv.role,
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
    }));

  const memberDtos = members.map((m) => ({
    id: m.id,
    fullName: m.fullName,
    email: m.email,
    role: m.role,
    isActive: m.isActive,
    lastLoginAt: m.lastLoginAt,
    createdAt: m.createdAt,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        subtitle="Manage team access, assign roles, and review permission levels"
      />

      <Suspense
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-9 w-64" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
            <Skeleton className="h-64" />
          </div>
        }
      >
        <UserManagementClient
          members={memberDtos}
          pendingInvites={livePending}
          canInvite={hasPermission(session.user.role, "users.invite")}
          canEdit={hasPermission(session.user.role, "users.edit")}
          canDeactivate={hasPermission(session.user.role, "users.deactivate")}
          canManageRoles={hasPermission(
            session.user.role,
            "users.manage_roles",
          )}
          initialTab={initialTab}
        />
      </Suspense>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  DISPLAY_ROLES,
  PERMISSION_CATALOG,
  ROLE_META,
  permissionCountForRole,
  permissionsByCategory,
  roleHasPermission,
  type PermissionCategory,
  type PermissionDef,
} from "@/lib/rbac/permissions";
import type { UserRole } from "@/lib/validations";
import { cn } from "@/lib/utils";
import { RoleBadge } from "./role-badge";

function PermissionIndicator({ allowed }: { allowed: boolean }) {
  if (allowed) {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <Check className="size-3.5 stroke-[2.5]" />
      </span>
    );
  }
  return (
    <span className="inline-flex size-6 items-center justify-center rounded-full bg-slate-100 text-slate-400">
      <X className="size-3 stroke-[2.5]" />
    </span>
  );
}

function PermissionRoleCards() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {ROLE_META.map((role) => (
        <Card key={role.key} className="rounded-lg shadow-none">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <RoleBadge role={role.key} />
              <span className="text-xs font-medium text-text-muted">
                {permissionCountForRole(role.key)} permissions
              </span>
            </div>
            <p className="text-xs leading-relaxed text-text-secondary">
              {role.description}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CategorySection({
  category,
  permissions,
  defaultOpen = true,
}: {
  category: PermissionCategory;
  permissions: PermissionDef[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-text-primary hover:bg-surface-muted/50"
      >
        <ChevronDown
          className={cn(
            "size-4 text-text-muted transition-transform",
            !open && "-rotate-90",
          )}
        />
        {category}
        <span className="font-normal text-text-muted">
          ({permissions.length} permission
          {permissions.length === 1 ? "" : "s"})
        </span>
      </button>
      {open ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-y border-border bg-surface-muted/40">
                <th className="sticky left-0 z-10 bg-surface-muted/95 px-3 py-2 text-left text-xs font-semibold text-text-muted backdrop-blur">
                  Permission
                </th>
                {DISPLAY_ROLES.map((role) => (
                  <th
                    key={role}
                    className="px-2 py-2 text-center text-xs font-semibold text-text-muted"
                  >
                    {ROLE_META.find((m) => m.key === role)?.name || role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((perm) => (
                <tr
                  key={perm.key}
                  className="border-b border-border last:border-0"
                >
                  <td className="sticky left-0 z-10 bg-white px-3 py-2.5 text-text-primary backdrop-blur">
                    <div className="font-medium">{perm.name}</div>
                    {perm.description ? (
                      <div className="text-xs text-text-muted">
                        {perm.description}
                      </div>
                    ) : null}
                  </td>
                  {DISPLAY_ROLES.map((role: UserRole) => (
                    <td key={role} className="px-2 py-2.5 text-center">
                      <div className="flex justify-center">
                        <PermissionIndicator
                          allowed={roleHasPermission(role, perm.key)}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function PermissionsMatrix() {
  const byCategory = useMemo(() => permissionsByCategory(), []);
  const categories = useMemo(() => {
    const order: PermissionCategory[] = [
      "Tenders",
      "AI Analysis",
      "Bids",
      "Documents",
      "Reports",
      "Users",
      "Company",
      "Settings",
    ];
    return order.filter((c) => (byCategory[c]?.length ?? 0) > 0);
  }, [byCategory]);

  return (
    <div className="space-y-6">
      <PermissionRoleCards />

      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <div className="border-b border-border px-3 py-2.5">
          <h3 className="text-sm font-semibold text-text-primary">
            Permission matrix
          </h3>
          <p className="text-xs text-text-muted">
            Read-only view of role permissions used by server authorization.
          </p>
        </div>
        {categories.map((category) => (
          <CategorySection
            key={category}
            category={category}
            permissions={byCategory[category] || []}
          />
        ))}
        <div className="flex items-center gap-4 border-t border-border px-3 py-2.5 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Check className="size-3" />
            </span>
            Allowed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <X className="size-3" />
            </span>
            Denied
          </span>
          <span className="ml-auto">
            {PERMISSION_CATALOG.length} permissions across{" "}
            {DISPLAY_ROLES.length} roles
          </span>
        </div>
      </div>
    </div>
  );
}

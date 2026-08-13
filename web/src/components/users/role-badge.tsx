"use client";

import { ROLE_META, type RoleMeta } from "@/lib/rbac/permissions";
import type { UserRole } from "@/lib/validations";
import { cn } from "@/lib/utils";

const ROLE_STYLES: Record<UserRole, string> = {
  ADMIN: "bg-emerald-50 text-emerald-800 border-emerald-200",
  BID_MANAGER: "bg-sky-50 text-sky-800 border-sky-200",
  TECHNICAL_LEAD: "bg-violet-50 text-violet-800 border-violet-200",
  FINANCIAL_ANALYST: "bg-amber-50 text-amber-900 border-amber-200",
  BID_COORDINATOR: "bg-slate-50 text-slate-700 border-slate-200",
  DOCUMENT_SPECIALIST: "bg-teal-50 text-teal-800 border-teal-200",
};

export function roleDisplayName(role: UserRole): string {
  return ROLE_META.find((r: RoleMeta) => r.key === role)?.name || role;
}

export function RoleBadge({
  role,
  className,
}: {
  role: UserRole;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        ROLE_STYLES[role] || ROLE_STYLES.BID_COORDINATOR,
        className,
      )}
    >
      {roleDisplayName(role)}
    </span>
  );
}

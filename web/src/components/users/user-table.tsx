import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatRelativeTime } from "@/lib/format";
import type { SafeUser } from "@/server/repositories/userRepository";

import { RoleBadge } from "./role-badge";
import { UserActionsMenu } from "./user-actions-menu";
import { UserStatusBadge } from "./user-status-badge";

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

type UserTableProps = {
  users: SafeUser[];
};

/** Legacy table — prefer TeamMemberTable on /users. */
export function UserTable({ users }: UserTableProps) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border bg-white md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/60">
                {[
                  "User",
                  "Role",
                  "Status",
                  "Password status",
                  "Last login",
                  "Created",
                  "",
                ].map((header) => (
                  <th
                    key={header || "actions"}
                    className="px-3 py-2.5 text-left text-xs font-semibold text-text-muted"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border last:border-0 hover:bg-surface-muted/40"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-emerald-50 text-xs font-semibold text-emerald-700">
                          {getInitials(user.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <Link
                          href={`/users/${user.id}`}
                          className="block truncate font-medium text-text-primary hover:text-primary"
                        >
                          {user.fullName}
                        </Link>
                        <p className="truncate text-xs text-text-muted">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-3 py-2.5">
                    <UserStatusBadge
                      status={user.isActive ? "active" : "inactive"}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-text-secondary">
                    {user.mustChangePassword ? "Change required" : "Up to date"}
                  </td>
                  <td className="px-3 py-2.5 text-text-muted">
                    {user.lastLoginAt
                      ? formatRelativeTime(user.lastLoginAt)
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-text-muted">
                    {formatRelativeTime(user.createdAt)}
                  </td>
                  <td className="px-3 py-2.5">
                    <UserActionsMenu userId={user.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {users.map((user) => (
          <div
            key={user.id}
            className="rounded-lg border border-border bg-white p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-emerald-50 text-sm font-semibold text-emerald-700">
                    {getInitials(user.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <Link
                    href={`/users/${user.id}`}
                    className="block truncate font-medium text-text-primary"
                  >
                    {user.fullName}
                  </Link>
                  <p className="truncate text-xs text-text-muted">{user.email}</p>
                </div>
              </div>
              <UserActionsMenu userId={user.id} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <RoleBadge role={user.role} />
              <UserStatusBadge
                status={user.isActive ? "active" : "inactive"}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

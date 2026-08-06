import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";
import type { SafeUser } from "@/server/repositories/userRepository";

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

export function UserTable({ users }: UserTableProps) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-[14px] border border-border bg-surface shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface-secondary">
              <tr className="border-b border-border">
                {[
                  "User",
                  "Role",
                  "Account status",
                  "Password status",
                  "Last login",
                  "Created",
                  "",
                ].map((header) => (
                  <th
                    key={header || "actions"}
                    className="px-4 py-3.5 text-left text-xs font-semibold text-text-secondary"
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
                  className="border-b border-border last:border-0 hover:bg-surface-secondary/60"
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-primary-muted text-xs font-semibold text-primary">
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
                  <td className="px-4 py-3.5">
                    <Badge variant="outline">{user.role.replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="px-4 py-3.5">
                    <UserStatusBadge user={user} />
                  </td>
                  <td className="px-4 py-3.5 text-text-secondary">
                    {user.mustChangePassword ? "Change required" : "Up to date"}
                  </td>
                  <td className="px-4 py-3.5 text-text-muted">
                    {user.lastLoginAt
                      ? formatRelativeTime(user.lastLoginAt)
                      : "Never"}
                  </td>
                  <td className="px-4 py-3.5 text-text-muted">
                    {formatRelativeTime(user.createdAt)}
                  </td>
                  <td className="px-4 py-3.5">
                    <UserActionsMenu userId={user.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {users.map((user) => (
          <div
            key={user.id}
            className="rounded-[14px] border border-border bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-primary-muted text-sm font-semibold text-primary">
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
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline">{user.role.replace(/_/g, " ")}</Badge>
              <UserStatusBadge user={user} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

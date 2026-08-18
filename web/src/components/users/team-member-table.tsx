"use client";

import { formatDate, formatRelativeTime } from "@/lib/format";
import type { UserRole } from "@/lib/validations";
import { EditUserDialog } from "./edit-user-dialog";
import { MemberAvatar } from "./member-avatar";
import { RemoveUserDialog } from "./remove-user-dialog";
import { ResendInviteDialog } from "./resend-invite-dialog";
import { RoleBadge } from "./role-badge";
import { UserStatusBadge, type MemberStatus } from "./user-status-badge";
import { ViewUserDialog } from "./view-user-dialog";

export type TeamMemberRow = {
  kind: "member" | "invite";
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  status: MemberStatus;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type TeamMemberTableProps = {
  rows: TeamMemberRow[];
  canEdit: boolean;
  canInvite: boolean;
  canDeactivate: boolean;
  canManageRoles: boolean;
  emptyMessage?: string;
};

export function TeamMemberTable({
  rows,
  canEdit,
  canInvite,
  canDeactivate,
  canManageRoles,
  emptyMessage = "No team members match your filters.",
}: TeamMemberTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-white px-4 py-10 text-center text-sm text-text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border bg-white md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/60">
                {[
                  "Member",
                  "Role",
                  "Status",
                  "Bids",
                  "Last Active",
                  "Joined",
                  "Actions",
                ].map((header) => (
                  <th
                    key={header}
                    className="px-3 py-2.5 text-left text-xs font-semibold text-text-muted"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.kind}-${row.id}`}
                  className="border-b border-border last:border-0 hover:bg-surface-muted/40"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <MemberAvatar name={row.fullName} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-primary">
                          {row.fullName}
                        </p>
                        <p className="truncate text-xs text-text-muted">
                          {row.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <RoleBadge role={row.role} />
                  </td>
                  <td className="px-3 py-2.5">
                    <UserStatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2.5 text-text-muted">—</td>
                  <td className="px-3 py-2.5 text-text-muted">
                    {row.kind === "invite"
                      ? "—"
                      : row.lastLoginAt
                        ? formatRelativeTime(row.lastLoginAt)
                        : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-text-muted">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.kind === "member" ? (
                      <div className="flex items-center gap-0.5">
                        <ViewUserDialog user={row} />
                        {canEdit ? (
                          <EditUserDialog
                            user={row}
                            canManageRoles={canManageRoles}
                          />
                        ) : null}
                        {canInvite ? (
                          <ResendInviteDialog
                            userId={row.id}
                            fullName={row.fullName}
                          />
                        ) : null}
                        {canDeactivate ? (
                          <RemoveUserDialog
                            userId={row.id}
                            fullName={row.fullName}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-text-muted">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <div
            key={`m-${row.kind}-${row.id}`}
            className="rounded-lg border border-border bg-white p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <MemberAvatar name={row.fullName} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">
                    {row.fullName}
                  </p>
                  <p className="truncate text-xs text-text-muted">{row.email}</p>
                </div>
              </div>
              {row.kind === "member" ? (
                <div className="flex shrink-0">
                  <ViewUserDialog user={row} />
                  {canEdit ? (
                    <EditUserDialog
                      user={row}
                      canManageRoles={canManageRoles}
                    />
                  ) : null}
                  {canInvite ? (
                    <ResendInviteDialog
                      userId={row.id}
                      fullName={row.fullName}
                    />
                  ) : null}
                  {canDeactivate ? (
                    <RemoveUserDialog
                      userId={row.id}
                      fullName={row.fullName}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RoleBadge role={row.role} />
              <UserStatusBadge status={row.status} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

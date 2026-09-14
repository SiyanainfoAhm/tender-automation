"use client";

import { useMemo, useState } from "react";

import type { UserRole } from "@/lib/validations";
import {
  TeamMemberFilters,
  type TeamFilters,
} from "./team-member-filters";
import { TeamMemberStats } from "./team-member-stats";
import {
  TeamMemberTable,
  type TeamMemberRow,
} from "./team-member-table";

export type TeamMemberDto = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type PendingInviteDto = {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
};

type UserManagementClientProps = {
  members: TeamMemberDto[];
  pendingInvites: PendingInviteDto[];
  canInvite: boolean;
  canEdit: boolean;
  canDeactivate: boolean;
  canManageRoles: boolean;
};

function toRows(
  members: TeamMemberDto[],
  pendingInvites: PendingInviteDto[],
): TeamMemberRow[] {
  const memberRows: TeamMemberRow[] = members.map((u) => ({
    kind: "member",
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    status: u.isActive ? "active" : "inactive",
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  }));

  const memberEmails = new Set(members.map((m) => m.email.toLowerCase()));
  const inviteRows: TeamMemberRow[] = pendingInvites
    .filter((inv) => !memberEmails.has(inv.email.toLowerCase()))
    .map((inv) => ({
      kind: "invite",
      id: inv.id,
      fullName: inv.fullName || inv.email.split("@")[0] || "Invited user",
      email: inv.email,
      role: inv.role,
      status: "pending",
      isActive: false,
      lastLoginAt: null,
      createdAt: inv.createdAt,
    }));

  return [...memberRows, ...inviteRows];
}

export function UserManagementClient({
  members,
  pendingInvites,
  canInvite,
  canEdit,
  canDeactivate,
  canManageRoles,
}: UserManagementClientProps) {
  const [filters, setFilters] = useState<TeamFilters>({
    search: "",
    status: "all",
    role: "all",
  });

  const stats = useMemo(() => {
    const active = members.filter((m) => m.isActive).length;
    const inactive = members.filter((m) => !m.isActive).length;
    return {
      active,
      inactive,
      pending: pendingInvites.length,
    };
  }, [members, pendingInvites]);

  const filteredRows = useMemo(() => {
    const rows = toRows(members, pendingInvites);
    const q = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.status !== "all" && row.status !== filters.status) {
        return false;
      }
      if (filters.role !== "all" && row.role !== filters.role) return false;
      if (!q) return true;
      return (
        row.fullName.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q)
      );
    });
  }, [members, pendingInvites, filters]);

  return (
    <div className="space-y-4">
      <TeamMemberStats
        active={stats.active}
        pending={stats.pending}
        inactive={stats.inactive}
        selected={filters.status}
        onSelect={(status) =>
          setFilters((prev) => ({ ...prev, status }))
        }
      />
      <TeamMemberFilters
        filters={filters}
        onChange={setFilters}
        canInvite={canInvite}
      />
      <TeamMemberTable
        rows={filteredRows}
        canEdit={canEdit}
        canInvite={canInvite}
        canDeactivate={canDeactivate}
        canManageRoles={canManageRoles}
        emptyMessage={
          members.length === 0 && pendingInvites.length === 0
            ? "No team members in this company yet. Invite someone to get started."
            : "No team members match your filters."
        }
      />
    </div>
  );
}

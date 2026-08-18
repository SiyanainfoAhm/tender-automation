"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UserRole } from "@/lib/validations";
import { PermissionsMatrix } from "./permissions-matrix";
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
  initialTab: "members" | "permissions";
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
  initialTab,
}: UserManagementClientProps) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"members" | "permissions">(initialTab);
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

  function onTabChange(value: string) {
    const next = value === "permissions" ? "permissions" : "members";
    setTab(next);
    // Update URL without Next navigation — avoids aborting a slow RSC stream.
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    window.history.replaceState(null, "", `/users?${params.toString()}`);
  }

  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList className="h-9 rounded-md bg-[#efece6] p-0.5">
        <TabsTrigger
          value="members"
          className="h-8 rounded-[5px] px-3 text-xs data-[state=active]:shadow-sm"
        >
          Team Members
        </TabsTrigger>
        <TabsTrigger
          value="permissions"
          className="h-8 rounded-[5px] px-3 text-xs data-[state=active]:shadow-sm"
        >
          Permissions Matrix
        </TabsTrigger>
      </TabsList>

      <TabsContent value="members" className="mt-6 space-y-4">
        <TeamMemberStats
          active={stats.active}
          pending={stats.pending}
          inactive={stats.inactive}
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
      </TabsContent>

      <TabsContent value="permissions" className="mt-6">
        <PermissionsMatrix />
      </TabsContent>
    </Tabs>
  );
}

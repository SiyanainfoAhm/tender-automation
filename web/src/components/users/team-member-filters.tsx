"use client";

import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_META } from "@/lib/rbac/permissions";
import { USER_ROLES } from "@/lib/validations";
import { InviteUserDialog } from "./invite-user-dialog";

export type TeamFilters = {
  search: string;
  status: "all" | "active" | "pending" | "inactive";
  role: "all" | (typeof USER_ROLES)[number];
};

type TeamMemberFiltersProps = {
  filters: TeamFilters;
  onChange: (next: TeamFilters) => void;
  canInvite: boolean;
};

export function TeamMemberFilters({
  filters,
  onChange,
  canInvite,
}: TeamMemberFiltersProps) {
  const hasActive =
    filters.search.trim() !== "" ||
    filters.status !== "all" ||
    filters.role !== "all";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <Input
            value={filters.search}
            onChange={(e) =>
              onChange({ ...filters, search: e.target.value })
            }
            placeholder="Search by name or email..."
            className="h-8 rounded-md pl-8 text-sm"
          />
        </div>
        <Select
          value={filters.status}
          onValueChange={(v) =>
            onChange({
              ...filters,
              status: v as TeamFilters["status"],
            })
          }
        >
          <SelectTrigger className="h-8 w-full rounded-md sm:w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.role}
          onValueChange={(v) =>
            onChange({
              ...filters,
              role: v as TeamFilters["role"],
            })
          }
        >
          <SelectTrigger className="h-8 w-full rounded-md sm:w-[160px]">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {USER_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_META.find((m) => m.key === r)?.name || r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActive ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-text-muted"
            onClick={() =>
              onChange({ search: "", status: "all", role: "all" })
            }
          >
            <X className="size-3.5" />
            Reset
          </Button>
        ) : null}
      </div>
      {canInvite ? <InviteUserDialog /> : null}
    </div>
  );
}

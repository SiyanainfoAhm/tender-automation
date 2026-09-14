"use client";

import { Users, UserPlus, UserX } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type TeamStatusFilter = "all" | "active" | "pending" | "inactive";

type TeamMemberStatsProps = {
  active: number;
  pending: number;
  inactive: number;
  selected?: TeamStatusFilter;
  onSelect?: (status: TeamStatusFilter) => void;
};

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  selected,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <Card
      className={cn(
        "h-full rounded-lg shadow-none",
        interactive && "cursor-pointer transition-colors hover:bg-surface-secondary",
        selected && "ring-2 ring-primary-500",
      )}
    >
      <CardContent
        className="flex h-full items-center gap-3 p-4 pt-4 sm:p-5 sm:pt-5"
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        onKeyDown={
          interactive
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onClick?.();
                }
              }
            : undefined
        }
      >
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-md ${accent}`}
        >
          <Icon className="size-4" />
        </div>

        <div>
          <p className="text-xs font-medium text-text-muted">{label}</p>
          <p className="text-xl font-semibold tracking-tight text-text-primary">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function TeamMemberStats({
  active,
  pending,
  inactive,
  selected = "all",
  onSelect,
}: TeamMemberStatsProps) {
  function toggle(status: Exclude<TeamStatusFilter, "all">) {
    if (!onSelect) return;
    onSelect(selected === status ? "all" : status);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard
        label="Active Members"
        value={active}
        icon={Users}
        accent="bg-emerald-50 text-emerald-700"
        selected={selected === "active"}
        onClick={onSelect ? () => toggle("active") : undefined}
      />
      <StatCard
        label="Pending Invites"
        value={pending}
        icon={UserPlus}
        accent="bg-amber-50 text-amber-700"
        selected={selected === "pending"}
        onClick={onSelect ? () => toggle("pending") : undefined}
      />
      <StatCard
        label="Inactive"
        value={inactive}
        icon={UserX}
        accent="bg-slate-100 text-slate-600"
        selected={selected === "inactive"}
        onClick={onSelect ? () => toggle("inactive") : undefined}
      />
    </div>
  );
}

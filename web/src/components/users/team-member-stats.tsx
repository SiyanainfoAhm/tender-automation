"use client";

import { Users, UserPlus, UserX } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

type TeamMemberStatsProps = {
  active: number;
  pending: number;
  inactive: number;
};

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <Card className="h-full rounded-lg shadow-none">
      <CardContent className="flex h-full items-center gap-3 p-4 pt-4 sm:p-5 sm:pt-5">
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
}: TeamMemberStatsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard
        label="Active Members"
        value={active}
        icon={Users}
        accent="bg-emerald-50 text-emerald-700"
      />
      <StatCard
        label="Pending Invites"
        value={pending}
        icon={UserPlus}
        accent="bg-amber-50 text-amber-700"
      />
      <StatCard
        label="Inactive"
        value={inactive}
        icon={UserX}
        accent="bg-slate-100 text-slate-600"
      />
    </div>
  );
}

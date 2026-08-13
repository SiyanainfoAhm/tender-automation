"use client";

import { cn } from "@/lib/utils";

export type MemberStatus = "active" | "pending" | "inactive";

const STATUS_META: Record<
  MemberStatus,
  { label: string; dot: string; text: string }
> = {
  active: {
    label: "Active",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
  },
  pending: {
    label: "Pending",
    dot: "bg-amber-500",
    text: "text-amber-700",
  },
  inactive: {
    label: "Inactive",
    dot: "bg-slate-400",
    text: "text-slate-600",
  },
};

export function UserStatusBadge({
  status,
  className,
}: {
  status: MemberStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        meta.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

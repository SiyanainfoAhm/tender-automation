import Link from "next/link";
import {
  AlertTriangle,
  Calendar,
  ExternalLink,
  IndianRupee,
  User,
} from "lucide-react";

import { SourceBadge } from "@/components/status/source-badge";
import {
  ExecutionStatusBadge,
  HealthStatusBadge,
} from "@/components/won-tenders/won-project-badges";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import { formatDate, formatIndianCurrency } from "@/lib/format";
import type { WonProjectListItem } from "@/lib/won-projects";
import { cn } from "@/lib/utils";

type WonProjectCardProps = {
  project: WonProjectListItem;
};

function portalSource(portal: string | null): TenderSource {
  const upper = (portal || "").toUpperCase();
  if (upper === "BIDASSIST") return "BIDASSIST";
  if (upper === "MANUAL") return "MANUAL";
  return "TENDER247";
}

function ProgressBar({
  percent,
  tone,
}: {
  percent: number;
  tone: "sky" | "emerald";
}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          tone === "sky" ? "bg-sky-500" : "bg-emerald-500",
        )}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export function WonProjectCard({ project }: WonProjectCardProps) {
  const hasOverdue = project.overdueAmount > 0;

  return (
    <Link
      href={`/won-tenders/${project.id}`}
      className="group flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary-300 hover:bg-primary-50/20"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SourceBadge source={portalSource(project.portal)} size="sm" />
        <ExecutionStatusBadge status={project.executionStatus} />
        <HealthStatusBadge health={project.health} />
      </div>

      <h3 className="line-clamp-2 text-sm font-semibold text-foreground-900 group-hover:text-primary-700">
        {project.tenderTitle}
      </h3>
      <p className="mt-1 truncate text-xs text-foreground-500">
        {project.organization || "—"}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-foreground-500">PO</p>
          <p className="truncate font-medium text-foreground-800">
            {project.poNumber || "—"}
          </p>
        </div>
        <div>
          <p className="text-foreground-500">Award Value</p>
          <p className="font-medium text-foreground-800">
            {formatIndianCurrency(project.finalAwardValue)}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-foreground-500">Milestones</span>
            <span className="font-medium text-foreground-700">
              {project.milestonesCompleted}/{project.milestonesTotal} (
              {project.milestoneProgressPercent}%)
            </span>
          </div>
          <ProgressBar percent={project.milestoneProgressPercent} tone="sky" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-foreground-500">Payments</span>
            <span className="font-medium text-foreground-700">
              {formatIndianCurrency(project.paymentsReceived)} /{" "}
              {formatIndianCurrency(project.paymentsExpected)} (
              {project.paymentProgressPercent}%)
            </span>
          </div>
          <ProgressBar percent={project.paymentProgressPercent} tone="emerald" />
        </div>
      </div>

      {hasOverdue ? (
        <div className="mt-3 flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1.5 text-[11px] font-medium text-rose-800">
          <AlertTriangle className="size-3.5 shrink-0" />
          Overdue: {formatIndianCurrency(project.overdueAmount)}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[11px] text-foreground-500">
        {project.projectManagerName ? (
          <span className="inline-flex items-center gap-1">
            <User className="size-3" />
            {project.projectManagerName}
          </span>
        ) : null}
        {project.jiraProjectKey ? (
          <span className="inline-flex items-center gap-1">
            <ExternalLink className="size-3" />
            {project.jiraProjectKey}
          </span>
        ) : null}
        {project.nextMilestoneDueDate ? (
          <span className="inline-flex items-center gap-1">
            <Calendar className="size-3" />
            Next: {formatDate(project.nextMilestoneDueDate)}
          </span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1 font-medium text-foreground-600">
          <IndianRupee className="size-3" />
          {project.projectCode}
        </span>
      </div>
    </Link>
  );
}

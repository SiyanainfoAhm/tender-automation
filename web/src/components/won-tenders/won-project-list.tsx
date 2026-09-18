import Link from "next/link";
import { Calendar, User } from "lucide-react";

import { SourceBadge } from "@/components/status/source-badge";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import {
  ExecutionStatusBadge,
  HealthStatusBadge,
} from "@/components/won-tenders/won-project-badges";
import { formatDate, formatIndianCurrency } from "@/lib/format";
import type { WonProjectListItem } from "@/lib/won-projects";

type WonProjectListProps = {
  projects: WonProjectListItem[];
};

function portalSource(portal: string | null): TenderSource {
  const upper = (portal || "").toUpperCase();
  if (upper === "BIDASSIST") return "BIDASSIST";
  if (upper === "MANUAL") return "MANUAL";
  return "TENDER247";
}

export function WonProjectList({ projects }: WonProjectListProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[1050px] text-left text-sm">
        <thead className="border-b border-border bg-surface-muted/50 text-xs font-medium text-foreground-500">
          <tr>
            <th className="px-4 py-3">Project</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Health</th>
            <th className="px-4 py-3">PO / Code</th>
            <th className="px-4 py-3 text-right">Award value</th>
            <th className="px-4 py-3">Milestones</th>
            <th className="px-4 py-3">Payments</th>
            <th className="px-4 py-3">Project manager</th>
            <th className="px-4 py-3">Next milestone</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {projects.map((project) => (
            <tr key={project.id} className="group hover:bg-primary-50/20">
              <td className="max-w-[280px] px-4 py-3">
                <Link
                  href={`/won-tenders/${project.id}`}
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <div className="mb-1">
                    <SourceBadge source={portalSource(project.portal)} size="sm" />
                  </div>
                  <p className="truncate font-medium text-foreground-900 group-hover:text-primary-700">
                    {project.tenderTitle}
                  </p>
                  <p className="truncate text-xs text-foreground-500">
                    {project.organization || "—"}
                  </p>
                </Link>
              </td>
              <td className="px-4 py-3">
                <ExecutionStatusBadge status={project.executionStatus} />
              </td>
              <td className="px-4 py-3">
                <HealthStatusBadge health={project.health} />
              </td>
              <td className="px-4 py-3 text-xs text-foreground-600">
                <p className="font-medium text-foreground-800">{project.poNumber || "—"}</p>
                <p>{project.projectCode || "—"}</p>
              </td>
              <td className="px-4 py-3 text-right font-medium text-foreground-800">
                {formatIndianCurrency(project.finalAwardValue)}
              </td>
              <td className="px-4 py-3">
                <p className="whitespace-nowrap font-medium text-foreground-800">
                  {project.milestonesCompleted}/{project.milestonesTotal} ({project.milestoneProgressPercent}%)
                </p>
                <div className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, Math.max(0, project.milestoneProgressPercent))}%` }} />
                </div>
              </td>
              <td className="px-4 py-3">
                <p className="whitespace-nowrap font-medium text-foreground-800">
                  {formatIndianCurrency(project.paymentsReceived)} / {formatIndianCurrency(project.paymentsExpected)}
                </p>
                <p className={project.overdueAmount > 0 ? "mt-0.5 text-xs font-medium text-rose-700" : "mt-0.5 text-xs text-foreground-500"}>
                  {project.overdueAmount > 0 ? `Overdue: ${formatIndianCurrency(project.overdueAmount)}` : `${project.paymentProgressPercent}% received`}
                </p>
              </td>
              <td className="px-4 py-3 text-xs text-foreground-600">
                {project.projectManagerName ? (
                  <span className="inline-flex items-center gap-1.5"><User className="size-3.5" />{project.projectManagerName}</span>
                ) : "—"}
              </td>
              <td className="px-4 py-3 text-xs text-foreground-600">
                {project.nextMilestoneDueDate ? (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Calendar className="size-3.5" />{formatDate(project.nextMilestoneDueDate)}</span>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

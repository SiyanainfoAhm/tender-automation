"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  IndianRupee,
  PlayCircle,
  Search,
  Trophy,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { CompactKpiCard } from "@/components/tenders/compact-kpi-card";
import { WonProjectCard } from "@/components/won-tenders/won-project-card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatIndianCurrency } from "@/lib/format";
import {
  WON_EXECUTION_STATUSES,
  WON_EXECUTION_STATUS_LABELS,
  WON_HEALTH_STATUSES,
  WON_HEALTH_STATUS_LABELS,
  type WonExecutionStatus,
  type WonHealthStatus,
  type WonProjectListItem,
  type WonProjectSummary,
} from "@/lib/won-projects";

type TeamMemberOption = {
  id: string;
  fullName: string;
};

type WonTendersClientProps = {
  projects: WonProjectListItem[];
  summary: WonProjectSummary;
  teamMembers: TeamMemberOption[];
};

const ALL = "__all__";

export function WonTendersClient({
  projects,
  summary,
  teamMembers,
}: WonTendersClientProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [healthFilter, setHealthFilter] = useState<string>(ALL);
  const [assigneeFilter, setAssigneeFilter] = useState<string>(ALL);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter !== ALL && p.executionStatus !== statusFilter) return false;
      if (healthFilter !== ALL && p.health !== healthFilter) return false;
      if (assigneeFilter !== ALL && p.projectManagerId !== assigneeFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        p.tenderTitle,
        p.organization,
        p.poNumber,
        p.projectCode,
        p.referenceNo,
        p.projectManagerName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [projects, search, statusFilter, healthFilter, assigneeFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Won Tenders & Project Execution"
        subtitle="Track awarded contracts, milestones, payments, and delivery for won tenders."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <CompactKpiCard
          label="Total Projects"
          value={String(summary.totalProjects)}
          icon={Trophy}
          iconClassName="bg-amber-100 text-amber-700"
        />
        <CompactKpiCard
          label="Active Execution"
          value={String(summary.activeExecution)}
          icon={PlayCircle}
          iconClassName="bg-indigo-100 text-indigo-700"
        />
        <CompactKpiCard
          label="Completed"
          value={String(summary.completed)}
          icon={CheckCircle2}
          iconClassName="bg-emerald-100 text-emerald-700"
        />
        <CompactKpiCard
          label="Contract Value"
          value={formatIndianCurrency(summary.contractValue)}
          icon={IndianRupee}
          iconClassName="bg-sky-100 text-sky-700"
        />
        <CompactKpiCard
          label="Payments Received"
          value={formatIndianCurrency(summary.paymentsReceived)}
          icon={IndianRupee}
          iconClassName="bg-emerald-100 text-emerald-700"
        />
        <CompactKpiCard
          label="Payment Overdue"
          value={formatIndianCurrency(summary.paymentOverdue)}
          icon={AlertTriangle}
          iconClassName="bg-rose-100 text-rose-700"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, org, PO, code…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {WON_EXECUTION_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {WON_EXECUTION_STATUS_LABELS[status as WonExecutionStatus]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={healthFilter} onValueChange={setHealthFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Health" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All health</SelectItem>
            {WON_HEALTH_STATUSES.map((health) => (
              <SelectItem key={health} value={health}>
                {WON_HEALTH_STATUS_LABELS[health as WonHealthStatus]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Project manager" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All assignees</SelectItem>
            {teamMembers.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
          <Trophy className="mx-auto size-10 text-foreground-300" />
          <p className="mt-3 text-sm font-medium text-foreground-700">
            No won projects match your filters
          </p>
          <p className="mt-1 text-xs text-foreground-500">
            Mark a tender as Won from its detail page to start project execution
            tracking.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => (
            <WonProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

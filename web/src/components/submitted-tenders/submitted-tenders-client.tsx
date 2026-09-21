"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  FileCheck2,
  Search,
  Trophy,
  XCircle,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SourceBadge } from "@/components/status/source-badge";
import { StatusBadge } from "@/components/status/qualification-badge";
import { CompactKpiCard } from "@/components/tenders/compact-kpi-card";
import type { TenderSource } from "@/components/tenders/tender-status-styles";
import { MarkAsLostDialog } from "@/components/submitted-tenders/mark-as-lost-dialog";
import { MarkAsWonDialog } from "@/components/won-tenders/mark-as-won-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, formatIndianCurrency } from "@/lib/format";
import type {
  SubmittedTenderListItem,
  SubmittedTenderSummary,
} from "@/lib/submitted-tenders";
import type { QualificationStatus } from "@/components/tenders/tender-status-styles";

type TeamMemberOption = {
  id: string;
  fullName: string;
};

type SubmittedTendersClientProps = {
  items: SubmittedTenderListItem[];
  summary: SubmittedTenderSummary;
  teamMembers: TeamMemberOption[];
  canEdit: boolean;
};

const ALL = "__all__";

function portalSource(portal: string | null): TenderSource {
  const upper = (portal || "").toUpperCase();
  if (upper === "BIDASSIST") return "BIDASSIST";
  if (upper === "MANUAL") return "MANUAL";
  return "TENDER247";
}

function asBadgeStatus(status: string): QualificationStatus {
  const upper = status.toUpperCase();
  if (
    upper === "WON" ||
    upper === "LOST" ||
    upper === "SUBMITTED" ||
    upper === "GO" ||
    upper === "NO_GO" ||
    upper === "DISQUALIFIED" ||
    upper === "CANCELLED" ||
    upper === "DUPLICATE" ||
    upper === "VERIFY" ||
    upper === "PARTNER_BID" ||
    upper === "CONDITIONAL_GO" ||
    upper === "UNDER_EVALUATION"
  ) {
    return upper as QualificationStatus;
  }
  return "SUBMITTED";
}

export function SubmittedTendersClient({
  items,
  summary,
  teamMembers,
  canEdit,
}: SubmittedTendersClientProps) {
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>(ALL);
  const [wonTarget, setWonTarget] = useState<SubmittedTenderListItem | null>(
    null,
  );
  const [lostTarget, setLostTarget] = useState<SubmittedTenderListItem | null>(
    null,
  );
  const [lostMode, setLostMode] = useState<"mark-lost" | "edit-reason">(
    "mark-lost",
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const status = String(item.qualificationStatus || "").toUpperCase();
      if (outcomeFilter === "SUBMITTED") {
        if (status === "WON" || status === "LOST") return false;
      } else if (outcomeFilter !== ALL && status !== outcomeFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        item.title,
        item.organization,
        item.referenceNo,
        item.submissionReference,
        item.lostReason,
        item.location,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, search, outcomeFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submitted Tenders"
        subtitle="Track submitted bids and record Won or Lost outcomes. Lost reason is required when marking Lost."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CompactKpiCard
          label="Total"
          value={String(summary.total)}
          icon={FileCheck2}
          iconClassName="bg-sky-100 text-sky-700"
        />
        <CompactKpiCard
          label="Awaiting outcome"
          value={String(summary.submitted)}
          icon={FileCheck2}
          iconClassName="bg-blue-100 text-blue-700"
        />
        <CompactKpiCard
          label="Won"
          value={String(summary.won)}
          icon={Trophy}
          iconClassName="bg-amber-100 text-amber-700"
        />
        <CompactKpiCard
          label="Lost"
          value={String(summary.lost)}
          icon={XCircle}
          iconClassName="bg-rose-100 text-rose-700"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, org, reference, lost reason…"
            className="pl-9"
          />
        </div>
        <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Outcome" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All outcomes</SelectItem>
            <SelectItem value="SUBMITTED">Awaiting outcome</SelectItem>
            <SelectItem value="WON">Won</SelectItem>
            <SelectItem value="LOST">Lost</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <CheckCircle2 className="mx-auto size-8 text-foreground-300" />
          <p className="mt-3 text-sm font-medium text-foreground-800">
            No submitted tenders match
          </p>
          <p className="mt-1 text-sm text-foreground-500">
            Submit a bid from Bid Workspace, then set Won or Lost here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-border bg-background-50 text-xs uppercase tracking-wide text-foreground-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Tender</th>
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Value</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-4 py-3 font-medium">Lost reason</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((item) => {
                  const status = String(
                    item.qualificationStatus || "",
                  ).toUpperCase();
                  const isWon = status === "WON";
                  const isLost = status === "LOST";
                  const awaiting = !isWon && !isLost;

                  return (
                    <tr key={item.id} className="align-top hover:bg-background-50/80">
                      <td className="px-4 py-3">
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <SourceBadge
                            source={portalSource(item.portal)}
                            size="sm"
                          />
                        </div>
                        <Link
                          href={`/tenders/${item.id}`}
                          className="font-medium text-foreground-900 hover:text-primary-700 hover:underline"
                        >
                          {item.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-foreground-500">
                          {[item.organization, item.referenceNo]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-foreground-700">
                        <div>{formatDate(item.submittedAt) || "—"}</div>
                        {item.submissionReference ? (
                          <div className="mt-0.5 text-xs text-foreground-500">
                            Ref: {item.submissionReference}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-foreground-700">
                        {item.tenderValue != null
                          ? formatIndianCurrency(item.tenderValue)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={asBadgeStatus(status)}
                          size="sm"
                        />
                        {isWon && item.wonProjectId ? (
                          <Link
                            href={`/won-tenders/${item.wonProjectId}`}
                            className="mt-1.5 block text-xs text-primary-700 hover:underline"
                          >
                            Open won project
                          </Link>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 max-w-[240px]">
                        {isLost ? (
                          <p className="text-sm text-foreground-700 whitespace-pre-wrap">
                            {item.lostReason || (
                              <span className="text-rose-600">
                                Reason missing — add one
                              </span>
                            )}
                          </p>
                        ) : (
                          <span className="text-foreground-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/tenders/${item.id}`}>View</Link>
                          </Button>
                          {canEdit && awaiting ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => setWonTarget(item)}
                              >
                                Mark Won
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  setLostMode("mark-lost");
                                  setLostTarget(item);
                                }}
                              >
                                Mark Lost
                              </Button>
                            </>
                          ) : null}
                          {canEdit && isLost ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setLostMode("edit-reason");
                                setLostTarget(item);
                              }}
                            >
                              {item.lostReason
                                ? "Edit reason"
                                : "Add lost reason"}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {wonTarget ? (
        <MarkAsWonDialog
          open={Boolean(wonTarget)}
          onOpenChange={(open) => {
            if (!open) setWonTarget(null);
          }}
          tenderId={wonTarget.id}
          tenderTitle={wonTarget.title}
          defaultAwardValue={wonTarget.tenderValue}
          teamMembers={teamMembers}
        />
      ) : null}

      {lostTarget ? (
        <MarkAsLostDialog
          open={Boolean(lostTarget)}
          onOpenChange={(open) => {
            if (!open) setLostTarget(null);
          }}
          tenderId={lostTarget.id}
          tenderTitle={lostTarget.title}
          mode={lostMode}
          initialReason={lostTarget.lostReason}
        />
      ) : null}
    </div>
  );
}

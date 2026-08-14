"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { BoqEditor } from "@/components/bid-workspace/boq-editor";
import { ProposalEditor } from "@/components/bid-workspace/proposal-editor";
import { WorkspaceDocuments } from "@/components/bid-workspace/workspace-documents";
import { CategoryCapsule } from "@/components/tenders/category-capsule";
import { SourceBadge } from "@/components/status/source-badge";
import { StatusBadge } from "@/components/status/qualification-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BidWorkspaceDTO } from "@/lib/bid-workspace";
import {
  formatDate,
  formatEmdAmount,
  formatRelativeTime,
  formatTenderValue,
} from "@/lib/format";
import { getCalendarDaysUntilDeadline } from "@/lib/tender-deadline";
import type { TenderDetailDTO } from "@/lib/tender-detail";
import { cn } from "@/lib/utils";
import { markBidSubmittedAction } from "@/server/actions/bid-workspace";

type BidWorkspaceClientProps = {
  tender: TenderDetailDTO;
  workspace: BidWorkspaceDTO;
  canEdit: boolean;
  canSubmit: boolean;
};

export function BidWorkspaceClient({
  tender,
  workspace,
  canEdit,
  canSubmit,
}: BidWorkspaceClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"proposal" | "boq" | "documents">("proposal");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reference, setReference] = useState("");
  const [submittedAt, setSubmittedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");

  const days = getCalendarDaysUntilDeadline(tender.closingDate);
  const readOnly =
    !canEdit ||
    workspace.submissionStatus === "submitted" ||
    tender.qualificationStatus === "NO_GO";
  const proposalDone = workspace.sections.filter((s) => s.status === "complete").length;
  const docsReady = workspace.documents.filter((d) => d.hasFile && (d.status === "ready" || d.status === "approved")).length;

  const tabs = useMemo(
    () => [
      {
        id: "proposal" as const,
        label: "Technical Proposal",
        count: `${proposalDone}/${workspace.sections.length}`,
      },
      { id: "boq" as const, label: "Financial BOQ", count: String(workspace.boqItems.length) },
      {
        id: "documents" as const,
        label: "Documents",
        count: `${docsReady}/${workspace.documents.length}`,
      },
    ],
    [docsReady, proposalDone, workspace.boqItems.length, workspace.documents.length, workspace.sections.length],
  );

  async function submit() {
    setSaving(true);
    try {
      const result = await markBidSubmittedAction({
        tenderId: tender.id,
        submissionReference: reference,
        submittedAt,
        notes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Bid marked submitted.");
      setSubmitOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const incomplete = workspace.readiness.incompleteRequired;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Link
            href="/tenders"
            className="inline-flex shrink-0 items-center gap-1 text-foreground-500 hover:text-foreground-900"
          >
            <ArrowLeft className="size-4" />
            Tenders
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-foreground-400" />
          <Link
            href={`/tenders/${tender.id}`}
            className="truncate text-foreground-500 hover:text-foreground-900"
          >
            {tender.sourceTenderId}
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-foreground-400" />
          <span className="shrink-0 font-medium text-foreground-900">
            Bid Workspace
          </span>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <SourceBadge
                  source={tender.sourcePortal}
                  size="sm"
                  className="rounded px-2 py-0.5 text-[11px]"
                />
                <CategoryCapsule
                  category={tender.projectCategory}
                  title={tender.title}
                  description={tender.description}
                  sourceCategory={tender.sourceCategory}
                  className="rounded px-2 py-0.5 text-[11px]"
                />
                {tender.qualificationStatus ? (
                  <StatusBadge status={tender.qualificationStatus} size="sm" />
                ) : null}
                {workspace.submissionStatus === "submitted" ? (
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Submitted
                  </span>
                ) : null}
              </div>
              <h1 className="text-lg font-semibold leading-snug md:text-xl">
                {tender.title}
              </h1>
            </div>

            <div className="w-full shrink-0 sm:w-64">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-default">
                    <p className="text-xs text-foreground-500">
                      Submission Readiness
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {workspace.readiness.percent}%
                    </p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background-200">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${workspace.readiness.percent}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-foreground-400">
                      Saved {formatRelativeTime(workspace.updatedAt)}
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="space-y-1">
                  {workspace.readiness.items.map((item) => (
                    <p key={item.key}>
                      {item.label} {item.completed}/{item.total}
                      {item.key === "boq"
                        ? item.completed
                          ? " Complete"
                          : " Incomplete"
                        : ""}
                    </p>
                  ))}
                </TooltipContent>
              </Tooltip>
              <Button
                className="mt-3 w-full"
                disabled={!canSubmit || workspace.submissionStatus === "submitted"}
                onClick={() => {
                  if (incomplete > 0) {
                    toast.error(
                      `${incomplete} required item${incomplete === 1 ? " is" : "s are"} still incomplete.`,
                    );
                    return;
                  }
                  setSubmitOpen(true);
                }}
              >
                {workspace.submissionStatus === "submitted"
                  ? "Bid submitted"
                  : "Mark Bid as Submitted"}
              </Button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-5 md:grid-cols-4">
            <Info
              label="Tender Value"
              value={
                formatTenderValue({
                  amount: tender.tenderValue,
                  text: tender.tenderValueText,
                }).label
              }
            />
            <Info
              label="EMD Required"
              value={
                formatEmdAmount({
                  amount: tender.emdAmount,
                  text: tender.emdText,
                }).label
              }
            />
            <Info label="Deadline" value={formatDate(tender.closingDate)} />
            <Info
              label="Days Left"
              value={
                days == null ? "—" : days < 0 ? "Closed" : String(days)
              }
            />
          </div>
        </div>

        <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-background-100 p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                tab === item.id
                  ? "bg-white text-foreground-900 shadow-sm"
                  : "text-foreground-500",
              )}
            >
              {item.label}{" "}
              <span className="text-foreground-400">{item.count}</span>
            </button>
          ))}
        </div>

        {tab === "proposal" ? (
          <ProposalEditor
            tenderId={tender.id}
            sections={workspace.sections}
            readOnly={readOnly}
          />
        ) : null}
        {tab === "boq" ? (
          <BoqEditor
            tenderId={tender.id}
            items={workspace.boqItems}
            readOnly={readOnly}
          />
        ) : null}
        {tab === "documents" ? (
          <WorkspaceDocuments
            tenderId={tender.id}
            documents={workspace.documents}
            readOnly={readOnly}
          />
        ) : null}

        <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Mark this tender as submitted?</DialogTitle>
              <DialogDescription>
                This records offline / external submission in TenderFlow. It
                does not submit to a government portal.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Submission Reference</Label>
                <Input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Submission Date</Label>
                <Input
                  type="date"
                  value={submittedAt}
                  onChange={(event) => setSubmittedAt(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Optional Notes</Label>
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSubmitOpen(false)}>
                Cancel
              </Button>
              <Button disabled={saving} onClick={() => void submit()}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Mark submitted"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CheckCircle2,
  CircleHelp,
  Inbox,
  Loader2,
  ScanEye,
  Send,
  ThumbsDown,
  ThumbsUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CLASSIFICATION_ACTIONS,
  CLASSIFICATION_ACTION_META,
  PIPELINE_STAGES,
  derivePipelineStage,
  pipelineStageIndex,
  type ClassificationAction,
  type PipelineStage,
} from "@/lib/tender-classification";
import type { TenderStatus } from "@/lib/tender-status";
import { updateTenderClassificationAction } from "@/server/actions/tender-classification";

const ACTION_ICONS: Record<ClassificationAction, LucideIcon> = {
  GO: ThumbsUp,
  CONDITIONAL_GO: CircleHelp,
  PARTNER_BID: Users,
  NO_GO: ThumbsDown,
};

const STAGE_ICONS: Record<PipelineStage, LucideIcon> = {
  new: Inbox,
  screening: ScanEye,
  will_bid: CheckCircle2,
  submitted: Send,
};

type ClassificationWorkflowProps = {
  tenderId: string;
  qualificationStatus: TenderStatus | null;
  submitted: boolean;
  canClassify: boolean;
  conditions: unknown[];
  partnershipRequiredFor: unknown[];
};

export function ClassificationWorkflow({
  tenderId,
  qualificationStatus,
  submitted,
  canClassify,
  conditions,
  partnershipRequiredFor,
}: ClassificationWorkflowProps) {
  const router = useRouter();
  const [saving, setSaving] = useState<ClassificationAction | null>(null);
  const [noBidOpen, setNoBidOpen] = useState(false);
  const [noBidReason, setNoBidReason] = useState("");

  const stage = derivePipelineStage({
    qualificationStatus,
    submitted,
  });
  const activeIndex = pipelineStageIndex(stage);

  async function persist(status: ClassificationAction, reason?: string) {
    setSaving(status);
    try {
      const result = await updateTenderClassificationAction({
        tenderId,
        status,
        reason,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setNoBidOpen(false);
      setNoBidReason("");
      router.refresh();
    } catch {
      toast.error("Unable to update classification.");
    } finally {
      setSaving(null);
    }
  }

  function onSelect(status: ClassificationAction) {
    if (!canClassify || saving || submitted) return;
    if (status === qualificationStatus) return;
    if (status === "NO_GO") {
      setNoBidOpen(true);
      return;
    }
    void persist(status);
  }

  const showConditions =
    qualificationStatus === "CONDITIONAL_GO" && conditions.length > 0;
  const showPartnership =
    qualificationStatus === "PARTNER_BID" && partnershipRequiredFor.length > 0;

  return (
    <div className="rounded-lg border border-border bg-card p-5 md:p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground-900">
        Classification Workflow
      </h2>
      <p className="mt-1 text-xs text-foreground-500">
        Track and update the tender&apos;s bid status
      </p>

      <ol className="mt-5 flex items-start justify-between gap-1">
        {PIPELINE_STAGES.map((item, index) => {
          const reached = index <= activeIndex;
          const current = index === activeIndex;
          const StageIcon = STAGE_ICONS[item.key];
          return (
            <li key={item.key} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                {index > 0 ? (
                  <div
                    className={cn(
                      "h-px flex-1",
                      index <= activeIndex ? "bg-emerald-400" : "bg-background-200",
                    )}
                  />
                ) : (
                  <div className="flex-1" />
                )}
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border",
                    current
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : reached
                        ? "border-emerald-400 bg-emerald-50 text-emerald-600"
                        : "border-background-200 bg-white text-foreground-400",
                  )}
                >
                  <StageIcon className="size-4" strokeWidth={1.75} />
                </span>
                {index < PIPELINE_STAGES.length - 1 ? (
                  <div
                    className={cn(
                      "h-px flex-1",
                      index < activeIndex ? "bg-emerald-400" : "bg-background-200",
                    )}
                  />
                ) : (
                  <div className="flex-1" />
                )}
              </div>
              <span
                className={cn(
                  "mt-2 text-center text-[11px] font-medium",
                  current ? "text-foreground-900" : "text-foreground-500",
                )}
              >
                {item.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-xs text-foreground-500">Current Status</span>
        {qualificationStatus ? (
          <StatusBadge status={qualificationStatus} size="sm" />
        ) : (
          <span className="text-xs font-medium text-foreground-500">New</span>
        )}
      </div>

      <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
        Update Classification
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {CLASSIFICATION_ACTIONS.map((status) => {
          const meta = CLASSIFICATION_ACTION_META[status];
          const active = qualificationStatus === status;
          const ActionIcon = ACTION_ICONS[status];
          return (
            <button
              key={status}
              type="button"
              disabled={!canClassify || Boolean(saving) || submitted}
              onClick={() => onSelect(status)}
              className={cn(
                "flex min-h-[78px] flex-col items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                active
                  ? meta.activeClass
                  : "border-background-200 bg-white text-foreground-700 hover:bg-background-50",
              )}
            >
              {saving === status ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <ActionIcon className="size-5" strokeWidth={1.75} />
              )}
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>

      {submitted ? (
        <p className="mt-3 text-xs text-emerald-700">
          Bid marked submitted. Classification is locked.
        </p>
      ) : null}

      {showConditions ? (
        <div className="mt-4 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
          <p className="font-semibold">Outstanding conditions</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {conditions.slice(0, 6).map((item, index) => (
              <li key={index}>
                {typeof item === "string"
                  ? item
                  : String(
                      (item as { condition?: string }).condition ||
                        JSON.stringify(item),
                    )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showPartnership ? (
        <div className="mt-4 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          <p className="font-semibold">Partnership required for</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {partnershipRequiredFor.slice(0, 6).map((item, index) => (
              <li key={index}>
                {typeof item === "string" ? item : JSON.stringify(item)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog open={noBidOpen} onOpenChange={setNoBidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as No Bid</DialogTitle>
            <DialogDescription>
              Record a short reason. This updates the stored qualification
              reason when one already exists.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="no-bid-reason">Reason</Label>
            <Textarea
              id="no-bid-reason"
              value={noBidReason}
              onChange={(event) => setNoBidReason(event.target.value)}
              placeholder="Why is this tender a No Bid?"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoBidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={saving === "NO_GO" || noBidReason.trim().length < 8}
              onClick={() => void persist("NO_GO", noBidReason)}
            >
              {saving === "NO_GO" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Mark No Bid"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

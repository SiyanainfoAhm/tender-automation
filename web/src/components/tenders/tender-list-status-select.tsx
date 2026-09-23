"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { QualificationStatusSelect } from "@/components/status/qualification-status-select";
import { MarkAsLostDialog } from "@/components/submitted-tenders/mark-as-lost-dialog";
import { StatusChangeCommentDialog } from "@/components/tenders/status-change-comment-dialog";
import { MarkAsWonDialog } from "@/components/won-tenders/mark-as-won-dialog";
import {
  STATUS_DISPLAY_LABELS,
  TENDER_STATUSES,
  tenderDetailStatusChoices,
  type TenderStatus,
} from "@/lib/tender-status";
import { invalidateTenderListCaches } from "@/lib/tenders/list-cache";
import { updateTenderDetailsAction } from "@/server/actions/tender-update";

type TeamMemberOption = { id: string; fullName: string };

type TenderListStatusSelectProps = {
  tenderId: string;
  tenderTitle: string;
  tenderValue: number | null;
  currentStatus: string | null | undefined;
  canEdit: boolean;
  teamMembers: TeamMemberOption[];
};

/** Inline status control for tender-list rows, with the same guarded flows as tender details. */
export function TenderListStatusSelect({
  tenderId,
  tenderTitle,
  tenderValue,
  currentStatus,
  canEdit,
  teamMembers,
}: TenderListStatusSelectProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [statusCommentOpen, setStatusCommentOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [wonOpen, setWonOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<TenderStatus | null>(null);
  const raw = String(currentStatus || "")
    .trim()
    .toUpperCase();
  const known = (TENDER_STATUSES as readonly string[]).includes(raw)
    ? (raw as TenderStatus)
    : null;
  const statuses = tenderDetailStatusChoices({
    currentStatus: known ?? "VERIFY",
  });
  const value = (
    known && (statuses as readonly string[]).includes(known)
      ? known
      : statuses.includes("VERIFY")
        ? "VERIFY"
        : statuses[0]
  ) as TenderStatus;
  const locked = statuses.length === 1;

  function onStatusChange(next: TenderStatus) {
    if (!canEdit || pending || locked || next === value) return;
    if (next === "WON") {
      setWonOpen(true);
      return;
    }
    if (next === "LOST") {
      setLostOpen(true);
      return;
    }
    setPendingStatus(next);
    setStatusCommentOpen(true);
  }

  function refreshList(reason: string) {
    invalidateTenderListCaches(reason);
    router.refresh();
  }

  return (
    <>
      <QualificationStatusSelect
        value={value}
        statuses={statuses}
        onValueChange={onStatusChange}
        disabled={!canEdit || pending || locked}
        className="h-8 w-[9.5rem] text-xs"
        ariaLabel={`Update status for ${tenderTitle}`}
      />

      <StatusChangeCommentDialog
        open={statusCommentOpen}
        onOpenChange={(open) => {
          setStatusCommentOpen(open);
          if (!open) setPendingStatus(null);
        }}
        statusLabel={pendingStatus ? STATUS_DISPLAY_LABELS[pendingStatus] : "status"}
        pending={pending}
        onConfirm={(comment) => {
          if (!pendingStatus) return;
          startTransition(async () => {
            const result = await updateTenderDetailsAction({
              tenderId,
              qualificationStatus: pendingStatus,
              decisionReason: comment,
            });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(`Tender status updated to ${STATUS_DISPLAY_LABELS[pendingStatus]}.`);
            setStatusCommentOpen(false);
            setPendingStatus(null);
            refreshList("tender-list-status-updated");
          });
        }}
      />

      <MarkAsLostDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        tenderId={tenderId}
        tenderTitle={tenderTitle}
      />
      <MarkAsWonDialog
        open={wonOpen}
        onOpenChange={setWonOpen}
        tenderId={tenderId}
        tenderTitle={tenderTitle}
        defaultAwardValue={tenderValue}
        teamMembers={teamMembers}
        onSuccess={() => refreshList("tender-list-marked-won")}
      />
    </>
  );
}

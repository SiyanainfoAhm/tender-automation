"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { StatusChangeCommentDialog } from "@/components/tenders/status-change-comment-dialog";
import { MarkAsLostDialog } from "@/components/submitted-tenders/mark-as-lost-dialog";
import { MarkAsWonDialog } from "@/components/won-tenders/mark-as-won-dialog";
import { QualificationStatusSelect } from "@/components/status/qualification-status-select";
import {
  STATUS_DISPLAY_LABELS,
  tenderDetailStatusChoices,
  type TenderStatus,
} from "@/lib/tender-status";
import { updateTenderDetailsAction } from "@/server/actions/tender-update";

type TeamMemberOption = {
  id: string;
  fullName: string;
};

type SubmittedOutcomeSelectProps = {
  tenderId: string;
  tenderTitle: string;
  currentStatus: string | null | undefined;
  tenderValue?: number | null;
  teamMembers?: TeamMemberOption[];
  canEdit: boolean;
};

function normalizeStatus(status: string | null | undefined): string {
  return String(status || "SUBMITTED").trim().toUpperCase();
}

export function SubmittedOutcomeSelect({
  tenderId,
  tenderTitle,
  currentStatus,
  tenderValue = null,
  teamMembers = [],
  canEdit,
}: SubmittedOutcomeSelectProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [wonOpen, setWonOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [statusChangeOpen, setStatusChangeOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<TenderStatus | null>(null);
  const status = normalizeStatus(currentStatus) as TenderStatus;
  const statusChoices = tenderDetailStatusChoices({
    currentStatus: status,
    submitted: true,
  });
  const selectValue = (statusChoices as readonly string[]).includes(status)
    ? status
    : "SUBMITTED";
  const locked = statusChoices.length === 1;

  function onChange(next: TenderStatus) {
    if (!canEdit || locked || pending) return;
    if (next === selectValue) return;
    if (next === "WON") {
      setWonOpen(true);
      return;
    }
    if (next === "LOST") {
      setLostOpen(true);
      return;
    }
    setPendingStatus(next);
    setStatusChangeOpen(true);
  }

  return (
    <>
      <QualificationStatusSelect
        value={selectValue}
        onValueChange={onChange}
        statuses={statusChoices}
        disabled={!canEdit || locked || pending}
        className="h-8 w-[9.5rem] text-xs"
        ariaLabel="Update submitted tender status"
      />

      <MarkAsWonDialog
        open={wonOpen}
        onOpenChange={setWonOpen}
        tenderId={tenderId}
        tenderTitle={tenderTitle}
        defaultAwardValue={tenderValue}
        teamMembers={teamMembers}
      />
      <MarkAsLostDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        tenderId={tenderId}
        tenderTitle={tenderTitle}
        mode="mark-lost"
      />
      <StatusChangeCommentDialog
        open={statusChangeOpen}
        onOpenChange={setStatusChangeOpen}
        statusLabel={
          pendingStatus ? STATUS_DISPLAY_LABELS[pendingStatus] : "status"
        }
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
            toast.success(
              `Tender status updated to ${STATUS_DISPLAY_LABELS[pendingStatus]}.`,
            );
            setStatusChangeOpen(false);
            setPendingStatus(null);
            router.refresh();
          });
        }}
      />
    </>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { QualificationStatusSelect } from "@/components/status/qualification-status-select";
import { MarkAsLostDialog } from "@/components/submitted-tenders/mark-as-lost-dialog";
import { StatusChangeCommentDialog } from "@/components/tenders/status-change-comment-dialog";
import { MarkAsWonDialog } from "@/components/won-tenders/mark-as-won-dialog";
import { STATUS_DISPLAY_LABELS, TENDER_STATUSES, type TenderStatus } from "@/lib/tender-status";
import { updateTenderDetailsAction } from "@/server/actions/tender-update";

type TeamMemberOption = { id: string; fullName: string };

type SubmittedOutcomeSelectProps = {
  tenderId: string;
  tenderTitle: string;
  tenderValue?: number | null;
  currentStatus: string | null | undefined;
  teamMembers?: TeamMemberOption[];
  canEdit: boolean;
};

export function SubmittedOutcomeSelect({
  tenderId,
  tenderTitle,
  tenderValue = null,
  currentStatus,
  teamMembers = [],
  canEdit,
}: SubmittedOutcomeSelectProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [wonOpen, setWonOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [deleteStatusOpen, setDeleteStatusOpen] = useState(false);
  const rawStatus = String(currentStatus || "SUBMITTED").trim().toUpperCase();
  const value = (TENDER_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as TenderStatus)
    : "SUBMITTED";
  const statuses = [
    value,
    ...(["WON", "LOST", "DELETE"] as const).filter((status) => status !== value),
  ] as readonly TenderStatus[];

  function onStatusChange(next: TenderStatus) {
    if (!canEdit || pending || next === value) return;
    if (next === "WON") {
      setWonOpen(true);
      return;
    }
    if (next === "LOST") {
      setLostOpen(true);
      return;
    }
    if (next === "DELETE") setDeleteStatusOpen(true);
  }

  return (
    <>
      <QualificationStatusSelect
        value={value}
        statuses={statuses}
        onValueChange={onStatusChange}
        disabled={!canEdit || pending}
        className="h-8 w-[9.5rem] text-xs"
        ariaLabel={`Update status for ${tenderTitle}`}
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
        open={deleteStatusOpen}
        onOpenChange={setDeleteStatusOpen}
        statusLabel={STATUS_DISPLAY_LABELS.DELETE}
        pending={pending}
        onConfirm={(comment) => {
          startTransition(async () => {
            const result = await updateTenderDetailsAction({
              tenderId,
              qualificationStatus: "DELETE",
              decisionReason: comment,
            });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Tender status updated to Delete.");
            setDeleteStatusOpen(false);
            router.refresh();
          });
        }}
      />
    </>
  );
}

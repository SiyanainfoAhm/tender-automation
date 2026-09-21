"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { StatusChangeCommentDialog } from "@/components/tenders/status-change-comment-dialog";
import { MarkAsLostDialog } from "@/components/submitted-tenders/mark-as-lost-dialog";
import { MarkAsWonDialog } from "@/components/won-tenders/mark-as-won-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_DISPLAY_LABELS, type TenderStatus } from "@/lib/tender-status";
import { updateTenderDetailsAction } from "@/server/actions/tender-update";

type TeamMemberOption = {
  id: string;
  fullName: string;
};

/**
 * After a bid is submitted, status can only move forward to Won, Lost, or
 * Cancelled. Earlier stages (Will Bid, Verify, and so on) are not offered.
 */
const FORWARD_STATUSES = ["WON", "LOST", "CANCELLED"] as const;

type ForwardStatus = (typeof FORWARD_STATUSES)[number];

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
  const [cancelOpen, setCancelOpen] = useState(false);
  const status = normalizeStatus(currentStatus);
  const locked = status === "WON" || status === "LOST" || status === "CANCELLED";
  const selectValue =
    status === "WON" || status === "LOST" || status === "CANCELLED"
      ? status
      : "SUBMITTED";

  function onChange(next: string) {
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
    if (next === "CANCELLED") {
      setCancelOpen(true);
    }
  }

  const options: Array<{ value: string; label: string }> = locked
    ? [
        {
          value: selectValue,
          label: STATUS_DISPLAY_LABELS[selectValue as TenderStatus] || selectValue,
        },
      ]
    : [
        { value: "SUBMITTED", label: STATUS_DISPLAY_LABELS.SUBMITTED },
        ...FORWARD_STATUSES.map((value) => ({
          value,
          label: STATUS_DISPLAY_LABELS[value],
        })),
      ];

  return (
    <>
      <Select
        value={selectValue}
        onValueChange={onChange}
        disabled={!canEdit || locked || pending}
      >
        <SelectTrigger
          className="h-8 w-[9.5rem] text-xs"
          aria-label="Update submitted tender status"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        statusLabel={STATUS_DISPLAY_LABELS.CANCELLED}
        pending={pending}
        onConfirm={(comment) => {
          startTransition(async () => {
            const result = await updateTenderDetailsAction({
              tenderId,
              qualificationStatus: "CANCELLED",
              decisionReason: comment,
            });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Tender marked as cancelled.");
            setCancelOpen(false);
            router.refresh();
          });
        }}
      />
    </>
  );
}

export function isForwardSubmittedStatus(
  status: string | null | undefined,
): status is ForwardStatus {
  return (FORWARD_STATUSES as readonly string[]).includes(
    normalizeStatus(status),
  );
}

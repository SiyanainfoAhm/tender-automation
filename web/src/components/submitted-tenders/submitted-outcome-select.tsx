"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { MarkAsLostDialog } from "@/components/submitted-tenders/mark-as-lost-dialog";
import { StatusChangeCommentDialog } from "@/components/tenders/status-change-comment-dialog";
import { MarkAsWonDialog } from "@/components/won-tenders/mark-as-won-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATUS_DISPLAY_LABELS } from "@/lib/tender-status";
import { updateTenderDetailsAction } from "@/server/actions/tender-update";

type TeamMemberOption = {
  id: string;
  fullName: string;
};

type SubmittedOutcomeSelectProps = {
  tenderId: string;
  tenderTitle: string;
  tenderValue?: number | null;
  teamMembers?: TeamMemberOption[];
  canEdit: boolean;
};

export function SubmittedOutcomeSelect({
  tenderId,
  tenderTitle,
  tenderValue = null,
  teamMembers = [],
  canEdit,
}: SubmittedOutcomeSelectProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [wonOpen, setWonOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);

  const [deleteStatusOpen, setDeleteStatusOpen] = useState(false);

  /* function deleteTender() {
    if (!window.confirm(`Delete “${tenderTitle}”? This cannot be undone.`)) {
      return;
    }
    startTransition(async () => {
      const result = await deleteTenderAction(tenderId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  } */

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canEdit || pending}
            className="h-8 min-w-[6.5rem] justify-between text-xs"
            aria-label={`Actions for ${tenderTitle}`}
          >
            Actions <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setWonOpen(true)}>
            Won
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setLostOpen(true)}>
            Lost
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-rose-700 focus:text-rose-700"
            onSelect={() => setDeleteStatusOpen(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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

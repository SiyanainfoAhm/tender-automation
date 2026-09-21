"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  markTenderAsLostAction,
  updateSubmittedLostReasonAction,
} from "@/server/actions/submitted-tenders";

type MarkAsLostDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenderId: string;
  tenderTitle: string;
  /** When set, dialog edits reason only (tender already LOST). */
  mode?: "mark-lost" | "edit-reason";
  initialReason?: string | null;
};

export function MarkAsLostDialog({
  open,
  onOpenChange,
  tenderId,
  tenderTitle,
  mode = "mark-lost",
  initialReason = null,
}: MarkAsLostDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lostReason, setLostReason] = useState(initialReason || "");

  useEffect(() => {
    if (!open) return;
    setLostReason(initialReason || "");
  }, [open, initialReason]);

  function submit() {
    const reason = lostReason.trim();
    if (!reason) {
      toast.error("Lost reason is required.");
      return;
    }

    startTransition(async () => {
      const result =
        mode === "edit-reason"
          ? await updateSubmittedLostReasonAction({
              tenderId,
              lostReason: reason,
            })
          : await markTenderAsLostAction({
              tenderId,
              lostReason: reason,
            });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit-reason" ? "Edit Lost Reason" : "Mark Tender as Lost"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit-reason"
              ? "Update why this tender was lost."
              : "Record the outcome for"}{" "}
            <span className="font-medium text-foreground-800">{tenderTitle}</span>
            {mode === "mark-lost" ? ". Lost reason is required." : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="lost-reason">
            Lost reason <span className="text-rose-600">*</span>
          </Label>
          <Textarea
            id="lost-reason"
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="e.g. Price too high, technical non-compliance, awarded to competitor…"
            rows={4}
            disabled={pending}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || !lostReason.trim()}
            onClick={submit}
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving…
              </>
            ) : mode === "edit-reason" ? (
              "Save reason"
            ) : (
              "Mark as Lost"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

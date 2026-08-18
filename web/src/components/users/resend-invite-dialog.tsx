"use client";

import { useState, useTransition } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { resendTenderFlowInviteAction } from "@/server/actions/team";

type ResendInviteDialogProps = {
  userId: string;
  fullName: string;
};

export function ResendInviteDialog({
  userId,
  fullName,
}: ResendInviteDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setError(null);
  }

  function onConfirm() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await resendTenderFlowInviteAction(userId);
      if (result.ok && result.inviteSent) {
        toast.success("Invitation resent successfully.");
        setOpen(false);
        return;
      }
      const message =
        result.error ||
        "Invitation email could not be sent. Please try again.";
      toast.error(message);
      setError(message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-text-muted hover:text-text-primary"
              aria-label="Resend invitation"
            >
              <Mail className="size-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Resend Invite</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resend invitation?</DialogTitle>
          <DialogDescription>
            A new temporary password will be generated and emailed to {fullName}.
            Any previous temporary password will stop working.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending...
              </>
            ) : (
              "Resend Invite"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

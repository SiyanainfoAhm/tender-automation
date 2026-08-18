"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
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
import { deleteCompanyMemberAction } from "@/server/actions/team";

type RemoveUserDialogProps = {
  userId: string;
  fullName: string;
};

export function RemoveUserDialog({ userId, fullName }: RemoveUserDialogProps) {
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
      const result = await deleteCompanyMemberAction(userId);
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("User deleted.");
      setOpen(false);
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
              className="size-8 text-text-muted hover:text-red-600"
              aria-label="Delete member"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete user?</DialogTitle>
          <DialogDescription>
            This permanently deletes {fullName} from TenderFlow and removes
            their account from the database. They will lose access immediately.
            This cannot be undone.
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
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete user"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

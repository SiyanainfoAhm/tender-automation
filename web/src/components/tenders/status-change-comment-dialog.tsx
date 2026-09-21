"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

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

type StatusChangeCommentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusLabel: string;
  pending?: boolean;
  onConfirm: (comment: string) => void;
};

export function StatusChangeCommentDialog({
  open,
  onOpenChange,
  statusLabel,
  pending = false,
  onConfirm,
}: StatusChangeCommentDialogProps) {
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!open) return;
    setComment("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Comment required</DialogTitle>
          <DialogDescription>
            Add a comment to change the status to{" "}
            <span className="font-medium text-foreground-800">{statusLabel}</span>
            . The status stays unchanged until a comment is added.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="status-change-comment">
            Comment <span className="text-rose-600">*</span>
          </Label>
          <Textarea
            id="status-change-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Why is this status changing?"
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
            disabled={pending || !comment.trim()}
            onClick={() => onConfirm(comment.trim())}
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Change status"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

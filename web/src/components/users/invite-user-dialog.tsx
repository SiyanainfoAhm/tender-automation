"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { FieldValidationHint } from "@/components/auth/validation-hints";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_META } from "@/lib/rbac/permissions";
import { getEmailValidationStatus } from "@/lib/validations/email-rules";
import type { InviteUserActionResult } from "@/lib/users/invite-results";
import { inviteCompanyUserAction } from "@/server/actions/team";

/** TF-23 approved invite roles: Admin + Manager only. */
const INVITE_ROLES = ["ADMIN", "BID_MANAGER"] as const;

export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>("BID_MANAGER");
  const [state, formAction, pending] = useActionState(
    inviteCompanyUserAction,
    {} as InviteUserActionResult,
  );
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      if (state?.ok && state.inviteSent) {
        toast.success("User created and invitation sent.");
        setOpen(false);
        setEmail("");
        setRole("BID_MANAGER");
        setEmailTouched(false);
      } else if (state?.ok && state.inviteSent === false) {
        toast.error(
          state.warning ||
            "User created, but invitation email failed.",
        );
        setOpen(false);
        setEmail("");
        setRole("BID_MANAGER");
        setEmailTouched(false);
      }
    }
    wasPending.current = pending;
  }, [pending, state]);

  const emailStatus = getEmailValidationStatus(email);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5 rounded-md">
          <UserPlus className="size-3.5" />
          Invite User
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>
            Invite a teammate to your company workspace. A temporary password is
            generated automatically and sent by email; they must change it on
            first login.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email address *</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              required
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              className="h-9 rounded-md"
            />
            <FieldValidationHint
              show={emailTouched && emailStatus !== null}
              valid={emailStatus?.valid ?? false}
              validMessage={emailStatus?.message ?? "Valid email format"}
              invalidMessage={
                emailStatus?.message ?? "Enter a valid email address"
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-name">Full name</Label>
            <Input
              id="invite-name"
              name="fullName"
              disabled={pending}
              className="h-9 rounded-md"
              placeholder="Optional"
            />
          </div>
          <div className="space-y-2">
            <Label>Role *</Label>
            <input type="hidden" name="role" value={role} />
            <Select
              value={role}
              onValueChange={(value) =>
                setRole(value as (typeof INVITE_ROLES)[number])
              }
              disabled={pending}
            >
              <SelectTrigger className="h-9 rounded-md">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {INVITE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_META.find((m) => m.key === r)?.name || r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {state?.error ? (
            <p className="text-sm text-red-600">{state.error}</p>
          ) : null}
          <Button
            type="submit"
            disabled={pending || emailStatus?.valid === false}
            className="w-full"
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Inviting…
              </>
            ) : (
              "Send invite"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

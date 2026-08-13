"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";

import {
  FieldValidationHint,
  PasswordRuleList,
} from "@/components/auth/validation-hints";
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
import { USER_ROLES } from "@/lib/validations";
import { getEmailValidationStatus } from "@/lib/validations/email-rules";
import { getPasswordRuleStatuses } from "@/lib/validations/password-rules";
import { inviteCompanyUserAction } from "@/server/actions/team";

export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [role, setRole] = useState("BID_COORDINATOR");
  const [state, formAction, pending] = useActionState(
    inviteCompanyUserAction,
    {},
  );

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setEmail("");
      setPassword("");
      setRole("BID_COORDINATOR");
    }
  }, [state?.ok]);

  const emailStatus = getEmailValidationStatus(email);
  const passwordRules = getPasswordRuleStatuses(password);

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
            Invite a teammate to your company workspace. They must change the
            temporary password on first login.
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
            <Select value={role} onValueChange={setRole} disabled={pending}>
              <SelectTrigger className="h-9 rounded-md">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_META.find((m) => m.key === r)?.name || r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-password">Temporary password *</Label>
            <Input
              id="invite-password"
              name="temporaryPassword"
              type="password"
              required
              disabled={pending}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setPasswordTouched(true)}
              className="h-9 rounded-md"
            />
            <PasswordRuleList
              rules={passwordRules}
              show={passwordTouched && password.length > 0}
            />
          </div>
          {state?.error ? (
            <p className="text-sm text-red-600">{state.error}</p>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full">
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

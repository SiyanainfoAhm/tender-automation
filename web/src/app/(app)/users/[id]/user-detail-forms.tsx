"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  resetPasswordAction,
  updateUserAction,
} from "@/server/actions/auth";
import {
  FieldValidationHint,
  PasswordRuleList,
} from "@/components/auth/validation-hints";
import { USER_ROLES } from "@/lib/validations";
import { getEmailValidationStatus } from "@/lib/validations/email-rules";
import { getPasswordRuleStatuses } from "@/lib/validations/password-rules";
import type { SafeUser } from "@/server/repositories/userRepository";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type UserDetailFormsProps = {
  user: SafeUser;
  section?: "profile" | "security" | "all";
};

export function UserDetailForms({
  user,
  section = "all",
}: UserDetailFormsProps) {
  const [email, setEmail] = useState(user.email);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [updateState, updateFormAction, updatePending] = useActionState(
    async (_prev: unknown, formData: FormData) =>
      updateUserAction(user.id, formData),
    {},
  );
  const [resetState, resetFormAction, resetPending] = useActionState(
    async (_prev: unknown, formData: FormData) => resetPasswordAction(formData),
    {},
  );

  const emailStatus = getEmailValidationStatus(email);
  const passwordRules = getPasswordRuleStatuses(temporaryPassword);

  const showProfile = section === "all" || section === "profile";
  const showSecurity = section === "all" || section === "security";

  return (
    <div
      className={
        section === "all" ? "grid gap-6 lg:grid-cols-2" : "max-w-xl space-y-6"
      }
    >
      {showProfile ? (
      <form
        action={updateFormAction}
        className="space-y-4 rounded-[14px] border border-border bg-surface p-6 shadow-sm"
      >
        <h3 className="font-heading text-base font-semibold">Update user</h3>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            disabled={updatePending}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => setEmailTouched(true)}
          />
          <FieldValidationHint
            show={emailTouched && emailStatus !== null}
            valid={emailStatus?.valid ?? false}
            validMessage={emailStatus?.message ?? "Valid email format"}
            invalidMessage={emailStatus?.message ?? "Enter a valid email address"}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            name="fullName"
            defaultValue={user.fullName}
            disabled={updatePending}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            name="role"
            defaultValue={user.role}
            disabled={updatePending}
            className="flex h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-sm"
          >
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {role.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <input type="hidden" name="isActive" value={String(user.isActive)} />
        {updateState?.error ? (
          <p className="text-sm text-red-600">{updateState.error}</p>
        ) : null}
        {updateState?.ok ? (
          <p className="text-sm text-emerald-600">User updated.</p>
        ) : null}
        <Button type="submit" disabled={updatePending}>
          {updatePending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Save changes"
          )}
        </Button>
      </form>
      ) : null}

      {showSecurity ? (
      <form
        action={resetFormAction}
        className="space-y-4 rounded-[14px] border border-border bg-surface p-6 shadow-sm"
      >
        <h3 className="font-heading text-base font-semibold">Reset password</h3>
        <input type="hidden" name="userId" value={user.id} />
        <div className="space-y-2">
          <Label htmlFor="temporaryPassword">Temporary password</Label>
          <Input
            id="temporaryPassword"
            name="temporaryPassword"
            type="password"
            required
            disabled={resetPending}
            value={temporaryPassword}
            onChange={(event) => setTemporaryPassword(event.target.value)}
            onBlur={() => setPasswordTouched(true)}
          />
          <PasswordRuleList
            rules={passwordRules}
            show={passwordTouched && temporaryPassword.length > 0}
          />
        </div>
        <p className="text-xs text-text-muted">
          User will be required to change password on next login.
        </p>
        {resetState?.error ? (
          <p className="text-sm text-red-600">{resetState.error}</p>
        ) : null}
        {resetState?.ok ? (
          <p className="text-sm text-emerald-600">Password reset.</p>
        ) : null}
        <Button type="submit" variant="destructive" disabled={resetPending}>
          {resetPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Reset password"
          )}
        </Button>
      </form>
      ) : null}
    </div>
  );
}

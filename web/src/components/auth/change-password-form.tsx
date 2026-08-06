"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { changePasswordAction } from "@/server/actions/auth";
import {
  FieldValidationHint,
  PasswordRuleList,
} from "@/components/auth/validation-hints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPasswordRuleStatuses } from "@/lib/validations/password-rules";

type ChangePasswordFormProps = {
  forced?: boolean;
};

export function ChangePasswordForm({ forced = false }: ChangePasswordFormProps) {
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordTouched, setNewPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => changePasswordAction(formData),
    {},
  );

  const passwordRules = getPasswordRuleStatuses(newPassword);
  const passwordsMatch =
    confirmPassword.length > 0 && newPassword === confirmPassword;

  return (
    <form action={formAction} className="max-w-md space-y-4">
      {forced ? (
        <p className="text-sm text-text-secondary">
          For security, you must set a new password before accessing the
          workspace.
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Current password</Label>
        <div className="relative">
          <Input
            id="currentPassword"
            name="currentPassword"
            type={showCurrent ? "text" : "password"}
            required
            disabled={pending}
            autoComplete="current-password"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
            onClick={() => setShowCurrent((v) => !v)}
            aria-label={showCurrent ? "Hide password" : "Show password"}
          >
            {showCurrent ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="newPassword">New password</Label>
        <div className="relative">
          <Input
            id="newPassword"
            name="newPassword"
            type={showNew ? "text" : "password"}
            required
            disabled={pending}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            onBlur={() => setNewPasswordTouched(true)}
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
            onClick={() => setShowNew((v) => !v)}
            aria-label={showNew ? "Hide password" : "Show password"}
          >
            {showNew ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </button>
        </div>
        <PasswordRuleList
          rules={passwordRules}
          show={newPasswordTouched && newPassword.length > 0}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <div className="relative">
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type={showConfirm ? "text" : "password"}
            required
            disabled={pending}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            onBlur={() => setConfirmTouched(true)}
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? "Hide password" : "Show password"}
          >
            {showConfirm ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </button>
        </div>
        <FieldValidationHint
          show={confirmTouched && confirmPassword.length > 0}
          valid={passwordsMatch}
          validMessage="Passwords match"
          invalidMessage="Passwords do not match"
        />
      </div>
      {state?.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="text-sm text-emerald-600">Password updated successfully.</p>
      ) : null}
      <Button type="submit" disabled={pending} className="min-h-11">
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Updating…
          </>
        ) : (
          forced ? "Set new password" : "Change password"
        )}
      </Button>
    </form>
  );
}

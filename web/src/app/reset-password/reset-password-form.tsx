"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { completePasswordResetAction } from "@/server/actions/auth";
import {
  FieldValidationHint,
  PasswordRuleList,
} from "@/components/auth/validation-hints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPasswordRuleStatuses } from "@/lib/validations/password-rules";

export function ResetPasswordForm({ token }: { token: string }) {
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordTouched, setNewPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [state, formAction, pending] = useActionState(
    completePasswordResetAction,
    {},
  );

  const passwordRules = getPasswordRuleStatuses(newPassword);
  const passwordsMatch =
    confirmPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit =
    Boolean(token) &&
    passwordRules.every((rule) => rule.met) &&
    passwordsMatch;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

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
          show={newPasswordTouched || newPassword.length > 0}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
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
            {showConfirm ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
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
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
        >
          {state.error}
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending || !canSubmit}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Updating password…
          </>
        ) : (
          "Set new password"
        )}
      </Button>

      <p className="text-center text-sm text-text-muted">
        <Link
          href="/login"
          className="font-medium text-primary hover:text-primary-hover"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowLeft, Loader2, Mail } from "lucide-react";

import { requestPasswordResetAction } from "@/server/actions/auth";
import { FieldValidationHint } from "@/components/auth/validation-hints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getEmailValidationStatus } from "@/lib/validations/email-rules";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    {},
  );
  const emailStatus = getEmailValidationStatus(email);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email address</Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            required
            disabled={pending}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => setEmailTouched(true)}
            className="pl-9"
          />
        </div>
        <FieldValidationHint
          show={emailTouched && emailStatus !== null}
          valid={emailStatus?.valid ?? false}
          validMessage={emailStatus?.message ?? "Valid email format"}
          invalidMessage={emailStatus?.message ?? "Enter a valid email address"}
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

      {state?.ok ? (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800"
        >
          {state.message}
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Sending link…
          </>
        ) : (
          "Send reset link"
        )}
      </Button>

      <p className="text-center text-sm text-text-muted">
        <Link
          href="/login"
          className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
        >
          <ArrowLeft className="size-3.5" />
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

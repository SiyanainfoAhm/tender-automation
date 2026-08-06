"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import { updateProfileAction } from "@/server/actions/auth";
import type { SafeAgentTenderUser } from "@/server/auth/safe-user";
import { FieldValidationHint } from "@/components/auth/validation-hints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getEmailValidationStatus } from "@/lib/validations/email-rules";

export function ProfileForm({ user }: { user: SafeAgentTenderUser }) {
  const [email, setEmail] = useState(user.email);
  const [emailTouched, setEmailTouched] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => updateProfileAction(formData),
    {},
  );

  const emailStatus = getEmailValidationStatus(email);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          defaultValue={user.fullName}
          required
          disabled={pending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          disabled={pending}
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
        <Label htmlFor="profileCurrentPassword">
          Current password (required when changing email)
        </Label>
        <Input
          id="profileCurrentPassword"
          name="currentPassword"
          type="password"
          disabled={pending}
          autoComplete="current-password"
        />
      </div>
      {state?.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="text-sm text-emerald-600" role="status">
          Profile updated successfully.
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : "Save profile"}
      </Button>
    </form>
  );
}

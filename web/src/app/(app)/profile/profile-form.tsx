"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { updateProfileAction } from "@/server/actions/auth";
import type { SafeAgentTenderUser } from "@/server/auth/safe-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProfileForm({ user }: { user: SafeAgentTenderUser }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => updateProfileAction(formData),
    {},
  );

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
          type="email"
          value={user.email}
          disabled
          readOnly
          className="bg-background-50"
        />
        <p className="text-xs text-text-muted">
          Email cannot be changed from profile. Contact an administrator if you
          need a different address.
        </p>
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

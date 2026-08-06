"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { createUserAction } from "@/server/actions/auth";
import {
  FieldValidationHint,
  PasswordRuleList,
} from "@/components/auth/validation-hints";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { USER_ROLES } from "@/lib/validations";
import { getEmailValidationStatus } from "@/lib/validations/email-rules";
import { getPasswordRuleStatuses } from "@/lib/validations/password-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CreateUserFormProps = {
  onSuccess?: () => void;
};

export function CreateUserForm({ onSuccess }: CreateUserFormProps = {}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [role, setRole] = useState("VIEWER");
  const [state, formAction, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => createUserAction(formData),
    {},
  );

  useEffect(() => {
    if (state?.ok) onSuccess?.();
  }, [state?.ok, onSuccess]);

  const emailStatus = getEmailValidationStatus(email);
  const passwordRules = getPasswordRuleStatuses(password);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" required disabled={pending} />
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
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="password">Temporary password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            disabled={pending}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setPasswordTouched(true)}
          />
          <PasswordRuleList
            rules={passwordRules}
            show={passwordTouched && password.length > 0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <input type="hidden" name="role" value={role} />
          <Select value={role} onValueChange={setRole} disabled={pending}>
            <SelectTrigger id="role" className="h-11">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              {USER_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {state?.error ? (
        <p className="text-sm text-red-600">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="text-sm text-emerald-600">User created successfully.</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating…
          </>
        ) : (
          "Create user"
        )}
      </Button>
    </form>
  );
}

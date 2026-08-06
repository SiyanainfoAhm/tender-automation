"use client";

import { useActionState, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { loginAction } from "@/server/actions/auth";
import { FieldValidationHint } from "@/components/auth/validation-hints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getEmailValidationStatus } from "@/lib/validations/email-rules";

const REMEMBER_EMAIL_KEY = "agenttender_remember_email";
const REMEMBER_FLAG_KEY = "agenttender_remember_login";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, {});
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [rememberLogin, setRememberLogin] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const emailStatus = getEmailValidationStatus(email);

  useEffect(() => {
    const hidePassword = () => setShowPassword(false);
    hidePassword();
    window.addEventListener("pageshow", hidePassword);
    return () => window.removeEventListener("pageshow", hidePassword);
  }, []);

  useEffect(() => {
    try {
      const savedFlag = localStorage.getItem(REMEMBER_FLAG_KEY) === "true";
      const savedEmail = localStorage.getItem(REMEMBER_EMAIL_KEY) || "";
      setRememberLogin(savedFlag);
      if (savedFlag && savedEmail) {
        setEmail(savedEmail);
      }
    } catch {
      // Ignore storage access errors (private mode, etc.)
    }
    setHydrated(true);
  }, []);

  function handleSubmit(formData: FormData) {
    const nextEmail = String(formData.get("email") || "")
      .trim()
      .toLowerCase();

    try {
      if (rememberLogin && nextEmail) {
        localStorage.setItem(REMEMBER_FLAG_KEY, "true");
        localStorage.setItem(REMEMBER_EMAIL_KEY, nextEmail);
      } else {
        localStorage.removeItem(REMEMBER_FLAG_KEY);
        localStorage.removeItem(REMEMBER_EMAIL_KEY);
      }
    } catch {
      // Ignore storage access errors
    }

    setShowPassword(false);
    return formAction(formData);
  }

  return (
    <form action={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@company.com"
          required
          disabled={pending || !hydrated}
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
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            required
            disabled={pending}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text-secondary"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            tabIndex={-1}
          >
            {showPassword ? (
              <Eye className="size-4" aria-hidden />
            ) : (
              <EyeOff className="size-4" aria-hidden />
            )}
          </button>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text-secondary">
        <input
          type="checkbox"
          name="rememberLogin"
          checked={rememberLogin}
          onChange={(event) => setRememberLogin(event.target.checked)}
          disabled={pending}
          className="size-4 rounded border-border accent-primary"
        />
        Save login info for future
      </label>

      {state?.error ? (
        <div
          role="alert"
          className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Building2,
  Globe,
  MapPin,
  Phone,
} from "lucide-react";

import { signupAction } from "@/server/actions/auth";
import { SignupStepIndicator } from "@/components/auth/signup-step-indicator";
import { FieldValidationHint } from "@/components/auth/validation-hints";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getEmailValidationStatus } from "@/lib/validations/email-rules";
import {
  getPasswordRuleStatuses,
  isPasswordPolicyMet,
} from "@/lib/validations/password-rules";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, {});
  const [step, setStep] = useState<1 | 2>(1);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [companyType, setCompanyType] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");

  const emailStatus = getEmailValidationStatus(email);
  const passwordRules = useMemo(
    () => getPasswordRuleStatuses(password),
    [password],
  );
  const passwordsMatch =
    confirmPassword.length === 0 || password === confirmPassword;

  function canContinueStep1(): boolean {
    return (
      fullName.trim().length > 0 &&
      emailStatus?.valid === true &&
      isPasswordPolicyMet(password) &&
      password === confirmPassword
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <SignupStepIndicator step={step} />

      {step === 1 ? (
        <>
          <div className="space-y-1 pb-1">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Create your account
            </h2>
            <p className="text-sm text-text-muted">
              Get started with AI-powered tender management
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              name="fullName"
              autoComplete="name"
              placeholder="Jane Doe"
              required
              disabled={pending}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
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

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Create a strong password"
                required
                disabled={pending}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text-secondary"
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? (
                  <Eye className="size-4" />
                ) : (
                  <EyeOff className="size-4" />
                )}
              </button>
            </div>
            <ul className="grid gap-1 pt-1 text-[11px] text-text-muted sm:grid-cols-2">
              {passwordRules.map((rule) => (
                <li
                  key={rule.id}
                  className={rule.met ? "text-primary-700" : undefined}
                >
                  {rule.met ? "✓" : "○"} {rule.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter password"
                required
                disabled={pending}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text-secondary"
                aria-label={showConfirm ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showConfirm ? (
                  <Eye className="size-4" />
                ) : (
                  <EyeOff className="size-4" />
                )}
              </button>
            </div>
            {!passwordsMatch ? (
              <p className="text-xs text-red-600">Passwords do not match</p>
            ) : null}
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={!canContinueStep1() || pending}
            onClick={() => setStep(2)}
          >
            Continue
            <ArrowRight className="size-4" />
          </Button>
        </>
      ) : (
        <>
          <div className="space-y-1 pb-1">
            <h2 className="font-heading text-base font-semibold text-text-primary">
              Company details
            </h2>
            <p className="text-sm text-text-muted">
              Tell us about your organization
            </p>
          </div>

          {/* Hidden account fields so final submit includes step 1 values */}
          <input type="hidden" name="fullName" value={fullName} />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="password" value={password} />
          <input type="hidden" name="confirmPassword" value={confirmPassword} />

          <div className="space-y-1.5">
            <Label htmlFor="companyName">Company name</Label>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
              <Input
                id="companyName"
                name="companyName"
                required
                disabled={pending}
                placeholder="Acme Infrastructure Pvt Ltd"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                name="industry"
                disabled={pending}
                placeholder="IT / Construction"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="companyType">Company type</Label>
              <Input
                id="companyType"
                name="companyType"
                disabled={pending}
                placeholder="Private Limited"
                value={companyType}
                onChange={(e) => setCompanyType(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
              <Input
                id="phone"
                name="phone"
                disabled={pending}
                placeholder="+91…"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
              <Input
                id="website"
                name="website"
                disabled={pending}
                placeholder="https://"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
              <Input
                id="location"
                name="location"
                disabled={pending}
                placeholder="City, State"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <p className="rounded-md border border-border bg-surface-secondary px-3 py-2 text-[11px] leading-relaxed text-text-muted">
          Company details create a <strong>new company</strong> for your
          account. Existing Siyana users stay on the Siyana company — new
          signups are never auto-assigned to Siyana.
          </p>

          {state?.error ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
            >
              {state.error}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              disabled={pending}
              onClick={() => setStep(1)}
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={pending || !companyName.trim()}
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Account"
              )}
            </Button>
          </div>
        </>
      )}

      <p className="text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-primary hover:text-primary-hover"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}

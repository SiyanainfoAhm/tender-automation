import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ResetPasswordForm } from "./reset-password-form";

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = String(params.token || "").trim();

  return (
    <AuthPageShell>
      <AuthCard
        title="Reset password"
        description="Choose a new password for your TenderFlow account"
      >
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="space-y-4 text-sm text-text-secondary">
            <p role="alert">
              This reset link is missing or invalid. Request a new link from the
              forgot-password page.
            </p>
            <Link
              href="/forgot-password"
              className="font-medium text-primary hover:text-primary-hover"
            >
              Request a new reset link
            </Link>
          </div>
        )}
      </AuthCard>
    </AuthPageShell>
  );
}

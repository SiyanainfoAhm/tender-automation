import { AuthCard } from "@/components/auth/auth-card";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell>
      <AuthCard
        title="Forgot password"
        description="Enter your account email and we will send a reset link"
      >
        <ForgotPasswordForm />
      </AuthCard>
    </AuthPageShell>
  );
}

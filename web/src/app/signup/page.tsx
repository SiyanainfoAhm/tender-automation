import { AuthCard } from "@/components/auth/auth-card";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <AuthPageShell>
      <AuthCard className="max-w-[440px]">
        <SignupForm />
      </AuthCard>
    </AuthPageShell>
  );
}

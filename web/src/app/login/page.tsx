import { AuthCard } from "@/components/auth/auth-card";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthPageShell>
      <AuthCard
        title="Welcome back"
        description="Sign in to your account to continue"
      >
        <LoginForm />
      </AuthCard>
    </AuthPageShell>
  );
}

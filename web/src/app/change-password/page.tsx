import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { logoutAction } from "@/server/actions/auth";
import { getSession } from "@/server/auth/session";
import { Button } from "@/components/ui/button";

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.user.mustChangePassword) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <p className="font-heading text-lg font-semibold text-text-primary">
            Siyana Tender Intelligence
          </p>
          <p className="text-sm text-text-muted">Password change required</p>
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-[14px] border border-border bg-surface p-8 shadow-sm">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Change your password
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Signed in as {session.user.email}
          </p>
          <div className="mt-6">
            <ChangePasswordForm forced />
          </div>
          <p className="mt-6 text-xs text-text-muted">
            Need help? Contact your workspace administrator.
          </p>
        </div>
      </main>
    </div>
  );
}

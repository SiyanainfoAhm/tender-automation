import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { getSession } from "@/server/auth/session";
import { getUserPreferences } from "@/server/repositories/savedViewRepository";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }

  const preferences = await getUserPreferences(session.user.id);

  return (
    <AppShell
      user={session.user}
      preferences={{
        theme: preferences.theme,
        sidebarCollapsed: preferences.sidebarCollapsed,
      }}
    >
      {children}
    </AppShell>
  );
}

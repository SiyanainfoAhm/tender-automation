import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { getSession } from "@/server/auth/session";
import { getUserPreferences } from "@/server/repositories/savedViewRepository";
import { countVisibleTenders } from "@/server/repositories/tenderRepository";

const DEFAULT_PREFERENCES = {
  theme: "light",
  sidebarCollapsed: false,
};

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

  const [preferences, tenderCount] = await Promise.all([
    getUserPreferences(session.user.id).catch((error) => {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "user_preferences_load_failed",
          userId: session.user.id,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return {
        theme: DEFAULT_PREFERENCES.theme,
        tableDensity: "comfortable",
        sidebarCollapsed: DEFAULT_PREFERENCES.sidebarCollapsed,
        defaultDateFilter: null,
        preferences: {},
      };
    }),
    countVisibleTenders().catch(() => null),
  ]);

  return (
    <AppShell
      user={session.user}
      preferences={{
        theme: preferences.theme,
        sidebarCollapsed: preferences.sidebarCollapsed,
      }}
      tenderCount={tenderCount}
    >
      {children}
    </AppShell>
  );
}

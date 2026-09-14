import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { getSession } from "@/server/auth/session";
import { getUserPreferences } from "@/server/repositories/savedViewRepository";
import { countVisibleTenders } from "@/server/repositories/tenderRepository";
import { countWonProjects } from "@/server/repositories/wonProjectRepository";

/** Nav badges (tender / won counts) must not be served from a stale RSC cache. */
export const dynamic = "force-dynamic";

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

  const companyId = session.user.companyId;

  const [preferences, tenderCount, wonTenderCount] = await Promise.all([
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
    companyId
      ? countWonProjects(companyId).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <AppShell
      user={session.user}
      preferences={{
        theme: preferences.theme,
        sidebarCollapsed: preferences.sidebarCollapsed,
      }}
      tenderCount={tenderCount}
      wonTenderCount={wonTenderCount}
    >
      {children}
    </AppShell>
  );
}

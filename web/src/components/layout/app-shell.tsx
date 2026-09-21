"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AppSidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PageContainer } from "@/components/layout/page-container";
import { CommandPalette } from "@/components/command/command-palette";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LogoutForm } from "@/components/auth/logout-form";
import type { SessionUser } from "@/server/auth/session";

type AppShellProps = {
  user: SessionUser;
  preferences: {
    theme: string;
    sidebarCollapsed: boolean;
  };
  companies?: Array<{
    id: string;
    name: string;
    role: string;
    active: boolean;
  }>;
  activeCompanyName?: string | null;
  tenderCount?: number | null;
  indianTenderCount?: number | null;
  globalTenderCount?: number | null;
  submittedTenderCount?: number | null;
  wonTenderCount?: number | null;
  children: React.ReactNode;
};

export function AppShell({
  user,
  preferences,
  companies = [],
  activeCompanyName = null,
  tenderCount = null,
  indianTenderCount = null,
  globalTenderCount = null,
  submittedTenderCount = null,
  wonTenderCount = null,
  children,
}: AppShellProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(preferences.sidebarCollapsed);
  const [searchValue, setSearchValue] = React.useState("");
  const [commandOpen, setCommandOpen] = React.useState(false);

  // Light mode only — never apply .dark
  React.useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  // Live header search → tenders list (debounced, min 3 chars).
  // Skip while ⌘K palette is open so focus/typing there does not fight navigation.
  React.useEffect(() => {
    if (commandOpen) return;
    const q = searchValue.trim();
    if (q.length > 0 && q.length < 3) return;
    const handle = window.setTimeout(() => {
      if (!q) return;
      if (q.length < 3) return;
      router.push(`/tenders/indian?q=${encodeURIComponent(q)}`);
    }, 450);
    return () => window.clearTimeout(handle);
  }, [searchValue, router, commandOpen]);

  const sidebarUser = {
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen overflow-hidden bg-background">
        <div className="hidden lg:flex">
          <AppSidebar
            user={sidebarUser}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            tenderCount={tenderCount}
            indianTenderCount={indianTenderCount}
            globalTenderCount={globalTenderCount}
            submittedTenderCount={submittedTenderCount}
            wonTenderCount={wonTenderCount}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-16 items-center gap-2 border-b border-border bg-white px-4 sm:px-5 lg:hidden">
            <MobileNav
              userRole={user.role}
              tenderCount={tenderCount}
              indianTenderCount={indianTenderCount}
              globalTenderCount={globalTenderCount}
              submittedTenderCount={submittedTenderCount}
              wonTenderCount={wonTenderCount}
            />
            <span className="font-heading text-sm font-semibold text-text-primary">
              TenderFlow
            </span>
          </div>

          <Topbar
            user={{
              fullName: user.fullName,
              email: user.email,
              role: user.role,
            }}
            companies={companies}
            activeCompanyName={activeCompanyName}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSearchSubmit={(q) => {
              const next = q.trim();
              if (!next) {
                router.push("/tenders/indian");
                return;
              }
              if (next.length < 3) return;
              router.push(`/tenders/indian?q=${encodeURIComponent(next)}`);
            }}
            onOpenCommandPalette={() => setCommandOpen(true)}
          />

          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <PageContainer>{children}</PageContainer>
          </main>
        </div>

        <CommandPalette
          userRole={user.role}
          open={commandOpen}
          onOpenChange={setCommandOpen}
          initialQuery={searchValue}
        />

        <LogoutForm />

        <Link href="/profile" className="sr-only" prefetch={false}>
          Profile
        </Link>
      </div>
    </TooltipProvider>
  );
}

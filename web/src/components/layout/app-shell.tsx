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
import { logoutAction } from "@/server/actions/auth";
import type { SessionUser } from "@/server/auth/session";

type AppShellProps = {
  user: SessionUser;
  preferences: {
    theme: string;
    sidebarCollapsed: boolean;
  };
  tenderCount?: number | null;
  children: React.ReactNode;
};

export function AppShell({
  user,
  preferences,
  tenderCount = null,
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

  // Live header search → tenders list (debounced). Skip while ⌘K palette is open
  // so focus/typing there does not fight navigation.
  React.useEffect(() => {
    if (commandOpen) return;
    const q = searchValue.trim();
    const handle = window.setTimeout(() => {
      if (!q) return;
      router.push(`/tenders?q=${encodeURIComponent(q)}`);
    }, 200);
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
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-16 items-center gap-2 border-b border-border bg-white px-4 sm:px-5 lg:hidden">
            <MobileNav userRole={user.role} tenderCount={tenderCount} />
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
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSearchSubmit={(q) => {
              const next = q.trim();
              if (!next) {
                router.push("/tenders");
                return;
              }
              router.push(`/tenders?q=${encodeURIComponent(next)}`);
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

        <form
          id="logout-form"
          action={logoutAction}
          className="hidden"
          aria-hidden
        />

        <Link href="/profile" className="sr-only" prefetch={false}>
          Profile
        </Link>
      </div>
    </TooltipProvider>
  );
}

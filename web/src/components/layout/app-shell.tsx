"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AppSidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PageContainer } from "@/components/layout/page-container";
import { CommandPalette } from "@/components/command/command-palette";
import { logoutAction } from "@/server/actions/auth";
import type { SessionUser } from "@/server/auth/session";

type AppShellProps = {
  user: SessionUser;
  preferences: {
    theme: string;
    sidebarCollapsed: boolean;
  };
  children: React.ReactNode;
};

export function AppShell({ user, preferences, children }: AppShellProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(preferences.sidebarCollapsed);
  const [searchValue, setSearchValue] = React.useState("");
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    const root = document.documentElement;
    const theme = preferences.theme;
    const applyDark = (dark: boolean) => {
      if (dark) root.classList.add("dark");
      else root.classList.remove("dark");
      setIsDark(dark);
    };

    if (theme === "dark") applyDark(true);
    else if (theme === "light") applyDark(false);
    else applyDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, [preferences.theme]);

  const toggleTheme = () => {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    if (next) root.classList.add("dark");
    else root.classList.remove("dark");
    setIsDark(next);
  };

  const sidebarUser = {
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden lg:flex">
        <AppSidebar
          user={sidebarUser}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-16 items-center gap-2 border-b border-border bg-surface px-4 lg:hidden">
          <MobileNav userRole={user.role} />
          <span className="font-heading text-sm font-bold text-text-primary">
            Siyana STI
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
            router.push(`/tenders?q=${encodeURIComponent(q)}`);
          }}
          onThemeToggle={toggleTheme}
          isDark={isDark}
        />

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <PageContainer className="gutter py-6">{children}</PageContainer>
        </main>
      </div>

      <CommandPalette userRole={user.role} />

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
  );
}

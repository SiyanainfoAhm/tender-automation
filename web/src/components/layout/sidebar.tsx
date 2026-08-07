"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bookmark,
  ChevronLeft,
  FileText,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/validations";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type SidebarUser = {
  fullName: string;
  email: string;
  role: UserRole;
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tenders", label: "Tenders", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/saved-views", label: "Saved Views", icon: Bookmark },
  { href: "/users", label: "Users", icon: Users, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

type AppSidebarProps = {
  user: SidebarUser;
  collapsed: boolean;
  onToggle: () => void;
};

export function AppSidebar({ user, collapsed, onToggle }: AppSidebarProps) {
  const pathname = usePathname();
  const visibleItems = navItems.filter(
    (item) => !item.adminOnly || user.role === "ADMIN",
  );

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex h-full flex-col border-r border-border bg-surface transition-[width] duration-200",
          collapsed ? "w-[58px]" : "w-[228px]",
        )}
      >
        <div
          className={cn(
            "flex h-[60px] items-center border-b border-border px-3",
            collapsed ? "justify-center" : "gap-2.5",
          )}
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-accent-indigo font-heading text-xs font-bold text-white">
            STI
          </div>
          {!collapsed ? (
            <div className="min-w-0">
              <p className="truncate font-heading text-sm font-semibold text-text-primary">
                Siyana Tender Intelligence
              </p>
              <p className="truncate text-xs text-text-muted">Workspace</p>
            </div>
          ) : null}
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            const link = (
              <Link
                href={item.href}
                className={cn(
                  "flex h-11 items-center gap-2.5 rounded-[10px] px-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary-muted text-primary"
                    : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary",
                  collapsed && "justify-center px-0",
                )}
              >
                <Icon className="size-[18px] shrink-0" />
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }

            return <div key={item.href}>{link}</div>;
          })}
        </nav>

        <div className="border-t border-border p-2">
          <div
            className={cn(
              "mb-2 flex items-center gap-2.5 rounded-[10px] bg-surface-secondary p-2",
              collapsed && "justify-center px-1.5",
            )}
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary-muted text-xs font-semibold text-primary">
                {getInitials(user.fullName)}
              </AvatarFallback>
            </Avatar>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">
                  {user.fullName}
                </p>
                <p className="truncate text-xs text-text-muted">{user.email}</p>
              </div>
            ) : null}
          </div>

          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            onClick={onToggle}
            className={cn(
              "h-10 w-full text-text-secondary",
              !collapsed && "justify-start",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronLeft
              className={cn(
                "size-4 transition-transform",
                collapsed && "rotate-180",
              )}
            />
            {!collapsed ? <span>Collapse</span> : null}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, Layers, LogOut } from "lucide-react";

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
import { APP_BOTTOM_NAV, APP_MAIN_NAV } from "@/components/layout/nav-items";
import { companyRoleLabel } from "@/lib/company/types";
import { roleHasPermission, type PermissionKey } from "@/lib/rbac/permissions";

export type SidebarUser = {
  fullName: string;
  email: string;
  role: UserRole;
};

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

function NavLink({
  href,
  label,
  icon: Icon,
  collapsed,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed: boolean;
  active: boolean;
}) {
  const link = (
    <Link
      href={href}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary-50 text-primary-700"
          : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

export function AppSidebar({ user, collapsed, onToggle }: AppSidebarProps) {
  const pathname = usePathname();
  const mainItems = APP_MAIN_NAV.filter((item) => {
    if (item.permission) {
      return roleHasPermission(user.role, item.permission as PermissionKey);
    }
    if (item.adminOnly) return user.role === "ADMIN";
    return true;
  });
  const bottomItems = APP_BOTTOM_NAV;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex h-full flex-col border-r border-border bg-white transition-[width] duration-200",
          collapsed ? "w-[58px]" : "w-[228px]",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b border-border px-3",
            collapsed ? "justify-center" : "gap-2.5",
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-white">
            <Layers className="size-4" aria-hidden />
          </div>
          {!collapsed ? (
            <div className="min-w-0">
              <p className="truncate font-heading text-sm font-semibold text-text-primary">
                TenderFlow
              </p>
              <p className="truncate text-[11px] text-text-muted">
                AI Bid Management
              </p>
            </div>
          ) : null}
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-2">
          <div className="space-y-0.5">
            {!collapsed ? (
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                Main Menu
              </p>
            ) : null}
            {mainItems.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  collapsed={collapsed}
                  active={active}
                />
              );
            })}
          </div>
        </nav>

        <div className="space-y-0.5 border-t border-border p-2">
          {bottomItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                collapsed={collapsed}
                active={active}
              />
            );
          })}

          <button
            type="button"
            className={cn(
              "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary",
              collapsed && "justify-center px-0",
            )}
            onClick={() => {
              const form = document.getElementById(
                "logout-form",
              ) as HTMLFormElement | null;
              form?.requestSubmit();
            }}
          >
            <LogOut className="size-[18px] shrink-0" />
            {!collapsed ? <span>Logout</span> : null}
          </button>

          <div
            className={cn(
              "mt-1 flex items-center gap-2.5 rounded-md bg-surface-secondary p-2",
              collapsed && "justify-center px-1.5",
            )}
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary-50 text-xs font-semibold text-primary-700">
                {getInitials(user.fullName)}
              </AvatarFallback>
            </Avatar>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">
                  {user.fullName}
                </p>
                <p className="truncate text-[11px] text-text-muted">
                  {companyRoleLabel(user.role)}
                </p>
              </div>
            ) : null}
          </div>

          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            onClick={onToggle}
            className={cn(
              "h-9 w-full text-text-secondary",
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

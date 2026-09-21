"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, LogOut, Menu } from "lucide-react";

import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  APP_BOTTOM_NAV,
  APP_MAIN_NAV,
  isTendersNavActive,
  type NavCountKey,
} from "@/components/layout/nav-items";
import { roleHasPermission, type PermissionKey } from "@/lib/rbac/permissions";
import { useTendersListReturnHref } from "@/lib/tenders/use-tenders-list-return-href";

type MobileNavProps = {
  userRole: UserRole;
  tenderCount?: number | null;
  indianTenderCount?: number | null;
  globalTenderCount?: number | null;
  submittedTenderCount?: number | null;
  wonTenderCount?: number | null;
};

function navItemCount(
  countKey: NavCountKey | undefined,
  counts: {
    tenders: number | null;
    indian: number | null;
    global: number | null;
    submitted: number | null;
    won: number | null;
  },
): number | null {
  if (countKey === "wonTenders") return counts.won;
  if (countKey === "submittedTenders") return counts.submitted;
  if (countKey === "indianTenders") return counts.indian;
  if (countKey === "globalTenders") return counts.global;
  return counts.tenders;
}

export function MobileNav({
  userRole,
  tenderCount = null,
  indianTenderCount = null,
  globalTenderCount = null,
  submittedTenderCount = null,
  wonTenderCount = null,
}: MobileNavProps) {
  const pathname = usePathname();
  const tendersHref = useTendersListReturnHref();
  const counts = {
    tenders: tenderCount,
    indian: indianTenderCount,
    global: globalTenderCount,
    submitted: submittedTenderCount,
    won: wonTenderCount,
  };
  const mainItems = APP_MAIN_NAV.filter((item) => {
    if (item.permission) {
      return roleHasPermission(userRole, item.permission as PermissionKey);
    }
    if (item.adminOnly) return userRole === "ADMIN";
    return true;
  });

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] p-0">
        <SheetHeader className="border-b border-border px-5 py-4 text-left">
          <SheetTitle className="flex items-center gap-2.5 font-heading text-base">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-white">
              <Layers className="size-4" aria-hidden />
            </span>
            <span>
              TenderFlow
              <span className="mt-0.5 block text-xs font-normal text-text-muted">
                AI Bid Management
              </span>
            </span>
          </SheetTitle>
        </SheetHeader>
        <nav className="space-y-1 p-3">
          {mainItems.map((item) => {
            const Icon = item.icon;
            if (item.children?.length) {
              const parentHref =
                item.href === "/tenders" ? tendersHref : item.href;
              const childMatch = item.children.some(
                (child) => pathname === child.href,
              );
              const parentActive =
                isTendersNavActive(pathname) && !childMatch;
              const parentCount = item.showCount
                ? navItemCount(item.countKey, counts)
                : null;
              return (
                <div key={item.href} className="space-y-0.5">
                  <Link
                    href={parentHref}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      parentActive
                        ? "bg-primary-50 text-primary-700"
                        : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {typeof parentCount === "number" ? (
                      <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                        {parentCount.toLocaleString("en-IN")}
                      </span>
                    ) : null}
                  </Link>
                  {item.children.map((child) => {
                    const ChildIcon = child.icon;
                    const childActive = pathname === child.href;
                    const childCount = child.showCount
                      ? navItemCount(child.countKey, counts)
                      : null;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md py-2 pl-9 pr-3 text-sm font-medium transition-colors",
                          childActive
                            ? "bg-primary-50 text-primary-700"
                            : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
                        )}
                      >
                        <ChildIcon className="size-[18px] shrink-0" />
                        <span className="truncate">{child.label}</span>
                        {typeof childCount === "number" ? (
                          <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                            {childCount.toLocaleString("en-IN")}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              );
            }

            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const count = item.showCount
              ? navItemCount(item.countKey, counts)
              : null;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary-50 text-primary-700"
                    : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
                )}
              >
                <Icon className="size-[18px] shrink-0" />
                <span className="truncate">{item.label}</span>
                {typeof count === "number" ? (
                  <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                    {count.toLocaleString("en-IN")}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {APP_BOTTOM_NAV.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary-50 text-primary-700"
                    : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
                )}
              >
                <Icon className="size-[18px] shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-muted hover:text-text-primary"
            onClick={() => {
              const form = document.getElementById(
                "logout-form",
              ) as HTMLFormElement | null;
              form?.requestSubmit();
            }}
          >
            <LogOut className="size-[18px] shrink-0" />
            Logout
          </button>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { useRouter } from "next/navigation";
import {
  Bell,
  CircleHelp,
  LogOut,
  Search,
  Settings,
  Shield,
  User,
} from "lucide-react";

import type { UserRole } from "@/lib/validations";
import { companyRoleLabel } from "@/lib/company/types";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

export type TopbarUser = {
  fullName: string;
  email: string;
  role?: string;
};

type TopbarProps = {
  user: TopbarUser;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: (value: string) => void;
  className?: string;
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Topbar({
  user,
  searchValue = "",
  onSearchChange,
  onSearchSubmit,
  className,
}: TopbarProps) {
  const router = useRouter();

  return (
    <header
      className={cn(
        "flex h-16 items-center gap-3 border-b border-border bg-white px-4 sm:px-5 lg:px-6",
        className,
      )}
    >
      <form
        className="relative hidden flex-1 md:block md:max-w-md lg:max-w-lg"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit?.(searchValue);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
        <Input
          type="search"
          placeholder="Search tenders, documents, users…"
          value={searchValue}
          onChange={(event) => onSearchChange?.(event.target.value)}
          className="h-9 pl-9 text-sm"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface-secondary px-1.5 py-0.5 text-[10px] text-text-muted lg:inline">
          ⌘K
        </kbd>
      </form>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-text-muted"
          aria-label="Help"
          type="button"
        >
          <CircleHelp className="size-[18px]" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-text-muted"
          aria-label="Notifications"
          type="button"
        >
          <Bell className="size-[18px]" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-9 gap-2 rounded-md px-1.5 hover:bg-surface-secondary"
            >
              <Avatar className="size-7">
                <AvatarFallback className="bg-primary-50 text-[11px] font-semibold text-primary-700">
                  {getInitials(user.fullName)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[140px] flex-col items-start lg:flex">
                <span className="max-w-[140px] truncate text-sm font-medium leading-tight text-text-primary">
                  {user.fullName}
                </span>
                {user.role ? (
                  <span className="text-[11px] leading-tight text-text-muted">
                    {companyRoleLabel(user.role as UserRole)}
                  </span>
                ) : null}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[260px]">
            <DropdownMenuLabel className="px-3 py-3 font-normal">
              <div className="flex items-start gap-3">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary-50 text-xs font-semibold text-primary-700">
                    {getInitials(user.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-semibold text-text-primary">
                    {user.fullName}
                  </p>
                  <p className="truncate text-xs text-text-muted">{user.email}</p>
                  {user.role ? (
                    <Badge variant="outline" className="text-[10px]">
                      {companyRoleLabel(user.role as UserRole)}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/profile")}>
              <User className="size-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Settings className="size-4" />
              Preferences
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/profile")}>
              <Shield className="size-4" />
              Security
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-status-nogo focus:text-status-nogo"
              onClick={() => {
                const form = document.getElementById(
                  "logout-form",
                ) as HTMLFormElement | null;
                form?.requestSubmit();
              }}
            >
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

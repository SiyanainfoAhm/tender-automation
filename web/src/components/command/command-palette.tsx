"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import {
  BarChart3,
  FileText,
  LayoutDashboard,
  Search,
  Settings,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/validations";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

type CommandAction = {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string[];
  adminOnly?: boolean;
};

const commandActions: CommandAction[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    keywords: ["home", "overview"],
  },
  {
    id: "tenders",
    label: "Tenders",
    href: "/tenders",
    icon: FileText,
    keywords: ["bids", "rfp", "procurement"],
  },
  {
    id: "analytics",
    label: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    keywords: ["reports", "insights"],
  },
  {
    id: "users",
    label: "Users",
    href: "/users",
    icon: Users,
    keywords: ["team", "admin"],
    adminOnly: true,
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    keywords: ["preferences", "config"],
  },
];

type CommandPaletteProps = {
  userRole: UserRole;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CommandPalette({
  userRole,
  open: controlledOpen,
  onOpenChange,
}: CommandPaletteProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);

  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const actions = commandActions.filter(
    (action) => !action.adminOnly || userRole === "ADMIN",
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(true);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  const runAction = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 shadow-2xl sm:max-w-[560px]">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <CommandPrimitive
          className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-white dark:bg-slate-900"
          loop
        >
          <div className="flex items-center border-b border-slate-200 px-3 dark:border-slate-700">
            <Search className="mr-2 size-4 shrink-0 text-slate-400" />
            <CommandPrimitive.Input
              placeholder="Search pages and actions…"
              className={cn(
                "flex h-12 w-full bg-transparent py-3 text-sm text-slate-900 outline-none dark:text-slate-100",
                "placeholder:text-slate-400 dark:placeholder:text-slate-500",
              )}
            />
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded-[6px] border border-slate-200 bg-slate-50 px-1.5 font-mono text-[10px] font-medium text-slate-500 sm:flex dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              ESC
            </kbd>
          </div>
          <CommandPrimitive.List className="max-h-[320px] overflow-y-auto p-2">
            <CommandPrimitive.Empty className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No results found.
            </CommandPrimitive.Empty>
            <CommandPrimitive.Group heading="Navigation">
              {actions.map((action) => {
                const Icon = action.icon;
                return (
                  <CommandPrimitive.Item
                    key={action.id}
                    value={[action.label, ...(action.keywords ?? [])].join(" ")}
                    onSelect={() => runAction(action.href)}
                    className={cn(
                      "relative flex cursor-default select-none items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm outline-none",
                      "text-slate-600 aria-selected:bg-slate-100 aria-selected:text-slate-900",
                      "dark:text-slate-300 dark:aria-selected:bg-slate-800 dark:aria-selected:text-slate-50",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-slate-500 dark:text-slate-400" />
                    <span>{action.label}</span>
                  </CommandPrimitive.Item>
                );
              })}
            </CommandPrimitive.Group>
          </CommandPrimitive.List>
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
            <span>Navigate with ↑ ↓</span>
            <span>
              <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono dark:border-slate-700 dark:bg-slate-900">
                ⌘K
              </kbd>{" "}
              to open
            </span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);
  return { open, setOpen };
}

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
  DialogDescription,
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
    id: "templates",
    label: "Bid Profile Templates",
    href: "/templates",
    icon: FileText,
    keywords: ["templates", "bid profile", "prepare"],
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
  initialQuery?: string;
};

export function CommandPalette({
  userRole,
  open: controlledOpen,
  onOpenChange,
  initialQuery = "",
}: CommandPaletteProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [query, setQuery] = React.useState(initialQuery);

  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const actions = commandActions.filter(
    (action) => !action.adminOnly || userRole === "ADMIN",
  );

  React.useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

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

  const runTenderSearch = () => {
    const q = query.trim();
    setOpen(false);
    if (!q) {
      router.push("/tenders");
      return;
    }
    router.push(`/tenders?q=${encodeURIComponent(q)}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 shadow-2xl sm:max-w-[560px]">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search tenders and navigate the app
        </DialogDescription>
        <CommandPrimitive
          className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-white dark:bg-slate-900"
          loop
          shouldFilter
        >
          <div className="flex items-center border-b border-slate-200 px-3 dark:border-slate-700">
            <Search className="mr-2 size-4 shrink-0 text-slate-400" />
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search tenders or jump to a page…"
              className={cn(
                "flex h-12 w-full bg-transparent py-3 text-sm text-slate-900 outline-none dark:text-slate-100",
                "placeholder:text-slate-400 dark:placeholder:text-slate-500",
              )}
              onKeyDown={(event) => {
                if (event.key === "Enter" && query.trim()) {
                  // Prefer tender search when the query doesn't match a nav label exactly.
                  const exact = actions.some(
                    (a) => a.label.toLowerCase() === query.trim().toLowerCase(),
                  );
                  if (!exact) {
                    event.preventDefault();
                    runTenderSearch();
                  }
                }
              }}
            />
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded-[6px] border border-slate-200 bg-slate-50 px-1.5 font-mono text-[10px] font-medium text-slate-500 sm:flex dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              ESC
            </kbd>
          </div>
          <CommandPrimitive.List className="max-h-[320px] overflow-y-auto p-2">
            <CommandPrimitive.Empty className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              <p>No page matches.</p>
              {query.trim() ? (
                <button
                  type="button"
                  className="mt-3 text-sm font-medium text-sky-600 hover:underline"
                  onClick={runTenderSearch}
                >
                  Search tenders for “{query.trim()}”
                </button>
              ) : null}
            </CommandPrimitive.Empty>
            {query.trim() ? (
              <CommandPrimitive.Group heading="Tenders">
                <CommandPrimitive.Item
                  value={`search tenders ${query}`}
                  onSelect={runTenderSearch}
                  className={cn(
                    "relative flex cursor-default select-none items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm outline-none",
                    "text-slate-600 aria-selected:bg-slate-100 aria-selected:text-slate-900",
                    "dark:text-slate-300 dark:aria-selected:bg-slate-800 dark:aria-selected:text-slate-50",
                  )}
                >
                  <Search className="size-4 shrink-0 text-slate-500 dark:text-slate-400" />
                  <span>Search tenders for “{query.trim()}”</span>
                </CommandPrimitive.Item>
              </CommandPrimitive.Group>
            ) : null}
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

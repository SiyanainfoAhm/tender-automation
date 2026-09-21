import type { LucideIcon } from "lucide-react";
import {
  Building2,
  FileCheck2,
  FileStack,
  FileText,
  Globe2,
  LayoutDashboard,
  MapPinned,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";

export type NavCountKey =
  | "tenders"
  | "indianTenders"
  | "globalTenders"
  | "submittedTenders"
  | "wonTenders";

export type AppNavChildItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  showCount?: boolean;
  countKey?: NavCountKey;
};

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** When set, sidebar shows item only if roleHasPermission(role, permission). */
  permission?: string;
  section?: "main" | "bottom";
  showCount?: boolean;
  /** Which badge count to show when showCount is true (defaults to tenders). */
  countKey?: NavCountKey;
  /** Nested sidebar links (e.g. Tenders → Indian / Global). */
  children?: AppNavChildItem[];
};

/**
 * Approved product navigation only.
 * Reports, Templates, and Settings modules are removed from design (TF-61–63).
 */
export const APP_MAIN_NAV: AppNavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    section: "main",
  },
  {
    href: "/tenders",
    label: "Tenders",
    icon: FileText,
    section: "main",
    showCount: true,
    countKey: "tenders",
    children: [
      {
        href: "/tenders/indian",
        label: "Indian",
        icon: MapPinned,
        showCount: true,
        countKey: "indianTenders",
      },
      {
        href: "/tenders/global",
        label: "Global",
        icon: Globe2,
        showCount: true,
        countKey: "globalTenders",
      },
    ],
  },
  {
    href: "/bid-fees",
    label: "Bid Fees",
    icon: Wallet,
    section: "main",
    permission: "bids.view",
  },
  {
    href: "/submitted-tenders",
    label: "Submitted Tenders",
    icon: FileCheck2,
    section: "main",
    permission: "tenders.view",
    showCount: true,
    countKey: "submittedTenders",
  },
  {
    href: "/won-tenders",
    label: "Won Tenders",
    icon: Trophy,
    section: "main",
    permission: "tenders.view",
    showCount: true,
    countKey: "wonTenders",
  },
  {
    href: "/documents",
    label: "Documents",
    icon: FileStack,
    section: "main",
  },
  {
    href: "/users",
    label: "Users",
    icon: Users,
    permission: "users.view",
    section: "main",
  },
];

export const APP_BOTTOM_NAV: AppNavItem[] = [
  {
    href: "/company-profile",
    label: "Company Profile",
    icon: Building2,
    section: "bottom",
  },
];

/** List routes that belong under the Tenders nav group (not detail/import). */
export function isTendersListPath(pathname: string): boolean {
  return (
    pathname === "/tenders" ||
    pathname === "/tenders/indian" ||
    pathname === "/tenders/global"
  );
}

export function isTendersNavActive(pathname: string): boolean {
  return (
    pathname === "/tenders" ||
    pathname.startsWith("/tenders/")
  );
}

import type { LucideIcon } from "lucide-react";
import {
  Building2,
  FileStack,
  FileText,
  LayoutDashboard,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";

export type NavCountKey = "tenders" | "wonTenders";

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
  },
  {
    href: "/bid-fees",
    label: "Bid Fees",
    icon: Wallet,
    section: "main",
    permission: "bids.view",
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

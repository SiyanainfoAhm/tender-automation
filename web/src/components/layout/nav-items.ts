import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building2,
  FileStack,
  FileText,
  Layers3,
  LayoutDashboard,
  Settings,
  Users,
  Wallet,
} from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** When set, sidebar shows item only if roleHasPermission(role, permission). */
  permission?: string;
  section?: "main" | "bottom";
  showCount?: boolean;
};

/**
 * Real routes only. Reports → /analytics
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
    href: "/documents",
    label: "Documents",
    icon: FileStack,
    section: "main",
  },
  {
    href: "/templates",
    label: "Templates",
    icon: Layers3,
    section: "main",
  },
  {
    href: "/analytics",
    label: "Reports",
    icon: BarChart3,
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
  { href: "/settings", label: "Settings", icon: Settings, section: "bottom" },
];

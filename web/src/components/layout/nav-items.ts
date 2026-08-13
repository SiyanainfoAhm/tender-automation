import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bookmark,
  Building2,
  FileStack,
  FileText,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** When set, sidebar shows item only if roleHasPermission(role, permission). */
  permission?: string;
  section?: "main" | "bottom";
};

/**
 * Real routes only. Templates omitted until implemented.
 * Reports → /analytics
 */
export const APP_MAIN_NAV: AppNavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "main" },
  { href: "/tenders", label: "Tenders", icon: FileText, section: "main" },
  { href: "/documents", label: "Documents", icon: FileStack, section: "main" },
  { href: "/analytics", label: "Reports", icon: BarChart3, section: "main" },
  { href: "/saved-views", label: "Saved Views", icon: Bookmark, section: "main" },
  { href: "/users", label: "Users", icon: Users, permission: "users.view", section: "main" },
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

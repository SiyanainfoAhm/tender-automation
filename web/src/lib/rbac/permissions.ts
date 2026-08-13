import type { UserRole } from "@/lib/validations";

export const DISPLAY_ROLES = [
  "ADMIN",
  "BID_MANAGER",
  "TECHNICAL_LEAD",
  "FINANCIAL_ANALYST",
  "BID_COORDINATOR",
  "DOCUMENT_SPECIALIST",
] as const;

export type PermissionKey =
  | "tenders.view"
  | "tenders.import"
  | "tenders.classify"
  | "tenders.screen"
  | "tenders.edit"
  | "tenders.delete"
  | "ai.view"
  | "ai.run"
  | "ai.review"
  | "bids.view"
  | "bids.create"
  | "bids.edit"
  | "bids.assign"
  | "bids.approve"
  | "bids.submit"
  | "documents.view"
  | "documents.upload"
  | "documents.edit"
  | "documents.delete"
  | "documents.verify"
  | "reports.view"
  | "reports.export"
  | "users.view"
  | "users.invite"
  | "users.edit"
  | "users.deactivate"
  | "users.manage_roles"
  | "company.view"
  | "company.edit"
  | "company.preferences.edit"
  | "settings.view"
  | "settings.edit"
  | "integrations.manage";

export type PermissionCategory =
  | "Tenders"
  | "AI Analysis"
  | "Bids"
  | "Documents"
  | "Reports"
  | "Users"
  | "Company"
  | "Settings";

export type PermissionDef = {
  key: PermissionKey;
  name: string;
  category: PermissionCategory;
  description?: string;
  sortOrder: number;
};

/** Canonical permission catalog — single source of truth for matrix + auth. */
export const PERMISSION_CATALOG: PermissionDef[] = [
  { key: "tenders.view", name: "View tenders", category: "Tenders", sortOrder: 10 },
  { key: "tenders.import", name: "Import tenders", category: "Tenders", sortOrder: 20 },
  { key: "tenders.classify", name: "Classify tenders", category: "Tenders", sortOrder: 30 },
  { key: "tenders.screen", name: "Screen tenders", category: "Tenders", sortOrder: 40 },
  { key: "tenders.edit", name: "Edit tenders", category: "Tenders", sortOrder: 50 },
  { key: "tenders.delete", name: "Delete tenders", category: "Tenders", sortOrder: 60 },

  { key: "ai.view", name: "View AI analysis", category: "AI Analysis", sortOrder: 10 },
  { key: "ai.run", name: "Run AI analysis", category: "AI Analysis", sortOrder: 20 },
  { key: "ai.review", name: "Review AI results", category: "AI Analysis", sortOrder: 30 },

  { key: "bids.view", name: "View bids", category: "Bids", sortOrder: 10 },
  { key: "bids.create", name: "Create bids", category: "Bids", sortOrder: 20 },
  { key: "bids.edit", name: "Edit bids", category: "Bids", sortOrder: 30 },
  { key: "bids.assign", name: "Assign bids", category: "Bids", sortOrder: 40 },
  { key: "bids.approve", name: "Approve bids", category: "Bids", sortOrder: 50 },
  { key: "bids.submit", name: "Submit bids", category: "Bids", sortOrder: 60 },

  { key: "documents.view", name: "View documents", category: "Documents", sortOrder: 10 },
  { key: "documents.upload", name: "Upload documents", category: "Documents", sortOrder: 20 },
  { key: "documents.edit", name: "Edit documents", category: "Documents", sortOrder: 30 },
  { key: "documents.delete", name: "Delete documents", category: "Documents", sortOrder: 40 },
  { key: "documents.verify", name: "Verify documents", category: "Documents", sortOrder: 50 },

  { key: "reports.view", name: "View reports", category: "Reports", sortOrder: 10 },
  { key: "reports.export", name: "Export reports", category: "Reports", sortOrder: 20 },

  { key: "users.view", name: "View team members", category: "Users", sortOrder: 10 },
  { key: "users.invite", name: "Invite users", category: "Users", sortOrder: 20 },
  { key: "users.edit", name: "Edit users", category: "Users", sortOrder: 30 },
  { key: "users.deactivate", name: "Deactivate users", category: "Users", sortOrder: 40 },
  { key: "users.manage_roles", name: "Manage roles", category: "Users", sortOrder: 50 },

  { key: "company.view", name: "View company profile", category: "Company", sortOrder: 10 },
  { key: "company.edit", name: "Edit company profile", category: "Company", sortOrder: 20 },
  {
    key: "company.preferences.edit",
    name: "Edit bid preferences",
    category: "Company",
    sortOrder: 30,
  },

  { key: "settings.view", name: "View settings", category: "Settings", sortOrder: 10 },
  { key: "settings.edit", name: "Edit settings", category: "Settings", sortOrder: 20 },
  {
    key: "integrations.manage",
    name: "Manage integrations",
    category: "Settings",
    sortOrder: 30,
  },
];

const ALL = PERMISSION_CATALOG.map((p) => p.key);

function pick(...keys: PermissionKey[]): PermissionKey[] {
  return keys;
}

/** Role → permissions. Matrix and server auth must use this same map. */
export const ROLE_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  ADMIN: ALL,
  BID_MANAGER: pick(
    "tenders.view",
    "tenders.import",
    "tenders.classify",
    "tenders.screen",
    "tenders.edit",
    "ai.view",
    "ai.run",
    "ai.review",
    "bids.view",
    "bids.create",
    "bids.edit",
    "bids.assign",
    "bids.approve",
    "bids.submit",
    "documents.view",
    "documents.upload",
    "documents.edit",
    "reports.view",
    "reports.export",
    "users.view",
    "company.view",
    "company.preferences.edit",
    "settings.view",
  ),
  TECHNICAL_LEAD: pick(
    "tenders.view",
    "tenders.classify",
    "tenders.screen",
    "ai.view",
    "ai.run",
    "ai.review",
    "bids.view",
    "bids.edit",
    "documents.view",
    "documents.upload",
    "reports.view",
    "company.view",
  ),
  FINANCIAL_ANALYST: pick(
    "tenders.view",
    "tenders.screen",
    "ai.view",
    "bids.view",
    "bids.edit",
    "documents.view",
    "documents.upload",
    "reports.view",
    "reports.export",
    "company.view",
    "company.preferences.edit",
  ),
  BID_COORDINATOR: pick(
    "tenders.view",
    "tenders.import",
    "bids.view",
    "bids.create",
    "bids.edit",
    "documents.view",
    "company.view",
  ),
  DOCUMENT_SPECIALIST: pick(
    "tenders.view",
    "documents.view",
    "documents.upload",
    "documents.edit",
    "documents.delete",
    "documents.verify",
    "company.view",
  ),
};

export type RoleMeta = {
  key: UserRole;
  name: string;
  description: string;
};

export const ROLE_META: RoleMeta[] = [
  {
    key: "ADMIN",
    name: "Admin",
    description:
      "Full company-level system access. Manage team, profile, preferences, and settings.",
  },
  {
    key: "BID_MANAGER",
    name: "Bid Manager",
    description:
      "Oversees bids and tenders. Coordinate work and manage bid lifecycle.",
  },
  {
    key: "TECHNICAL_LEAD",
    name: "Technical Lead",
    description:
      "Evaluates technical aspects of tenders and AI qualification results.",
  },
  {
    key: "FINANCIAL_ANALYST",
    name: "Financial Analyst",
    description:
      "Handles pricing, EMD, financial qualification and reporting.",
  },
  {
    key: "BID_COORDINATOR",
    name: "Bid Coordinator",
    description:
      "Supports bid preparation and basic tender information management.",
  },
  {
    key: "DOCUMENT_SPECIALIST",
    name: "Document Specialist",
    description:
      "Manages document library, certificates and company experience records.",
  },
];

export function permissionsForRole(role: UserRole): PermissionKey[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(
  role: UserRole,
  permission: PermissionKey,
): boolean {
  return permissionsForRole(role).includes(permission);
}

export function permissionCountForRole(role: UserRole): number {
  return permissionsForRole(role).length;
}

export function getPermissionDef(key: PermissionKey): PermissionDef | undefined {
  return PERMISSION_CATALOG.find((p) => p.key === key);
}

export function permissionsByCategory(): Record<
  PermissionCategory,
  PermissionDef[]
> {
  const out = {} as Record<PermissionCategory, PermissionDef[]>;
  for (const p of PERMISSION_CATALOG) {
    if (!out[p.category]) out[p.category] = [];
    out[p.category].push(p);
  }
  for (const cat of Object.keys(out) as PermissionCategory[]) {
    out[cat].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return out;
}

import type { UserRole } from "@/lib/validations";

/** Client-safe user — never includes password_hash. */
export type SafeAgentTenderUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  companyId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SafeAdminSeedResult = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  must_change_password: boolean;
};

export function mapRowToSafeUser(row: Record<string, unknown>): SafeAgentTenderUser {
  return {
    id: String(row.id),
    email: String(row.email),
    fullName: String(row.full_name),
    role: row.role as UserRole,
    companyId: (row.company_id as string) || null,
    isActive: Boolean(row.is_active),
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: (row.last_login_at as string) || null,
    passwordChangedAt: (row.password_changed_at as string) || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const SAFE_USER_SELECT =
  "id, email, full_name, role, company_id, is_active, must_change_password, last_login_at, password_changed_at, created_at, updated_at";

export const ADMIN_SAFE_USER_SELECT =
  `${SAFE_USER_SELECT}, failed_login_attempts, locked_until`;

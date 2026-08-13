/**
 * Company helpers. Prefer permission checks via lib/rbac for feature gates.
 */
import type { UserRole } from "@/lib/validations";
import { roleHasPermission } from "@/lib/rbac/permissions";
import { ROLE_META } from "@/lib/rbac/permissions";

export const SIYANA_COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

export function isCompanyAdminRole(role: UserRole): boolean {
  return role === "ADMIN";
}

export function canEditCompanyProfile(role: UserRole): boolean {
  return roleHasPermission(role, "company.edit");
}

export function canEditBidPreferences(role: UserRole): boolean {
  return roleHasPermission(role, "company.preferences.edit");
}

export function canManageCompanyDocuments(role: UserRole): boolean {
  return roleHasPermission(role, "documents.upload");
}

export function canViewUsers(role: UserRole): boolean {
  return roleHasPermission(role, "users.view");
}

export function companyRoleLabel(role: UserRole): string {
  return ROLE_META.find((r) => r.key === role)?.name || role.replace(/_/g, " ");
}

export type DocumentCategory =
  | "Certificate"
  | "Financial"
  | "Experience"
  | "GST"
  | "PAN"
  | "Bank Guarantee"
  | "Other"
  | "General";

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  "Certificate",
  "Financial",
  "Experience",
  "GST",
  "PAN",
  "Bank Guarantee",
  "Other",
  "General",
];

export type VerificationStatus = "pending" | "verified" | "rejected";
export type DocumentRecordStatus = "active" | "archived" | "deleted";

export type ExpiryState = "NO_EXPIRY" | "VALID" | "EXPIRING_SOON" | "EXPIRED";

export function getDocumentExpiryState(
  expiryDate: string | null | undefined,
  now = new Date(),
  soonDays = Number.parseInt(
    process.env.DOCUMENT_EXPIRY_SOON_DAYS || "30",
    10,
  ) || 30,
): ExpiryState {
  if (!expiryDate) return "NO_EXPIRY";
  const expiry = new Date(`${expiryDate}T23:59:59`);
  if (Number.isNaN(expiry.getTime())) return "NO_EXPIRY";
  if (expiry.getTime() < now.getTime()) return "EXPIRED";
  const ms = soonDays * 24 * 60 * 60 * 1000;
  if (expiry.getTime() - now.getTime() <= ms) return "EXPIRING_SOON";
  return "VALID";
}

/** Generate financial year labels like FY 2024-25 (India Apr–Mar). */
export function generateFinancialYears(
  count = 10,
  reference = new Date(),
): string[] {
  const month = reference.getMonth(); // 0=Jan
  const year = reference.getFullYear();
  // FY starts April: if Jan–Mar, current FY started previous calendar year
  const startYear = month < 3 ? year - 1 : year;
  const years: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = startYear - i;
    const b = String((a + 1) % 100).padStart(2, "0");
    years.push(`FY ${a}-${b}`);
  }
  return years;
}

export const CERTIFICATE_TYPES = [
  "ISO 9001",
  "ISO 27001",
  "ISO 20000-1",
  "CMMI",
  "MSME / Udyam",
  "DPIIT / Startup India",
  "GST",
  "PAN",
  "Other",
] as const;

export const FINANCIAL_DOCUMENT_TYPES = [
  "Balance Sheet",
  "Profit & Loss",
  "ITR",
  "Audit Report",
  "Turnover Certificate",
  "CA Certificate",
  "Other",
] as const;

export const MAX_DOCUMENT_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
] as const;

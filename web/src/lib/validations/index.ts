import { z } from "zod";
import { isIsoCalendarDate, normalizeDatePreset } from "@/lib/tender-date-filter";
import {
  DEFAULT_TENDER_SORT_BY,
  DEFAULT_TENDER_SORT_DIR,
  isWhitelistedSortKey,
} from "@/lib/tender-sort";

export const USER_ROLES = [
  "ADMIN",
  "BID_MANAGER",
  "TECHNICAL_LEAD",
  "FINANCIAL_ANALYST",
  "BID_COORDINATOR",
  "DOCUMENT_SPECIALIST",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Legacy roles accepted only for migration/read compatibility. */
export const LEGACY_USER_ROLES = ["ANALYST", "VIEWER"] as const;

const passwordComplexityRules = (schema: z.ZodString) =>
  schema
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[0-9]/, "Password must include a number")
    .regex(/[^A-Za-z0-9]/, "Password must include a special character");

/** User-chosen passwords (change password, admin reset, new users). */
export const passwordSchema = passwordComplexityRules(
  z.string().min(8, "Password must be at least 8 characters"),
);

/** Initial admin seed — same policy as user passwords. */
export const initialAdminPasswordSchema = passwordSchema;

export const loginSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1),
});

export const createUserSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().min(1).max(120),
  password: passwordSchema,
  role: z.enum(USER_ROLES),
});

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().transform((v) => v.trim().toLowerCase()).optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const profileUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  currentPassword: z.string().optional(),
});

/** Public self-registration — creates company + ADMIN for the creator. */
export const signupSchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name is required").max(120),
    email: z.string().email().transform((v) => v.trim().toLowerCase()),
    password: passwordSchema,
    confirmPassword: z.string().min(1),
    companyName: z.string().trim().min(1, "Company name is required").max(160),
    industry: z.string().trim().max(120).optional().or(z.literal("")),
    companyType: z.string().trim().max(120).optional().or(z.literal("")),
    phone: z.string().trim().max(40).optional().or(z.literal("")),
    website: z.string().trim().max(200).optional().or(z.literal("")),
    location: z.string().trim().max(160).optional().or(z.literal("")),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const resetPasswordSchema = z.object({
  userId: z.string().uuid(),
  temporaryPassword: passwordSchema,
});

export const QUALIFICATION_STATUSES = [
  "GO",
  "CONDITIONAL_GO",
  "PARTNER_BID",
  "VERIFY",
  "NO_GO",
  "WON",
  "LOST",
  "DISQUALIFIED",
  "SUBMITTED",
] as const;

export const DATE_TYPES = [
  "published_date",
  "opening_date",
  "closing_date",
  "bid_submission_date",
  "crawled_at",
  "first_seen_at",
  "created_at",
] as const;

export const VALUE_BANDS = [
  "ALL",
  "LT_10L",
  "L10_1CR",
  "CR1_5",
  "GT_5CR",
  "NOT_DISCLOSED",
] as const;

export const EMD_BANDS = [
  "ALL",
  "NOT_REQUIRED",
  "LT_1L",
  "L1_5",
  "L5_15",
  "GT_15L",
  "NOT_DISCLOSED",
] as const;

export const CLOSING_PRESETS = [
  "ALL",
  "closing_today",
  "closing_3",
  "closing_7",
  "closing_30",
  "overdue",
] as const;

function normalizeSource(
  raw: string | undefined,
): "TENDER247" | "BIDASSIST" | "MANUAL" | "ALL" {
  if (!raw || raw === "ALL" || raw.toLowerCase() === "all") return "ALL";
  const upper = raw.toUpperCase().replace(/-/g, "");
  if (upper === "TENDER247") return "TENDER247";
  if (upper === "BIDASSIST") return "BIDASSIST";
  if (upper === "MANUAL") return "MANUAL";
  return "ALL";
}

export const tenderFiltersSchema = z
  .object({
    q: z.string().optional(),
    source: z.string().optional().default("ALL"),
    status: z.string().optional().default("ALL"),
    downloadStatus: z.string().optional(),
    dateType: z.enum(DATE_TYPES).optional().default("closing_date"),
    from: z.string().optional(),
    to: z.string().optional(),
    quickDate: z
      .enum([
        "today",
        "last_7",
        "last_30",
        "closing_today",
        "closing_3",
        "closing_7",
        "closing_30",
        "overdue",
      ])
      .optional(),
    closingPreset: z.enum(CLOSING_PRESETS).optional().default("ALL"),
    valueBand: z.enum(VALUE_BANDS).optional().default("ALL"),
    emdBand: z.enum(EMD_BANDS).optional().default("ALL"),
    state: z.string().optional(),
    city: z.string().optional(),
    category: z.string().optional(),
    organization: z.string().optional(),
    authority: z.string().optional(),
    tenderValueMin: z.coerce.number().optional(),
    tenderValueMax: z.coerce.number().optional(),
    emdMin: z.coerce.number().optional(),
    emdMax: z.coerce.number().optional(),
    manualReview: z.enum(["true", "false"]).optional(),
    qualified: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((n) => [25, 50, 100].includes(n), "Invalid page size")
      .optional()
      .default(25),
    /** Preferred URL param: sort=value */
    sort: z.string().optional(),
    /** Preferred URL param: direction=asc|desc */
    direction: z.enum(["asc", "desc"]).optional(),
    /** Alias used in shareable URLs: order=desc */
    order: z.enum(["asc", "desc"]).optional(),
    /** Legacy aliases */
    sortBy: z.string().optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
    /** Scraped/source date preset — filters `scraped_date` (Excel run date). */
    date: z.string().optional(),
    selectedDate: z.string().optional(),
    createdFrom: z.string().optional(),
    createdTo: z.string().optional(),
    /** Closing deadline date preset / custom range. */
    closingDate: z.string().optional(),
    closingFrom: z.string().optional(),
    closingTo: z.string().optional(),
  })
  .transform((data) => {
    const requested = data.sort || data.sortBy;
    const sortBy = isWhitelistedSortKey(requested)
      ? (requested as string)
      : DEFAULT_TENDER_SORT_BY;
    const sortDir =
      data.direction || data.order || data.sortDir || DEFAULT_TENDER_SORT_DIR;
    let quickDate = data.quickDate;
    if (!quickDate && data.closingPreset && data.closingPreset !== "ALL") {
      quickDate = data.closingPreset;
    }
    const selectedDate = isIsoCalendarDate(data.selectedDate)
      ? data.selectedDate
      : undefined;
    const date = normalizeDatePreset(data.date);
    const createdFrom = isIsoCalendarDate(data.createdFrom)
      ? data.createdFrom
      : undefined;
    const createdTo = isIsoCalendarDate(data.createdTo)
      ? data.createdTo
      : undefined;
    const closingDate = normalizeDatePreset(data.closingDate);
    const closingFrom = isIsoCalendarDate(data.closingFrom)
      ? data.closingFrom
      : undefined;
    const closingTo = isIsoCalendarDate(data.closingTo)
      ? data.closingTo
      : undefined;
    return {
      ...data,
      source: normalizeSource(data.source),
      sortBy,
      sortDir,
      quickDate,
      date,
      selectedDate,
      createdFrom,
      createdTo,
      closingDate,
      closingFrom,
      closingTo,
    };
  });

export type TenderFilters = z.infer<typeof tenderFiltersSchema>;

export const savedViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional().default(false),
  filters: z.record(z.string(), z.unknown()).default({}),
  sortConfig: z.record(z.string(), z.unknown()).default({}),
  visibleColumns: z.array(z.string()).default([]),
});

export const preferencesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  tableDensity: z.enum(["compact", "comfortable", "spacious"]).optional(),
  sidebarCollapsed: z.boolean().optional(),
  defaultDateFilter: z.string().nullable().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

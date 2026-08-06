import { z } from "zod";

export const USER_ROLES = [
  "ADMIN",
  "BID_MANAGER",
  "ANALYST",
  "VIEWER",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

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
] as const;

export const DATE_TYPES = [
  "published_date",
  "opening_date",
  "closing_date",
  "bid_submission_date",
  "crawled_at",
  "first_seen_at",
] as const;

export const tenderFiltersSchema = z.object({
  q: z.string().optional(),
  source: z.enum(["TENDER247", "BIDASSIST", "ALL"]).optional().default("ALL"),
  status: z
    .union([
      z.enum(QUALIFICATION_STATUSES),
      z.literal("NOT_EVALUATED"),
      z.literal("ALL"),
    ])
    .optional()
    .default("ALL"),
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
      "overdue",
    ])
    .optional(),
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
  sortBy: z.string().optional().default("updated_at"),
  sortDir: z.enum(["asc", "desc"]).optional().default("desc"),
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

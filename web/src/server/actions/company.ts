"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  requireBidPreferencesEditor,
  requireCompanyAdminSession,
  requireCompanyDocumentManager,
  requireCompanySession,
  CompanyAccessError,
} from "@/server/auth/company-access";
import {
  updateCompanyProfile,
  upsertCompanyBidPreferences,
} from "@/server/repositories/companyRepository";
import { roleHasPermission } from "@/lib/rbac/permissions";
import {
  invokeDocumentDelete,
  invokeDocumentUpload,
} from "@/server/storage/tenderAutomationDocumentFunctions";
import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  CERTIFICATE_TYPES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_DOCUMENT_UPLOAD_SIZE_MB,
} from "@/lib/company/types";
import { parseStoredScopeList } from "@/lib/company/scope-chips";
import {
  parseScreeningPolicyValue,
  SCREENING_POLICY_FIELDS,
  type ScreeningPolicies,
} from "@/lib/company/screening-policies";
import { parseValidYearEstablished } from "@/lib/validations/phone-rules";

function optionalWebsiteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname || !url.hostname.includes(".")) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

const companyProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Company name is required").max(200),
    industryType: z
      .string()
      .trim()
      .min(1, "Industry type is required")
      .max(120),
    businessLocation: z
      .string()
      .trim()
      .min(1, "Business location is required")
      .max(160),
    website: z.string().trim().max(200).optional().or(z.literal("")),
    yearEstablished: z.string().trim().optional().or(z.literal("")),
    description: z.string().trim().max(4000).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.website?.trim()) {
      if (optionalWebsiteUrl(data.website) == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["website"],
          message: "Enter a valid website URL",
        });
      }
    }
    const year = parseValidYearEstablished(data.yearEstablished || "");
    if (!year.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["yearEstablished"],
        message: year.message,
      });
    }
  })
  .transform((data) => {
    const year = parseValidYearEstablished(data.yearEstablished || "");
    return {
      name: data.name,
      industryType: data.industryType,
      businessLocation: data.businessLocation,
      website: data.website?.trim()
        ? optionalWebsiteUrl(data.website) || data.website.trim()
        : null,
      yearEstablished: year.ok ? year.year : null,
      description: data.description?.trim() || null,
    };
  });

const bidPreferencesSchema = z
  .object({
    maxEmdInr: z
      .string()
      .optional()
      .transform((v) => {
        if (v == null || v.trim() === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }),
    minTenderValueInr: z
      .string()
      .optional()
      .transform((v) => {
        if (v == null || v.trim() === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }),
    maxTenderValueInr: z
      .string()
      .optional()
      .transform((v) => {
        if (v == null || v.trim() === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }),
    minBidLeadDays: z
      .string()
      .optional()
      .transform((v) => {
        if (v == null || v.trim() === "") return null;
        const n = Number(v);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
          return Number.NaN;
        }
        return n;
      }),
    serviceScope: z.string().optional(),
    excludedScope: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.maxEmdInr != null &&
      (data.maxEmdInr < 0 || !Number.isFinite(data.maxEmdInr))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxEmdInr"],
        message: "Maximum EMD must be a non-negative number",
      });
    }
    if (
      data.minTenderValueInr != null &&
      (data.minTenderValueInr < 0 || !Number.isFinite(data.minTenderValueInr))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minTenderValueInr"],
        message: "Minimum tender value must be a non-negative number",
      });
    }
    if (
      data.maxTenderValueInr != null &&
      (data.maxTenderValueInr < 0 || !Number.isFinite(data.maxTenderValueInr))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxTenderValueInr"],
        message: "Maximum tender value must be a non-negative number",
      });
    }
    if (
      data.minTenderValueInr != null &&
      data.maxTenderValueInr != null &&
      data.minTenderValueInr > data.maxTenderValueInr
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minTenderValueInr"],
        message: "Minimum tender value cannot exceed maximum tender value",
      });
    }
    if (Number.isNaN(data.minBidLeadDays as number)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minBidLeadDays"],
        message: "Minimum bid lead time must be zero or a positive whole number of days",
      });
    }
  });

function parseScopeList(raw: string | undefined): string[] {
  return parseStoredScopeList(raw);
}

function parsePoliciesFromForm(formData: FormData): ScreeningPolicies {
  const policies: ScreeningPolicies = {};
  for (const field of SCREENING_POLICY_FIELDS) {
    const parsed = parseScreeningPolicyValue(
      formData.get(`screeningPolicy.${field.key}`),
    );
    if (parsed) policies[field.key] = parsed;
  }
  return policies;
}

export async function updateCompanyProfileAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireCompanyAdminSession();
    const parsed = companyProfileSchema.safeParse({
      name: formData.get("name"),
      industryType: formData.get("industryType") || "",
      businessLocation: formData.get("businessLocation") || "",
      website: formData.get("website") || "",
      yearEstablished: formData.get("yearEstablished") || "",
      description: formData.get("description") || "",
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid profile" };
    }

    await updateCompanyProfile(session.companyId, {
      name: parsed.data.name,
      industryType: parsed.data.industryType || null,
      businessLocation: parsed.data.businessLocation || null,
      website: parsed.data.website,
      yearEstablished: parsed.data.yearEstablished,
      description: parsed.data.description,
    });

    revalidatePath("/company-profile");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to save profile",
    };
  }
}

export async function updateBidPreferencesAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireBidPreferencesEditor();
    const parsed = bidPreferencesSchema.safeParse({
      maxEmdInr: String(formData.get("maxEmdInr") ?? ""),
      minTenderValueInr: String(formData.get("minTenderValueInr") ?? ""),
      maxTenderValueInr: String(formData.get("maxTenderValueInr") ?? ""),
      minBidLeadDays: String(formData.get("minBidLeadDays") ?? ""),
      serviceScope: formData.get("serviceScope") || "",
      excludedScope: formData.get("excludedScope") || "",
    });
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message || "Invalid preferences",
      };
    }

    await upsertCompanyBidPreferences(session.companyId, {
      maxEmdInr: parsed.data.maxEmdInr,
      minTenderValueInr: parsed.data.minTenderValueInr,
      maxTenderValueInr: parsed.data.maxTenderValueInr,
      minBidLeadDays: parsed.data.minBidLeadDays,
      serviceScope: parseScopeList(parsed.data.serviceScope),
      excludedScope: parseScopeList(parsed.data.excludedScope),
      screeningPolicies: parsePoliciesFromForm(formData),
    });

    revalidatePath("/company-profile");
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to save preferences",
    };
  }
}

function extensionAllowed(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ALLOWED_DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Upload pipeline:
 * Next.js authenticates → Edge Function (Azure SAS secrets) uploads + inserts metadata.
 * Azure credentials never touch the Next.js/browser environment.
 */
export async function uploadCompanyDocumentAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireCompanyDocumentManager();

    const name = String(formData.get("name") || "").trim();
    const file = formData.get("file");

    if (!name) return { error: "Document name is required" };
    if (!(file instanceof File) || file.size <= 0) {
      return { error: "Please select a file to upload" };
    }
    if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
      return {
        error: `File too large. Maximum size is ${MAX_DOCUMENT_UPLOAD_SIZE_MB} MB.`,
      };
    }
    if (!extensionAllowed(file.name)) {
      return {
        error: "File type not allowed. Use PDF, DOC, DOCX, XLS, or XLSX.",
      };
    }

    // Light client-side category validation before invoking the Edge Function.
    const uploadKind = String(formData.get("uploadKind") || "general");
    if (uploadKind === "certificate") {
      const certificateType = String(formData.get("certificateType") || "").trim();
      const issuingAuthority = String(
        formData.get("issuingAuthority") || "",
      ).trim();
      const issueDate = String(formData.get("issueDate") || "").trim();
      const expiryDate = String(formData.get("expiryDate") || "").trim();
      if (!certificateType) return { error: "Certificate type is required" };
      if (
        !(CERTIFICATE_TYPES as readonly string[]).includes(certificateType)
      ) {
        return { error: "Select a valid certificate type" };
      }
      if (!issuingAuthority) return { error: "Issuing authority is required" };
      if (!issueDate) return { error: "Issue date is required" };
      const today = new Date().toISOString().slice(0, 10);
      if (issueDate > today) {
        return { error: "Issue date cannot be after today" };
      }
      if (expiryDate && expiryDate < issueDate) {
        return { error: "Expiry date must be on or after issue date" };
      }
    } else if (uploadKind === "financial") {
      const financialYear = String(formData.get("financialYear") || "").trim();
      const documentType = String(formData.get("documentType") || "").trim();
      if (!financialYear) return { error: "Financial year is required" };
      if (!documentType) return { error: "Document type is required" };
    }

    console.info("[documents] upload started (edge function)");
    formData.set("action", "upload");
    if (!formData.get("documentName") && name) {
      formData.set("documentName", name);
    }
    if (!formData.get("category")) {
      const kind = String(formData.get("uploadKind") || "general").toLowerCase();
      formData.set(
        "category",
        kind === "certificate"
          ? "Certificate"
          : kind === "financial"
            ? "Financial"
            : "General",
      );
    }

    const result = await invokeDocumentUpload(formData);
    if (!result.success) {
      return {
        error:
          result.error ||
          "Unable to upload the file to document storage. Please try again.",
      };
    }

    revalidatePath("/documents");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    console.error("[documents] upload failed", error);
    return {
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

export async function deleteCompanyDocumentAction(
  documentId: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireCompanySession();
    if (!roleHasPermission(session.user.role, "documents.delete")) {
      throw new CompanyAccessError(
        "FORBIDDEN",
        "You do not have permission to delete documents.",
      );
    }

    const result = await invokeDocumentDelete(documentId);
    if (!result.success) {
      return {
        error: result.error || "Unable to delete document",
      };
    }

    revalidatePath("/documents");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to delete document",
    };
  }
}

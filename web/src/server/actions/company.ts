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
  MAX_DOCUMENT_UPLOAD_BYTES,
} from "@/lib/company/types";

const companyProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  industryType: z.string().trim().max(120).optional().or(z.literal("")),
  businessLocation: z.string().trim().max(160).optional().or(z.literal("")),
  website: z.string().trim().max(200).optional().or(z.literal("")),
  yearEstablished: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || !v.trim()) return null;
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    }),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
});

const bidPreferencesSchema = z.object({
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
  serviceScope: z.string().optional(),
  excludedScope: z.string().optional(),
});

function parseScopeList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
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
      website: parsed.data.website || null,
      yearEstablished: parsed.data.yearEstablished,
      description: parsed.data.description || null,
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
      serviceScope: parseScopeList(parsed.data.serviceScope),
      excludedScope: parseScopeList(parsed.data.excludedScope),
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
      return { error: "File exceeds the 25 MB limit" };
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
      if (!issuingAuthority) return { error: "Issuing authority is required" };
      if (!issueDate) return { error: "Issue date is required" };
      if (!expiryDate) return { error: "Expiry date is required" };
      if (expiryDate < issueDate) {
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

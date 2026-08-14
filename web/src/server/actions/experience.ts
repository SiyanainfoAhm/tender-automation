"use server";

import { revalidatePath } from "next/cache";

import { MAX_DOCUMENT_UPLOAD_BYTES } from "@/lib/company/types";
import { monthsBetween } from "@/lib/experience/duration";
import { companyExperienceSchema } from "@/lib/experience/schema";
import { requireCompanyDocumentManager } from "@/server/auth/company-access";
import {
  archiveCompanyExperience,
  createCompanyExperience,
  getCompanyExperienceById,
  updateCompanyExperience,
} from "@/server/repositories/experienceRepository";
import {
  invokeExperienceAssetsDelete,
  invokeExperienceAssetsSave,
} from "@/server/storage/tenderAutomationDocumentFunctions";

function getOptionalFile(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  if (value instanceof File && value.size > 0) return value;
  return null;
}

function validateExperiencePdf(file: File, label: string): string | null {
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    return `${label} exceeds the 25 MB limit.`;
  }
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".pdf")) {
    return `${label} must be a PDF.`;
  }
  const mime = (file.type || "").toLowerCase();
  if (mime && mime !== "application/pdf") {
    return `${label} must be a PDF.`;
  }
  return null;
}

function parseExperienceForm(formData: FormData) {
  return companyExperienceSchema.safeParse({
    projectName: String(formData.get("projectName") || ""),
    clientName: String(formData.get("clientName") || ""),
    location: String(formData.get("location") || ""),
    natureOfWork: String(formData.get("natureOfWork") || ""),
    contractValue: String(formData.get("contractValue") || ""),
    projectStatus: String(formData.get("projectStatus") || "ongoing"),
    startDate: String(formData.get("startDate") || ""),
    completionDate: String(formData.get("completionDate") || ""),
    expectedCompletionDate: String(
      formData.get("expectedCompletionDate") || "",
    ),
    description: String(formData.get("description") || ""),
    contactPersonName: String(formData.get("contactPersonName") || ""),
    contactMobile: String(formData.get("contactMobile") || ""),
    contactEmail: String(formData.get("contactEmail") || ""),
  });
}

function toInsert(parsed: {
  projectName: string;
  clientName: string;
  location: string;
  natureOfWork: string;
  contractValue: number;
  projectStatus: "ongoing" | "completed";
  startDate: string;
  completionDate: string | null;
  expectedCompletionDate: string | null;
  description: string | null;
  contactPersonName: string;
  contactMobile: string;
  contactEmail: string | null;
}) {
  const endDate =
    parsed.projectStatus === "completed" ? parsed.completionDate : null;
  const expected =
    parsed.projectStatus === "ongoing" ? parsed.expectedCompletionDate : null;
  const durationMonths =
    parsed.projectStatus === "completed"
      ? monthsBetween(parsed.startDate, endDate)
      : monthsBetween(parsed.startDate, new Date());

  return {
    projectName: parsed.projectName,
    clientName: parsed.clientName,
    location: parsed.location,
    natureOfWork: parsed.natureOfWork,
    projectValueInr: parsed.contractValue,
    projectStatus: parsed.projectStatus,
    startDate: parsed.startDate,
    endDate,
    expectedCompletionDate: expected,
    durationMonths,
    description: parsed.description,
    contactPersonName: parsed.contactPersonName,
    contactMobile: parsed.contactMobile,
    contactEmail: parsed.contactEmail,
  };
}

async function saveExperienceAssets(options: {
  experienceId: string;
  projectName: string;
  workOrder?: File | null;
  completionCertificate?: File | null;
  clearCompletionCertificate?: boolean;
}): Promise<string | null> {
  if (
    !options.workOrder &&
    !options.completionCertificate &&
    !options.clearCompletionCertificate
  ) {
    return null;
  }
  const result = await invokeExperienceAssetsSave(options);
  if (!result.success) {
    return result.error || "Unable to upload experience files. Please try again.";
  }
  return null;
}

export async function createCompanyExperienceAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireCompanyDocumentManager();
    const parsed = parseExperienceForm(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid experience" };
    }

    const workOrder = getOptionalFile(formData, "workOrder");
    const completionCertificate = getOptionalFile(
      formData,
      "completionCertificate",
    );
    if (!workOrder) {
      return { error: "Work Order is required." };
    }
    const workOrderError = validateExperiencePdf(workOrder, "Work Order");
    if (workOrderError) return { error: workOrderError };

    if (parsed.data.projectStatus === "completed") {
      if (!completionCertificate) {
        return { error: "Completion Certificate is required for completed projects." };
      }
    } else if (completionCertificate) {
      return {
        error: "Completion Certificate can only be uploaded for completed projects.",
      };
    }

    if (completionCertificate) {
      const certError = validateExperiencePdf(
        completionCertificate,
        "Completion Certificate",
      );
      if (certError) return { error: certError };
    }

    const created = await createCompanyExperience({
      companyId: session.companyId,
      createdBy: session.user.id,
      input: toInsert(parsed.data),
    });

    const assetError = await saveExperienceAssets({
      experienceId: created.id,
      projectName: created.projectName,
      workOrder,
      completionCertificate,
    });
    if (assetError) {
      const cleanup = await invokeExperienceAssetsDelete(created.id);
      if (!cleanup.success) {
        await archiveCompanyExperience({
          companyId: session.companyId,
          id: created.id,
          updatedBy: session.user.id,
        }).catch(() => null);
      }
      return { error: assetError };
    }

    revalidatePath("/documents");
    return { ok: true };
  } catch (error) {
    console.error("[experience] create failed", error);
    return {
      error:
        error instanceof Error ? error.message : "Unable to add experience",
    };
  }
}

export async function updateCompanyExperienceAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireCompanyDocumentManager();
    const id = String(formData.get("id") || "").trim();
    if (!id) return { error: "Experience id is required" };

    const existing = await getCompanyExperienceById({
      companyId: session.companyId,
      id,
    });
    if (!existing) return { error: "Experience record not found." };

    const parsed = parseExperienceForm(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid experience" };
    }

    const workOrder = getOptionalFile(formData, "workOrder");
    const completionCertificate = getOptionalFile(
      formData,
      "completionCertificate",
    );
    const workOrderError = workOrder
      ? validateExperiencePdf(workOrder, "Work Order")
      : null;
    if (workOrderError) return { error: workOrderError };
    const certError = completionCertificate
      ? validateExperiencePdf(completionCertificate, "Completion Certificate")
      : null;
    if (certError) return { error: certError };

    const switchingToOngoing =
      existing.projectStatus === "completed" &&
      parsed.data.projectStatus === "ongoing";
    const clearCompletionCertificate =
      switchingToOngoing && Boolean(existing.completionCertificateUrl);

    if (parsed.data.projectStatus === "ongoing" && completionCertificate) {
      return {
        error: "Completion Certificate can only be uploaded for completed projects.",
      };
    }

    if (
      parsed.data.projectStatus === "completed" &&
      !existing.completionCertificateUrl &&
      !completionCertificate
    ) {
      return {
        error: "Completion Certificate is required for completed projects.",
      };
    }

    await updateCompanyExperience({
      companyId: session.companyId,
      id,
      updatedBy: session.user.id,
      input: toInsert(parsed.data),
    });

    const assetError = await saveExperienceAssets({
      experienceId: id,
      projectName: parsed.data.projectName,
      workOrder,
      completionCertificate,
      clearCompletionCertificate,
    });
    if (assetError) return { error: assetError };

    revalidatePath("/documents");
    return { ok: true };
  } catch (error) {
    console.error("[experience] update failed", error);
    return {
      error:
        error instanceof Error ? error.message : "Unable to save experience",
    };
  }
}

export async function deleteCompanyExperienceAction(
  experienceId: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireCompanyDocumentManager();
    const result = await invokeExperienceAssetsDelete(experienceId);
    if (!result.success) {
      return { error: result.error || "Unable to delete experience" };
    }
    revalidatePath("/documents");
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to delete experience",
    };
  }
}

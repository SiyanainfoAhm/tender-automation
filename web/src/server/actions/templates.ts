"use server";

import { revalidatePath } from "next/cache";

import { CompanyAccessError, requireCompanySession } from "@/server/auth/company-access";
import { canManageBidProfileTemplates } from "@/lib/company/types";
import { bidProfileTemplateSchema } from "@/lib/templates/schema";
import { templateAssetValidationError } from "@/lib/templates/templateAsset";
import type { BidPreparationTender } from "@/lib/templates/types";
import {
  archiveBidProfileTemplate,
  createBidProfileTemplate,
  duplicateBidProfileTemplate,
  getBidProfileTemplate,
  setDefaultBidProfileTemplate,
  updateBidProfileTemplate,
} from "@/server/repositories/bidProfileTemplateRepository";
import { searchTendersForBidPreparation } from "@/server/repositories/tenderRepository";
import {
  invokeTemplateAssetsDelete,
  invokeTemplateAssetsSave,
} from "@/server/storage/tenderAutomationDocumentFunctions";

async function requireTemplateManager() {
  const session = await requireCompanySession();
  if (!canManageBidProfileTemplates(session.user.role)) {
    throw new CompanyAccessError(
      "FORBIDDEN",
      "You do not have permission to manage bid profile templates.",
    );
  }
  return session;
}

function getOptionalFile(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  if (value instanceof File && value.size > 0) return value;
  return null;
}

async function saveTemplateAssets(options: {
  templateId: string;
  templateName: string;
  companySignStamp: File | null;
  cleanupLegacyLogo?: boolean;
}): Promise<string | null> {
  if (!options.companySignStamp && !options.cleanupLegacyLogo) return null;
  const result = await invokeTemplateAssetsSave(options);
  if (!result.success) {
    return result.error || "Unable to upload template files. Please try again.";
  }
  return null;
}

function formBoolean(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

function parseTemplateForm(formData: FormData) {
  return bidProfileTemplateSchema.safeParse({
    templateName: String(formData.get("templateName") || ""),
    description: String(formData.get("description") || ""),
    isDefault: formBoolean(formData, "isDefault"),
    companyName: String(formData.get("companyName") || ""),
    referenceNumber: String(formData.get("referenceNumber") || ""),
    tenderAcceptanceUndertakingDate: String(
      formData.get("tenderAcceptanceUndertakingDate") || "",
    ),
    minimumLocalContent: String(formData.get("minimumLocalContent") || ""),
    localValueAdditionLocation: String(
      formData.get("localValueAdditionLocation") || "",
    ),
    authorizedPersonName: String(formData.get("authorizedPersonName") || ""),
    authorizedPersonPosition: String(
      formData.get("authorizedPersonPosition") || "",
    ),
    signatoryName: String(formData.get("signatoryName") || ""),
    signatoryDesignation: String(formData.get("signatoryDesignation") || ""),
    departmentName: String(formData.get("departmentName") || ""),
    departmentAddress: String(formData.get("departmentAddress") || ""),
    companyAddress: String(formData.get("companyAddress") || ""),
  });
}

export async function searchBidPreparationTendersAction(
  tenderId: string,
  referenceNo: string,
): Promise<{ error?: string; tenders?: BidPreparationTender[] }> {
  try {
    await requireCompanySession();
    const id = tenderId.trim();
    const ref = referenceNo.trim();
    if (!id && !ref) {
      return { error: "Enter a Tender ID or Reference Number." };
    }
    const rows = await searchTendersForBidPreparation({
      tenderId: id,
      referenceNo: ref,
    });
    return {
      tenders: rows.map((row) => ({
        id: row.id,
        sourceTenderId: row.source_tender_id,
        folderId: row.folder_id,
        title: row.title,
        organization: row.organization,
        authority: row.authority,
        tenderValue: row.tender_value,
        tenderValueText: row.tender_value_text,
        closingDate: row.closing_date,
        sourcePortal: row.source_portal,
        qualificationStatus: row.qualification_status,
        sourceUrl: row.source_url,
      })),
    };
  } catch (error) {
    console.error("[templates] tender search failed", error);
    return { error: "Unable to search tenders. Please try again." };
  }
}

export async function createBidProfileTemplateAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireTemplateManager();
    const parsed = parseTemplateForm(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid template" };
    }

    const companySignStamp =
      getOptionalFile(formData, "companySignStamp") ||
      getOptionalFile(formData, "companySignatory");
    const stampError = companySignStamp
      ? templateAssetValidationError(companySignStamp)
      : null;
    if (stampError) return { error: stampError };

    const created = await createBidProfileTemplate({
      companyId: session.companyId,
      createdBy: session.user.id,
      input: {
        ...parsed.data,
        companySignatoryUrl: null,
      },
    });

    const assetError = await saveTemplateAssets({
      templateId: created.id,
      templateName: created.templateName,
      companySignStamp,
    });
    if (assetError) {
      const cleanup = await invokeTemplateAssetsDelete(created.id);
      if (!cleanup.success) {
        await archiveBidProfileTemplate({
          companyId: session.companyId,
          id: created.id,
          updatedBy: session.user.id,
        }).catch(() => null);
      }
      return { error: assetError };
    }

    revalidatePath("/templates");
    return { ok: true };
  } catch (error) {
    console.error("[templates] create failed", error);
    return {
      error:
        error instanceof Error ? error.message : "Unable to create template",
    };
  }
}

export async function updateBidProfileTemplateAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireTemplateManager();
    const id = String(formData.get("id") || "").trim();
    if (!id) return { error: "Template id is required" };
    const parsed = parseTemplateForm(formData);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Invalid template" };
    }

    const companySignStamp =
      getOptionalFile(formData, "companySignStamp") ||
      getOptionalFile(formData, "companySignatory");
    const stampError = companySignStamp
      ? templateAssetValidationError(companySignStamp)
      : null;
    if (stampError) return { error: stampError };

    const existing = await getBidProfileTemplate({
      companyId: session.companyId,
      id,
    });
    if (!existing || existing.status !== "active") {
      return { error: "Template not found." };
    }

    await updateBidProfileTemplate({
      companyId: session.companyId,
      id,
      updatedBy: session.user.id,
      input: parsed.data,
    });

    const cleanupLegacyLogo = Boolean(
      existing.companyLogoUrl || existing.companyLogoBlobName,
    );
    const assetError = await saveTemplateAssets({
      templateId: id,
      templateName: parsed.data.templateName,
      companySignStamp,
      cleanupLegacyLogo,
    });
    if (assetError) return { error: assetError };

    revalidatePath("/templates");
    return { ok: true };
  } catch (error) {
    console.error("[templates] update failed", error);
    return {
      error:
        error instanceof Error ? error.message : "Unable to save template",
    };
  }
}

export async function deleteBidProfileTemplateAction(
  templateId: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    await requireTemplateManager();
    const result = await invokeTemplateAssetsDelete(templateId);
    if (!result.success) {
      return {
        error: result.error || "Unable to delete template",
      };
    }
    revalidatePath("/templates");
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to delete template",
    };
  }
}

export async function setDefaultBidProfileTemplateAction(
  templateId: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireTemplateManager();
    await setDefaultBidProfileTemplate({
      companyId: session.companyId,
      id: templateId,
      updatedBy: session.user.id,
    });
    revalidatePath("/templates");
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to set default template",
    };
  }
}

export async function duplicateBidProfileTemplateAction(
  templateId: string,
): Promise<{ error?: string; ok?: boolean }> {
  try {
    const session = await requireTemplateManager();
    await duplicateBidProfileTemplate({
      companyId: session.companyId,
      id: templateId,
      createdBy: session.user.id,
    });
    revalidatePath("/templates");
    return { ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to duplicate template",
    };
  }
}

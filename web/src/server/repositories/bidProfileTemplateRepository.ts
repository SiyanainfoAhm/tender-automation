import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import {
  fileNameFromStoragePath,
  templateLogoReadUrl,
  templateSignStampReadUrl,
} from "@/lib/templates/templateAsset";
import type {
  BidProfileTemplate,
  BidProfileTemplateInsert,
  BidProfileTemplateUpdate,
} from "@/lib/templates/types";

function mapTemplate(row: Record<string, unknown>): BidProfileTemplate {
  const id = String(row.id);
  const stampBlob = (row.company_signatory_blob_name as string) || null;
  const stampAzureUrl = (row.company_signatory_url as string) || null;
  const hasStamp = Boolean(stampBlob || stampAzureUrl);
  const logoBlob = (row.company_logo_blob_name as string) || null;
  const logoAzureUrl = (row.company_logo_url as string) || null;
  const hasLogo = Boolean(logoBlob || logoAzureUrl);

  return {
    id,
    companyId: String(row.company_id),
    templateName: String(row.template_name),
    description: (row.description as string) || null,
    isDefault: Boolean(row.is_default),
    companyName: String(row.company_name),
    referenceNumber: (row.reference_number as string) || null,
    tenderAcceptanceUndertakingDate:
      (row.tender_acceptance_undertaking_date as string) || null,
    minimumLocalContent:
      row.minimum_local_content == null
        ? null
        : Number(row.minimum_local_content),
    localValueAdditionLocation:
      (row.local_value_addition_location as string) || null,
    authorizedPersonName: String(row.authorized_person_name),
    authorizedPersonPosition:
      (row.authorized_person_position as string) || null,
    signatoryName: String(row.signatory_name),
    signatoryDesignation: (row.signatory_designation as string) || null,
    departmentName: String(row.department_name),
    departmentAddress: (row.department_address as string) || null,
    companyAddress: (row.company_address as string) || null,
    companySignStampUrl: hasStamp ? templateSignStampReadUrl(id) : null,
    companySignStampFileName:
      fileNameFromStoragePath(stampBlob) ||
      fileNameFromStoragePath(stampAzureUrl),
    companySignatoryUrl: hasStamp ? templateSignStampReadUrl(id) : null,
    companyLogoUrl: hasLogo ? templateLogoReadUrl(id) : null,
    companyLogoBlobName: logoBlob,
    companySignatoryBlobName: stampBlob,
    status: row.status === "archived" ? "archived" : "active",
    createdBy: row.created_by ? String(row.created_by) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toRow(input: BidProfileTemplateInsert): Record<string, unknown> {
  return {
    template_name: input.templateName.trim(),
    description: input.description?.trim() || null,
    is_default: Boolean(input.isDefault),
    company_name: input.companyName.trim(),
    reference_number: input.referenceNumber?.trim() || null,
    tender_acceptance_undertaking_date:
      input.tenderAcceptanceUndertakingDate || null,
    minimum_local_content: input.minimumLocalContent ?? null,
    local_value_addition_location:
      input.localValueAdditionLocation?.trim() || null,
    authorized_person_name: input.authorizedPersonName.trim(),
    authorized_person_position:
      input.authorizedPersonPosition?.trim() || null,
    signatory_name: input.signatoryName.trim(),
    signatory_designation: input.signatoryDesignation?.trim() || null,
    department_name: input.departmentName.trim(),
    department_address: input.departmentAddress?.trim() || null,
    company_address: input.companyAddress?.trim() || null,
    company_signatory_url: input.companySignatoryUrl?.trim() || null,
  };
}

export async function listBidProfileTemplates(
  companyId: string,
): Promise<BidProfileTemplate[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_profile_templates")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => mapTemplate(row as Record<string, unknown>));
}

export async function getBidProfileTemplate(options: {
  companyId: string;
  id: string;
}): Promise<BidProfileTemplate | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_profile_templates")
    .select("*")
    .eq("id", options.id)
    .eq("company_id", options.companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapTemplate(data as Record<string, unknown>) : null;
}

async function clearCompanyDefault(companyId: string): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_bid_profile_templates")
    .update({ is_default: false })
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("is_default", true);
  if (error) throw new Error(error.message);
}

export async function createBidProfileTemplate(options: {
  companyId: string;
  createdBy: string;
  input: BidProfileTemplateInsert;
}): Promise<BidProfileTemplate> {
  const supabase = getServerSupabase();
  if (options.input.isDefault) {
    await clearCompanyDefault(options.companyId);
  }
  const { data, error } = await supabase
    .from("agenttender_bid_profile_templates")
    .insert({
      company_id: options.companyId,
      created_by: options.createdBy,
      updated_by: options.createdBy,
      status: "active",
      ...toRow(options.input),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapTemplate(data as Record<string, unknown>);
}

export async function updateBidProfileTemplate(options: {
  companyId: string;
  id: string;
  updatedBy: string;
  input: BidProfileTemplateUpdate;
}): Promise<BidProfileTemplate> {
  const existing = await getBidProfileTemplate({
    companyId: options.companyId,
    id: options.id,
  });
  if (!existing || existing.status !== "active") {
    throw new Error("Template not found.");
  }

  const merged: BidProfileTemplateInsert = {
    templateName: options.input.templateName ?? existing.templateName,
    description:
      options.input.description !== undefined
        ? options.input.description
        : existing.description,
    isDefault:
      options.input.isDefault !== undefined
        ? options.input.isDefault
        : existing.isDefault,
    companyName: options.input.companyName ?? existing.companyName,
    referenceNumber:
      options.input.referenceNumber !== undefined
        ? options.input.referenceNumber
        : existing.referenceNumber,
    tenderAcceptanceUndertakingDate:
      options.input.tenderAcceptanceUndertakingDate !== undefined
        ? options.input.tenderAcceptanceUndertakingDate
        : existing.tenderAcceptanceUndertakingDate,
    minimumLocalContent:
      options.input.minimumLocalContent !== undefined
        ? options.input.minimumLocalContent
        : existing.minimumLocalContent,
    localValueAdditionLocation:
      options.input.localValueAdditionLocation !== undefined
        ? options.input.localValueAdditionLocation
        : existing.localValueAdditionLocation,
    authorizedPersonName:
      options.input.authorizedPersonName ?? existing.authorizedPersonName,
    authorizedPersonPosition:
      options.input.authorizedPersonPosition !== undefined
        ? options.input.authorizedPersonPosition
        : existing.authorizedPersonPosition,
    signatoryName: options.input.signatoryName ?? existing.signatoryName,
    signatoryDesignation:
      options.input.signatoryDesignation !== undefined
        ? options.input.signatoryDesignation
        : existing.signatoryDesignation,
    departmentName: options.input.departmentName ?? existing.departmentName,
    departmentAddress:
      options.input.departmentAddress !== undefined
        ? options.input.departmentAddress
        : existing.departmentAddress,
    companyAddress:
      options.input.companyAddress !== undefined
        ? options.input.companyAddress
        : existing.companyAddress,
    companySignatoryUrl:
      options.input.companySignatoryUrl !== undefined
        ? options.input.companySignatoryUrl
        : existing.companySignatoryUrl,
  };

  if (merged.isDefault) {
    await clearCompanyDefault(options.companyId);
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_profile_templates")
    .update({
      ...toRow(merged),
      updated_by: options.updatedBy,
    })
    .eq("id", options.id)
    .eq("company_id", options.companyId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapTemplate(data as Record<string, unknown>);
}

export async function archiveBidProfileTemplate(options: {
  companyId: string;
  id: string;
  updatedBy: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_bid_profile_templates")
    .update({
      status: "archived",
      is_default: false,
      updated_by: options.updatedBy,
    })
    .eq("id", options.id)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}

export async function setDefaultBidProfileTemplate(options: {
  companyId: string;
  id: string;
  updatedBy: string;
}): Promise<void> {
  const existing = await getBidProfileTemplate({
    companyId: options.companyId,
    id: options.id,
  });
  if (!existing || existing.status !== "active") {
    throw new Error("Template not found.");
  }
  await clearCompanyDefault(options.companyId);
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_bid_profile_templates")
    .update({
      is_default: true,
      updated_by: options.updatedBy,
    })
    .eq("id", options.id)
    .eq("company_id", options.companyId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
}

export async function duplicateBidProfileTemplate(options: {
  companyId: string;
  id: string;
  createdBy: string;
}): Promise<BidProfileTemplate> {
  const existing = await getBidProfileTemplate({
    companyId: options.companyId,
    id: options.id,
  });
  if (!existing || existing.status !== "active") {
    throw new Error("Template not found.");
  }
  return createBidProfileTemplate({
    companyId: options.companyId,
    createdBy: options.createdBy,
    input: {
      templateName: `${existing.templateName} (Copy)`,
      description: existing.description,
      isDefault: false,
      companyName: existing.companyName,
      referenceNumber: existing.referenceNumber,
      tenderAcceptanceUndertakingDate:
        existing.tenderAcceptanceUndertakingDate,
      minimumLocalContent: existing.minimumLocalContent,
      localValueAdditionLocation: existing.localValueAdditionLocation,
      authorizedPersonName: existing.authorizedPersonName,
      authorizedPersonPosition: existing.authorizedPersonPosition,
      signatoryName: existing.signatoryName,
      signatoryDesignation: existing.signatoryDesignation,
      departmentName: existing.departmentName,
      departmentAddress: existing.departmentAddress,
      companyAddress: existing.companyAddress,
      companySignatoryUrl: null,
    },
  });
}

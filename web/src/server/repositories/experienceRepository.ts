import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import type {
  CompanyExperience,
  CompanyExperienceInsert,
  CompanyExperienceUpdate,
  ExperienceProjectStatus,
} from "@/lib/experience/types";

function mapExperience(row: Record<string, unknown>): CompanyExperience {
  const projectStatus =
    row.project_status === "completed" ? "completed" : "ongoing";
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    projectName: String(row.project_name),
    clientName: String(row.client_name || ""),
    location: String(row.location || ""),
    natureOfWork: String(row.nature_of_work || ""),
    projectValueInr:
      row.project_value_inr == null ? 0 : Number(row.project_value_inr),
    projectStatus: projectStatus as ExperienceProjectStatus,
    startDate: (row.start_date as string) || null,
    endDate: (row.end_date as string) || null,
    expectedCompletionDate: (row.expected_completion_date as string) || null,
    durationMonths:
      row.duration_months == null ? null : Number(row.duration_months),
    description: (row.description as string) || null,
    contactPersonName: String(row.contact_person_name || ""),
    contactMobile: String(row.contact_mobile || ""),
    contactEmail: (row.contact_email as string) || null,
    workOrderUrl: (row.work_order_url as string) || null,
    workOrderBlobName: (row.work_order_blob_name as string) || null,
    workOrderFileName: (row.work_order_file_name as string) || null,
    completionCertificateUrl:
      (row.completion_certificate_url as string) || null,
    completionCertificateBlobName:
      (row.completion_certificate_blob_name as string) || null,
    completionCertificateFileName:
      (row.completion_certificate_file_name as string) || null,
    status: row.status === "archived" ? "archived" : "active",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toRow(input: CompanyExperienceInsert) {
  return {
    project_name: input.projectName.trim(),
    client_name: input.clientName.trim(),
    location: input.location.trim(),
    nature_of_work: input.natureOfWork.trim(),
    project_value_inr: input.projectValueInr,
    project_status: input.projectStatus,
    start_date: input.startDate,
    end_date: input.projectStatus === "completed" ? input.endDate : null,
    expected_completion_date:
      input.projectStatus === "ongoing" ? input.expectedCompletionDate : null,
    duration_months: input.durationMonths,
    description: input.description,
    contact_person_name: input.contactPersonName.trim(),
    contact_mobile: input.contactMobile.trim(),
    contact_email: input.contactEmail,
  };
}

export async function listCompanyExperience(
  companyId: string,
): Promise<CompanyExperience[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_experience")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => mapExperience(row as Record<string, unknown>));
}

export async function countCompanyExperience(companyId: string): Promise<number> {
  const supabase = getServerSupabase();
  const { count, error } = await supabase
    .from("agenttender_company_experience")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getCompanyExperienceById(options: {
  companyId: string;
  id: string;
}): Promise<CompanyExperience | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_experience")
    .select("*")
    .eq("id", options.id)
    .eq("company_id", options.companyId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapExperience(data as Record<string, unknown>) : null;
}

export async function createCompanyExperience(options: {
  companyId: string;
  createdBy: string;
  input: CompanyExperienceInsert;
}): Promise<CompanyExperience> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_experience")
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
  return mapExperience(data as Record<string, unknown>);
}

export async function updateCompanyExperience(options: {
  companyId: string;
  id: string;
  updatedBy: string;
  input: CompanyExperienceUpdate;
}): Promise<CompanyExperience> {
  const existing = await getCompanyExperienceById({
    companyId: options.companyId,
    id: options.id,
  });
  if (!existing) throw new Error("Experience record not found.");

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_experience")
    .update({
      ...toRow(options.input),
      updated_by: options.updatedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", options.id)
    .eq("company_id", options.companyId)
    .eq("status", "active")
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapExperience(data as Record<string, unknown>);
}

export async function archiveCompanyExperience(options: {
  companyId: string;
  id: string;
  updatedBy: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_company_experience")
    .update({
      status: "archived",
      work_order_url: null,
      work_order_blob_name: null,
      work_order_file_name: null,
      completion_certificate_url: null,
      completion_certificate_blob_name: null,
      completion_certificate_file_name: null,
      updated_by: options.updatedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", options.id)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}

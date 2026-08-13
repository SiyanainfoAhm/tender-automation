import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import {
  getDocumentExpiryState,
  type DocumentCategory,
  type ExpiryState,
  type VerificationStatus,
} from "@/lib/company/types";

export type CompanyDocument = {
  id: string;
  companyId: string;
  folderId: string | null;
  name: string;
  originalFileName: string | null;
  documentCategory: DocumentCategory;
  documentType: string | null;
  certificateType: string | null;
  financialYear: string | null;
  issuingAuthority: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  notes: string | null;
  storageProvider: string;
  storageContainer: string | null;
  storageBlobName: string | null;
  storageUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  verificationStatus: VerificationStatus;
  status: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  expiryState: ExpiryState;
};

export type CompanyExperience = {
  id: string;
  companyId: string;
  projectName: string;
  clientName: string | null;
  projectValueInr: number | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  createdAt: string;
};

function mapDoc(row: Record<string, unknown>): CompanyDocument {
  const expiryDate = (row.expiry_date as string) || null;
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    folderId: (row.folder_id as string) || null,
    name: String(row.name),
    originalFileName: (row.original_file_name as string) || null,
    documentCategory: row.document_category as DocumentCategory,
    documentType: (row.document_type as string) || null,
    certificateType: (row.certificate_type as string) || null,
    financialYear: (row.financial_year as string) || null,
    issuingAuthority: (row.issuing_authority as string) || null,
    issueDate: (row.issue_date as string) || null,
    expiryDate,
    notes: (row.notes as string) || null,
    storageProvider: String(row.storage_provider || "none"),
    storageContainer: (row.storage_container as string) || null,
    storageBlobName: (row.storage_blob_name as string) || null,
    storageUrl: (row.storage_url as string) || null,
    mimeType: (row.mime_type as string) || null,
    fileSizeBytes:
      row.file_size_bytes == null ? null : Number(row.file_size_bytes),
    verificationStatus: (row.verification_status as VerificationStatus) || "pending",
    status: String(row.status || "active"),
    createdBy: (row.created_by as string) || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    expiryState: getDocumentExpiryState(expiryDate),
  };
}

export async function listCompanyDocuments(options: {
  companyId: string;
  category?: string | "All";
  q?: string;
}): Promise<CompanyDocument[]> {
  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_company_documents")
    .select("*")
    .eq("company_id", options.companyId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (options.category && options.category !== "All") {
    query = query.eq("document_category", options.category);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let rows = (data || []).map((r) => mapDoc(r as Record<string, unknown>));
  const q = options.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((d) => {
      const hay = [
        d.name,
        d.originalFileName,
        d.certificateType,
        d.documentCategory,
        d.documentType,
        d.issuingAuthority,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return rows;
}

export async function countCompanyDocuments(companyId: string): Promise<number> {
  const supabase = getServerSupabase();
  const { count, error } = await supabase
    .from("agenttender_company_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function countCompanyExperience(companyId: string): Promise<number> {
  const supabase = getServerSupabase();
  const { count, error } = await supabase
    .from("agenttender_company_experience")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function listCompanyExperience(
  companyId: string,
): Promise<CompanyExperience[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_experience")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      companyId: String(r.company_id),
      projectName: String(r.project_name),
      clientName: (r.client_name as string) || null,
      projectValueInr:
        r.project_value_inr == null ? null : Number(r.project_value_inr),
      startDate: (r.start_date as string) || null,
      endDate: (r.end_date as string) || null,
      description: (r.description as string) || null,
      createdAt: String(r.created_at),
    };
  });
}

export async function listExpiringDocuments(options: {
  companyId: string;
  withinDays?: number;
}): Promise<CompanyDocument[]> {
  const docs = await listCompanyDocuments({ companyId: options.companyId });
  return docs.filter(
    (d) =>
      d.expiryState === "EXPIRING_SOON" || d.expiryState === "EXPIRED",
  );
}

export async function getCompanyDocumentById(options: {
  companyId: string;
  documentId: string;
}): Promise<CompanyDocument | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_documents")
    .select("*")
    .eq("id", options.documentId)
    .eq("company_id", options.companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapDoc(data as Record<string, unknown>) : null;
}

export async function insertCompanyDocumentMetadata(options: {
  id?: string;
  companyId: string;
  createdBy: string;
  name: string;
  originalFileName?: string | null;
  documentCategory: DocumentCategory;
  documentType?: string | null;
  certificateType?: string | null;
  financialYear?: string | null;
  issuingAuthority?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  notes?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  storageProvider?: string;
  storageContainer?: string | null;
  storageBlobName?: string | null;
  storageUrl?: string | null;
}): Promise<CompanyDocument> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_company_documents")
    .insert({
      ...(options.id ? { id: options.id } : {}),
      company_id: options.companyId,
      name: options.name.trim(),
      original_file_name: options.originalFileName ?? null,
      document_category: options.documentCategory,
      document_type: options.documentType ?? null,
      certificate_type: options.certificateType ?? null,
      financial_year: options.financialYear ?? null,
      issuing_authority: options.issuingAuthority ?? null,
      issue_date: options.issueDate || null,
      expiry_date: options.expiryDate || null,
      notes: options.notes ?? null,
      mime_type: options.mimeType ?? null,
      file_size_bytes: options.fileSizeBytes ?? null,
      storage_provider: options.storageProvider ?? "none",
      storage_container: options.storageContainer ?? null,
      storage_blob_name: options.storageBlobName ?? null,
      storage_url: options.storageUrl ?? null,
      verification_status: "pending",
      status: "active",
      created_by: options.createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapDoc(data as Record<string, unknown>);
}

export async function softDeleteCompanyDocument(options: {
  companyId: string;
  documentId: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_company_documents")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", options.documentId)
    .eq("company_id", options.companyId);
  if (error) throw new Error(error.message);
}

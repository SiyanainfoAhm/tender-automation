import "server-only";

import { getServerSupabase } from "@/lib/db/server";
import { toAccessibleStorageUrl } from "@/lib/storage/accessible-storage-url";
import {
  BID_FEE_TYPE_LABELS,
  type BidFeeRecord,
  type BidFeeStatus,
  type BidFeeType,
  type PaymentMode,
  type PaymentReference,
  type PbgStatus,
  type TenderDocumentRecord,
  type TenderDocumentSection,
} from "@/lib/bid-fees";
import { assertSupabaseOk } from "@/lib/errors/db-query";

type FeeRow = {
  id: string;
  company_id: string;
  tender_id: string;
  fee_type: BidFeeType;
  amount: number | string;
  currency: string;
  status: BidFeeStatus;
  payment_mode: PaymentMode | null;
  payment_date: string | null;
  due_date: string | null;
  refundable: boolean;
  notes: string | null;
  payment_reference: PaymentReference | null;
  bg_number: string | null;
  bank_name: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  claim_period_days: number | null;
  urn: string | null;
  pbg_status: PbgStatus | null;
  created_at: string;
  updated_at: string;
  agenttender_tenders?: {
    title?: string | null;
    source_tender_id?: string | null;
    folder_id?: string | null;
    organization?: string | null;
    qualification_status?: string | null;
  } | null;
};

type DocRow = {
  id: string;
  company_id: string;
  tender_id: string;
  section: TenderDocumentSection;
  entity_type: string | null;
  entity_id: string | null;
  fee_id: string | null;
  company_document_id: string | null;
  file_name: string;
  original_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  storage_provider: string;
  storage_url: string | null;
  created_at: string;
};

function mapFee(row: FeeRow): BidFeeRecord {
  const tender = row.agenttender_tenders;
  return {
    id: row.id,
    companyId: row.company_id,
    tenderId: row.tender_id,
    feeType: row.fee_type,
    amount: Number(row.amount) || 0,
    currency: row.currency || "INR",
    status: row.status,
    paymentMode: row.payment_mode,
    paymentDate: row.payment_date,
    dueDate: row.due_date,
    refundable: Boolean(row.refundable),
    notes: row.notes,
    paymentReference: row.payment_reference || {},
    bgNumber: row.bg_number,
    bankName: row.bank_name,
    issueDate: row.issue_date,
    expiryDate: row.expiry_date,
    claimPeriodDays: row.claim_period_days,
    urn: row.urn,
    pbgStatus: row.pbg_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tenderTitle: tender?.title ?? null,
    tenderSourceId: tender?.source_tender_id ?? null,
    tenderReference: tender?.folder_id || tender?.source_tender_id || null,
    tenderOrganization: tender?.organization ?? null,
    tenderStatus: tender?.qualification_status ?? null,
  };
}

function mapDoc(row: DocRow): TenderDocumentRecord {
  const downloadUrl = row.company_document_id
    ? `/api/documents/${row.company_document_id}?download=1`
    : toAccessibleStorageUrl(row.storage_url, {
        download: true,
        fileName: row.original_name || row.file_name,
      });
  return {
    id: row.id,
    companyId: row.company_id,
    tenderId: row.tender_id,
    section: row.section,
    entityType: row.entity_type,
    entityId: row.entity_id,
    feeId: row.fee_id,
    companyDocumentId: row.company_document_id,
    fileName: row.file_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    storageProvider: row.storage_provider,
    storageUrl: row.storage_url,
    createdAt: row.created_at,
    downloadUrl,
  };
}

const FEE_SELECT = `
  id, company_id, tender_id, fee_type, amount, currency, status,
  payment_mode, payment_date, due_date, refundable, notes, payment_reference,
  bg_number, bank_name, issue_date, expiry_date, claim_period_days, urn, pbg_status,
  created_at, updated_at,
  agenttender_tenders (
    title, source_tender_id, folder_id, organization, qualification_status
  )
`;

export async function listBidFees(options: {
  companyId: string;
  tenderId?: string;
  feeType?: BidFeeType;
  status?: BidFeeStatus;
  paymentMode?: PaymentMode;
  q?: string;
  fromDate?: string;
  toDate?: string;
  pbgOnly?: boolean;
}): Promise<BidFeeRecord[]> {
  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_bid_fees")
    .select(FEE_SELECT)
    .eq("company_id", options.companyId)
    .order("created_at", { ascending: false });

  if (options.tenderId) query = query.eq("tender_id", options.tenderId);
  if (options.feeType) query = query.eq("fee_type", options.feeType);
  if (options.status) query = query.eq("status", options.status);
  if (options.paymentMode) query = query.eq("payment_mode", options.paymentMode);
  if (options.pbgOnly) query = query.eq("fee_type", "pbg");
  if (options.fromDate) query = query.gte("payment_date", options.fromDate);
  if (options.toDate) query = query.lte("payment_date", options.toDate);

  const data = assertSupabaseOk(await query, {
    queryName: "listBidFees",
    selectedColumns: FEE_SELECT,
  }) as FeeRow[] | null;

  let rows = (data || []).map(mapFee);
  const q = options.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((row) => {
      const hay = [
        row.tenderTitle,
        row.tenderSourceId,
        row.tenderReference,
        row.tenderOrganization,
        BID_FEE_TYPE_LABELS[row.feeType],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }
  return rows;
}

export async function getBidFeeById(options: {
  companyId: string;
  feeId: string;
}): Promise<BidFeeRecord | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_bid_fees")
    .select(FEE_SELECT)
    .eq("company_id", options.companyId)
    .eq("id", options.feeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapFee(data as FeeRow) : null;
}

export type CreateBidFeeInput = {
  companyId: string;
  tenderId: string;
  feeType: BidFeeType;
  amount: number;
  status: BidFeeStatus;
  paymentMode?: PaymentMode | null;
  paymentDate?: string | null;
  dueDate?: string | null;
  refundable?: boolean;
  notes?: string | null;
  paymentReference?: PaymentReference;
  bgNumber?: string | null;
  bankName?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  claimPeriodDays?: number | null;
  urn?: string | null;
  pbgStatus?: PbgStatus | null;
  userId?: string | null;
};

export async function createBidFee(
  input: CreateBidFeeInput,
): Promise<BidFeeRecord> {
  const supabase = getServerSupabase();
  const isPbg = input.feeType === "pbg";
  const { data, error } = await supabase
    .from("agenttender_bid_fees")
    .insert({
      company_id: input.companyId,
      tender_id: input.tenderId,
      fee_type: input.feeType,
      amount: input.amount,
      status: input.status,
      payment_mode: input.paymentMode || null,
      payment_date: input.paymentDate || null,
      due_date: input.dueDate || null,
      refundable: Boolean(input.refundable),
      notes: input.notes || null,
      payment_reference: input.paymentReference || {},
      bg_number: input.bgNumber || null,
      bank_name: input.bankName || null,
      issue_date: input.issueDate || null,
      expiry_date: input.expiryDate || null,
      claim_period_days: input.claimPeriodDays ?? null,
      urn: input.urn || null,
      pbg_status: isPbg ? input.pbgStatus || "active" : null,
      created_by: input.userId || null,
      updated_by: input.userId || null,
    })
    .select(FEE_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapFee(data as FeeRow);
}

export async function updateBidFee(options: {
  companyId: string;
  feeId: string;
  patch: Partial<CreateBidFeeInput>;
  userId?: string | null;
}): Promise<BidFeeRecord> {
  const supabase = getServerSupabase();
  const p = options.patch;
  const row: Record<string, unknown> = {
    updated_by: options.userId || null,
  };
  if (p.amount != null) row.amount = p.amount;
  if (p.status) row.status = p.status;
  if (p.paymentMode !== undefined) row.payment_mode = p.paymentMode;
  if (p.paymentDate !== undefined) row.payment_date = p.paymentDate;
  if (p.dueDate !== undefined) row.due_date = p.dueDate;
  if (p.refundable != null) row.refundable = p.refundable;
  if (p.notes !== undefined) row.notes = p.notes;
  if (p.paymentReference) row.payment_reference = p.paymentReference;
  if (p.bgNumber !== undefined) row.bg_number = p.bgNumber;
  if (p.bankName !== undefined) row.bank_name = p.bankName;
  if (p.issueDate !== undefined) row.issue_date = p.issueDate;
  if (p.expiryDate !== undefined) row.expiry_date = p.expiryDate;
  if (p.claimPeriodDays !== undefined) row.claim_period_days = p.claimPeriodDays;
  if (p.urn !== undefined) row.urn = p.urn;
  if (p.pbgStatus !== undefined) row.pbg_status = p.pbgStatus;

  const { data, error } = await supabase
    .from("agenttender_bid_fees")
    .update(row)
    .eq("company_id", options.companyId)
    .eq("id", options.feeId)
    .select(FEE_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapFee(data as FeeRow);
}

export async function deleteBidFee(options: {
  companyId: string;
  feeId: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("agenttender_bid_fees")
    .delete()
    .eq("company_id", options.companyId)
    .eq("id", options.feeId);
  if (error) throw new Error(error.message);
}

export async function listTenderDocuments(options: {
  companyId: string;
  tenderId: string;
  section?: TenderDocumentSection;
  feeId?: string;
}): Promise<TenderDocumentRecord[]> {
  const supabase = getServerSupabase();
  let query = supabase
    .from("agenttender_tender_documents")
    .select("*")
    .eq("company_id", options.companyId)
    .eq("tender_id", options.tenderId)
    .order("created_at", { ascending: false });
  if (options.section) query = query.eq("section", options.section);
  if (options.feeId) query = query.eq("fee_id", options.feeId);

  const data = assertSupabaseOk(await query, {
    queryName: "listTenderDocuments",
    selectedColumns: "*",
  }) as DocRow[] | null;
  return (data || []).map(mapDoc);
}

export async function insertTenderDocument(input: {
  companyId: string;
  tenderId: string;
  section: TenderDocumentSection;
  entityType?: string | null;
  entityId?: string | null;
  feeId?: string | null;
  companyDocumentId?: string | null;
  fileName: string;
  originalName?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  storageProvider?: string;
  storageUrl?: string | null;
  userId?: string | null;
}): Promise<TenderDocumentRecord> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("agenttender_tender_documents")
    .insert({
      company_id: input.companyId,
      tender_id: input.tenderId,
      section: input.section,
      entity_type: input.entityType || null,
      entity_id: input.entityId || null,
      fee_id: input.feeId || null,
      company_document_id: input.companyDocumentId || null,
      file_name: input.fileName,
      original_name: input.originalName || input.fileName,
      mime_type: input.mimeType || null,
      file_size_bytes: input.fileSizeBytes ?? null,
      storage_provider: input.storageProvider || "azure",
      storage_url: input.storageUrl || null,
      created_by: input.userId || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapDoc(data as DocRow);
}

export async function deleteTenderDocument(options: {
  companyId: string;
  documentId: string;
}): Promise<TenderDocumentRecord | null> {
  const supabase = getServerSupabase();
  const { data: existing } = await supabase
    .from("agenttender_tender_documents")
    .select("*")
    .eq("company_id", options.companyId)
    .eq("id", options.documentId)
    .maybeSingle();
  if (!existing) return null;

  const { error } = await supabase
    .from("agenttender_tender_documents")
    .delete()
    .eq("company_id", options.companyId)
    .eq("id", options.documentId);
  if (error) throw new Error(error.message);
  return mapDoc(existing as DocRow);
}

export type BidFeeSummary = {
  byType: Record<
    BidFeeType,
    { count: number; total: number }
  >;
  totalRefundable: number;
  totalRefunded: number;
  totalNonRefundable: number;
  totalAmount: number;
};

export function summarizeBidFees(fees: BidFeeRecord[]): BidFeeSummary {
  const byType = {
    tender_fee: { count: 0, total: 0 },
    emd: { count: 0, total: 0 },
    processing: { count: 0, total: 0 },
    pbg: { count: 0, total: 0 },
    other: { count: 0, total: 0 },
  } as BidFeeSummary["byType"];

  let totalRefundable = 0;
  let totalRefunded = 0;
  let totalNonRefundable = 0;
  let totalAmount = 0;

  for (const fee of fees) {
    byType[fee.feeType].count += 1;
    byType[fee.feeType].total += fee.amount;
    totalAmount += fee.amount;
    if (fee.refundable) totalRefundable += fee.amount;
    else totalNonRefundable += fee.amount;
    if (fee.status === "refunded" || fee.status === "released") {
      totalRefunded += fee.amount;
    }
  }

  return {
    byType,
    totalRefundable,
    totalRefunded,
    totalNonRefundable,
    totalAmount,
  };
}

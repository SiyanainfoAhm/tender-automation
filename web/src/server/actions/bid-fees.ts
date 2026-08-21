"use server";

import { revalidatePath } from "next/cache";

import {
  BID_FEE_STATUSES,
  BID_FEE_TYPES,
  PAYMENT_MODES,
  PBG_STATUSES,
  isBidFeeStatus,
  isBidFeeType,
  isPaymentMode,
  type BidFeeStatus,
  type BidFeeType,
  type PaymentMode,
  type PaymentReference,
  type PbgStatus,
  type TenderDocumentSection,
} from "@/lib/bid-fees";
import { MAX_SINGLE_SHOT_UPLOAD_BYTES } from "@/lib/company/types";
import { canCreateFeeForTender } from "@/lib/tender-document-access";
import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import {
  createBidFee,
  deleteBidFee,
  deleteTenderDocument,
  getBidFeeById,
  insertTenderDocument,
  updateBidFee,
} from "@/server/repositories/bidFeeRepository";
import { getTenderById } from "@/server/repositories/tenderRepository";
import { insertTenderActivity } from "@/server/repositories/tenderActivityRepository";
import {
  invokeDocumentDelete,
  invokeDocumentUpload,
} from "@/server/storage/tenderAutomationDocumentFunctions";

export type FeeActionResult =
  | { ok: true; feeId?: string; message?: string }
  | { ok: false; error: string };

function revalidateFeePaths(tenderId: string) {
  revalidatePath("/bid-fees");
  revalidatePath("/tenders", "layout");
  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/dashboard");
}

function extensionAllowed(name: string): boolean {
  return /\.(pdf|doc|docx|xls|xlsx|png|jpe?g|webp)$/i.test(name);
}

async function uploadLinkedAttachment(options: {
  companyId: string;
  tenderId: string;
  feeId: string;
  section: TenderDocumentSection;
  file: File;
  userId: string;
  entityType?: string;
}): Promise<void> {
  if (options.file.size > MAX_SINGLE_SHOT_UPLOAD_BYTES) {
    throw new Error("File exceeds the 25 MB limit.");
  }
  if (!extensionAllowed(options.file.name)) {
    throw new Error("File type not allowed. Use PDF, Office, or image files.");
  }

  const formData = new FormData();
  formData.set("action", "upload");
  formData.set("file", options.file);
  formData.set("documentName", options.file.name);
  formData.set("name", options.file.name);
  formData.set("category", "Other");
  formData.set("uploadKind", "general");
  formData.set("documentType", "Tender Fee Attachment");
  formData.set(
    "notes",
    `tender:${options.tenderId}|fee:${options.feeId}|section:${options.section}`,
  );

  const uploaded = await invokeDocumentUpload(formData);
  if (!uploaded.success || !uploaded.documentId) {
    throw new Error(uploaded.error || "Unable to upload attachment.");
  }

  await insertTenderDocument({
    companyId: options.companyId,
    tenderId: options.tenderId,
    section: options.section,
    entityType: options.entityType || "fee",
    entityId: options.feeId,
    feeId: options.feeId,
    companyDocumentId: String(uploaded.documentId),
    fileName: options.file.name,
    originalName: options.file.name,
    mimeType: options.file.type || null,
    fileSizeBytes: options.file.size,
    storageProvider: "azure",
    userId: options.userId,
  });
}

export type CreateFeePayload = {
  tenderId: string;
  feeType: string;
  amount: number;
  status: string;
  paymentMode?: string | null;
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
  pbgStatus?: string | null;
};

export async function createBidFeeAction(
  payload: CreateFeePayload,
  attachmentNames?: string[],
): Promise<FeeActionResult> {
  try {
    const session = await requirePermissionStrict("bids.create");
    if (!isBidFeeType(payload.feeType)) {
      return { ok: false, error: "Invalid fee type." };
    }
    if (!isBidFeeStatus(payload.status)) {
      return { ok: false, error: "Invalid fee status." };
    }
    if (payload.paymentMode && !isPaymentMode(payload.paymentMode)) {
      return { ok: false, error: "Invalid payment mode." };
    }
    if (!(payload.amount >= 0) || !Number.isFinite(payload.amount)) {
      return { ok: false, error: "Amount must be zero or greater." };
    }

    const tender = await getTenderById(payload.tenderId);
    if (!tender) return { ok: false, error: "Tender not found." };
    const status = tender.tender.qualification_status as string | null;
    if (!canCreateFeeForTender(status)) {
      return {
        ok: false,
        error: "Fees can only be added from May Bid onward.",
      };
    }

    if (attachmentNames && attachmentNames.length === 0) {
      return { ok: false, error: "At least one attachment is required." };
    }

    const fee = await createBidFee({
      companyId: session.companyId,
      tenderId: payload.tenderId,
      feeType: payload.feeType as BidFeeType,
      amount: payload.amount,
      status: payload.status as BidFeeStatus,
      paymentMode: (payload.paymentMode as PaymentMode | null) || null,
      paymentDate: payload.paymentDate || null,
      dueDate: payload.dueDate || null,
      refundable: Boolean(payload.refundable),
      notes: payload.notes || null,
      paymentReference: payload.paymentReference || {},
      bgNumber: payload.bgNumber || null,
      bankName: payload.bankName || null,
      issueDate: payload.issueDate || null,
      expiryDate: payload.expiryDate || null,
      claimPeriodDays: payload.claimPeriodDays ?? null,
      urn: payload.urn || null,
      pbgStatus: (payload.pbgStatus as PbgStatus | null) || null,
      userId: session.user.id,
    });

    await insertTenderActivity({
      tenderId: payload.tenderId,
      companyId: session.companyId,
      eventType: "bid_fee_created",
      summary: `Fee recorded: ${payload.feeType}`,
      actorUserId: session.user.id,
      payload: { feeId: fee.id, amount: payload.amount },
    });

    revalidateFeePaths(payload.tenderId);
    return { ok: true, feeId: fee.id, message: "Fee created." };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to create fee.",
    };
  }
}

/** Create fee + upload attachments in one FormData request (wizard). */
export async function createBidFeeWithAttachmentsAction(
  formData: FormData,
): Promise<FeeActionResult> {
  try {
    const session = await requirePermissionStrict("bids.create");
    const tenderId = String(formData.get("tenderId") || "").trim();
    const feeType = String(formData.get("feeType") || "").trim();
    const status = String(formData.get("status") || "pending").trim();
    const amount = Number(String(formData.get("amount") || "0"));
    const paymentMode = String(formData.get("paymentMode") || "").trim() || null;
    const paymentDate = String(formData.get("paymentDate") || "").trim() || null;
    const dueDate = String(formData.get("dueDate") || "").trim() || null;
    const refundable = String(formData.get("refundable") || "") === "true";
    const notes = String(formData.get("notes") || "").trim() || null;
    const paymentReferenceRaw = String(formData.get("paymentReference") || "{}");
    let paymentReference: PaymentReference = {};
    try {
      paymentReference = JSON.parse(paymentReferenceRaw) as PaymentReference;
    } catch {
      paymentReference = {};
    }

    if (!tenderId) return { ok: false, error: "Tender is required." };
    if (!isBidFeeType(feeType)) return { ok: false, error: "Invalid fee type." };
    if (!isBidFeeStatus(status)) return { ok: false, error: "Invalid status." };
    if (!(amount >= 0) || !Number.isFinite(amount)) {
      return { ok: false, error: "Amount must be zero or greater." };
    }
    if (paymentMode && !isPaymentMode(paymentMode)) {
      return { ok: false, error: "Invalid payment mode." };
    }

    const tender = await getTenderById(tenderId);
    if (!tender) return { ok: false, error: "Tender not found." };
    if (!canCreateFeeForTender(tender.tender.qualification_status as string | null)) {
      return {
        ok: false,
        error: "Fees can only be added from May Bid onward.",
      };
    }

    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File && item.size > 0);
    if (files.length === 0) {
      return { ok: false, error: "At least one attachment is required." };
    }

    const fee = await createBidFee({
      companyId: session.companyId,
      tenderId,
      feeType: feeType as BidFeeType,
      amount,
      status: status as BidFeeStatus,
      paymentMode: paymentMode as PaymentMode | null,
      paymentDate,
      dueDate,
      refundable,
      notes,
      paymentReference,
      bgNumber: String(formData.get("bgNumber") || "").trim() || null,
      bankName: String(formData.get("bankName") || "").trim() || null,
      issueDate: String(formData.get("issueDate") || "").trim() || null,
      expiryDate: String(formData.get("expiryDate") || "").trim() || null,
      claimPeriodDays: formData.get("claimPeriodDays")
        ? Number(formData.get("claimPeriodDays"))
        : null,
      urn: String(formData.get("urn") || "").trim() || null,
      pbgStatus:
        (String(formData.get("pbgStatus") || "").trim() as PbgStatus) ||
        (feeType === "pbg" ? "active" : null),
      userId: session.user.id,
    });

    for (const file of files) {
      await uploadLinkedAttachment({
        companyId: session.companyId,
        tenderId,
        feeId: fee.id,
        section: "financial",
        file,
        userId: session.user.id,
        entityType: feeType === "pbg" ? "pbg" : "fee",
      });
    }

    await insertTenderActivity({
      tenderId,
      companyId: session.companyId,
      eventType: "bid_fee_created",
      summary: `Fee recorded with ${files.length} attachment(s)`,
      actorUserId: session.user.id,
      payload: { feeId: fee.id },
    });

    revalidateFeePaths(tenderId);
    return { ok: true, feeId: fee.id, message: "Fee saved." };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save fee.",
    };
  }
}

export async function updateBidFeeAction(
  feeId: string,
  patch: Partial<CreateFeePayload>,
): Promise<FeeActionResult> {
  try {
    const session = await requirePermissionStrict("bids.edit");
    const existing = await getBidFeeById({
      companyId: session.companyId,
      feeId,
    });
    if (!existing) return { ok: false, error: "Fee not found." };

    if (patch.feeType && !BID_FEE_TYPES.includes(patch.feeType as BidFeeType)) {
      return { ok: false, error: "Invalid fee type." };
    }
    if (patch.status && !BID_FEE_STATUSES.includes(patch.status as BidFeeStatus)) {
      return { ok: false, error: "Invalid status." };
    }
    if (
      patch.paymentMode &&
      !PAYMENT_MODES.includes(patch.paymentMode as PaymentMode)
    ) {
      return { ok: false, error: "Invalid payment mode." };
    }
    if (
      patch.pbgStatus &&
      !PBG_STATUSES.includes(patch.pbgStatus as PbgStatus)
    ) {
      return { ok: false, error: "Invalid PBG status." };
    }

    await updateBidFee({
      companyId: session.companyId,
      feeId,
      userId: session.user.id,
      patch: {
        amount: patch.amount,
        status: patch.status as BidFeeStatus | undefined,
        paymentMode: patch.paymentMode as PaymentMode | null | undefined,
        paymentDate: patch.paymentDate,
        dueDate: patch.dueDate,
        refundable: patch.refundable,
        notes: patch.notes,
        paymentReference: patch.paymentReference,
        bgNumber: patch.bgNumber,
        bankName: patch.bankName,
        issueDate: patch.issueDate,
        expiryDate: patch.expiryDate,
        claimPeriodDays: patch.claimPeriodDays,
        urn: patch.urn,
        pbgStatus: patch.pbgStatus as PbgStatus | null | undefined,
      },
    });

    revalidateFeePaths(existing.tenderId);
    return { ok: true, message: "Fee updated." };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to update fee.",
    };
  }
}

export async function attachFeeDocumentAction(
  formData: FormData,
): Promise<FeeActionResult> {
  try {
    const session = await requirePermissionStrict("bids.edit");
    const feeId = String(formData.get("feeId") || "").trim();
    const file = formData.get("file");
    if (!feeId) return { ok: false, error: "Fee is required." };
    if (!(file instanceof File) || file.size <= 0) {
      return { ok: false, error: "Choose a file to upload." };
    }

    const fee = await getBidFeeById({ companyId: session.companyId, feeId });
    if (!fee) return { ok: false, error: "Fee not found." };

    await uploadLinkedAttachment({
      companyId: session.companyId,
      tenderId: fee.tenderId,
      feeId,
      section: "financial",
      file,
      userId: session.user.id,
      entityType: fee.feeType === "pbg" ? "pbg" : "fee",
    });

    revalidateFeePaths(fee.tenderId);
    return { ok: true, message: "Attachment uploaded." };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unable to upload attachment.",
    };
  }
}

export async function uploadTenderSectionDocumentAction(
  formData: FormData,
): Promise<FeeActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    const tenderId = String(formData.get("tenderId") || "").trim();
    const section = String(formData.get("section") || "").trim() as TenderDocumentSection;
    const feeId = String(formData.get("feeId") || "").trim() || null;
    const file = formData.get("file");

    if (!tenderId) return { ok: false, error: "Tender is required." };
    if (!["tender", "bidding", "financial", "deliverable"].includes(section)) {
      return { ok: false, error: "Invalid document section." };
    }
    if (!(file instanceof File) || file.size <= 0) {
      return { ok: false, error: "Choose a file to upload." };
    }
    if (section === "financial" && !feeId) {
      return {
        ok: false,
        error: "Select or create a fee before uploading financial documents.",
      };
    }

    if (feeId) {
      await uploadLinkedAttachment({
        companyId: session.companyId,
        tenderId,
        feeId,
        section,
        file,
        userId: session.user.id,
      });
    } else {
      const uploadForm = new FormData();
      uploadForm.set("action", "upload");
      uploadForm.set("file", file);
      uploadForm.set("documentName", file.name);
      uploadForm.set("name", file.name);
      uploadForm.set(
        "category",
        section === "deliverable" ? "Other" : "General",
      );
      uploadForm.set("uploadKind", "general");
      uploadForm.set("notes", `tender:${tenderId}|section:${section}`);
      const uploaded = await invokeDocumentUpload(uploadForm);
      if (!uploaded.success || !uploaded.documentId) {
        return {
          ok: false,
          error: uploaded.error || "Unable to upload document.",
        };
      }
      await insertTenderDocument({
        companyId: session.companyId,
        tenderId,
        section,
        entityType: "manual",
        companyDocumentId: String(uploaded.documentId),
        fileName: file.name,
        originalName: file.name,
        mimeType: file.type || null,
        fileSizeBytes: file.size,
        userId: session.user.id,
      });
    }

    revalidateFeePaths(tenderId);
    return { ok: true, message: "Document uploaded." };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unable to upload document.",
    };
  }
}

export async function deleteTenderDocumentAction(
  documentId: string,
): Promise<FeeActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    const removed = await deleteTenderDocument({
      companyId: session.companyId,
      documentId,
    });
    if (!removed) return { ok: false, error: "Document not found." };

    if (removed.companyDocumentId) {
      await invokeDocumentDelete(removed.companyDocumentId).catch(() => null);
    }

    revalidateFeePaths(removed.tenderId);
    return { ok: true, message: "Document deleted." };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unable to delete document.",
    };
  }
}

export async function deleteBidFeeAction(feeId: string): Promise<FeeActionResult> {
  try {
    const session = await requirePermissionStrict("bids.edit");
    const existing = await getBidFeeById({
      companyId: session.companyId,
      feeId,
    });
    if (!existing) return { ok: false, error: "Fee not found." };
    await deleteBidFee({ companyId: session.companyId, feeId });
    revalidateFeePaths(existing.tenderId);
    return { ok: true, message: "Fee deleted." };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to delete fee.",
    };
  }
}

"use server";

import { revalidatePath } from "next/cache";

import {
  BOQ_CATEGORIES,
  BOQ_UOMS,
  WORKSPACE_DOCUMENT_STATUSES,
  type WorkspaceDocumentStatus,
} from "@/lib/bid-workspace";
import { MAX_SINGLE_SHOT_UPLOAD_BYTES } from "@/lib/company/types";
import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { insertTenderActivity } from "@/server/repositories/tenderActivityRepository";
import {
  deleteBoqItem,
  getOrCreateWorkspace,
  insertBoqItem,
  loadBidWorkspace,
  markWorkspaceSubmitted,
  updateBoqItem,
  updateProposalSection,
  updateWorkspaceDocumentStatus,
} from "@/server/repositories/bidWorkspaceRepository";
import { getTenderById } from "@/server/repositories/tenderRepository";
import { loadTenderDetail } from "@/server/tenders/load-tender-detail";
import {
  invokeWorkspaceDocumentDelete,
  invokeWorkspaceDocumentSave,
} from "@/server/storage/tenderAutomationDocumentFunctions";

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateWorkspace(tenderId: string) {
  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath(`/tenders/${tenderId}/bid-workspace`);
  revalidatePath("/tenders", "layout");
}

function parseNumber(value: string, label: string): number | { error: string } {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { error: `${label} must be a valid number.` };
  return n;
}

export async function openBidWorkspaceAction(
  tenderId: string,
): Promise<ActionResult & { workspaceId?: string }> {
  try {
    const session = await requirePermissionStrict("bids.view");
    const data = await getTenderById(tenderId);
    if (!data) return { ok: false, error: "Tender not found." };

    const created = await getOrCreateWorkspace({
      tenderId,
      companyId: session.companyId,
      userId: session.user.id,
      missingDocuments: Array.isArray(data.qualification?.missing_documents)
        ? data.qualification.missing_documents
        : [],
    });

    if (created.created) {
      await insertTenderActivity({
        tenderId,
        companyId: session.companyId,
        eventType: "workspace_created",
        summary: "Bid workspace opened",
        actorUserId: session.user.id,
      });
      revalidateWorkspace(tenderId);
    }

    return { ok: true, workspaceId: created.workspaceId };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    console.error("[bid-workspace] open failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to open bid workspace.",
    };
  }
}

async function requireEditableWorkspace(tenderId: string, permission: "bids.edit" | "bids.submit") {
  const session = await requirePermissionStrict(permission);
  const detail = await loadTenderDetail({
    tenderId,
    companyId: session.companyId,
  });
  if (!detail) throw new Error("Tender not found.");
  if (detail.qualificationStatus === "NO_GO") {
    throw new Error("This tender is marked No Bid. Editing is disabled.");
  }
  if (detail.submitted) {
    throw new Error("This bid has been marked submitted. Editing is disabled.");
  }
  const opened = await getOrCreateWorkspace({
    tenderId,
    companyId: session.companyId,
    userId: session.user.id,
    missingDocuments: detail.qualification?.missingDocuments ?? [],
  });
  return { session, detail, workspaceId: opened.workspaceId };
}

export async function saveProposalSectionAction(input: {
  tenderId: string;
  sectionId: string;
  content: string;
}): Promise<ActionResult> {
  try {
    const { session, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    await updateProposalSection({
      sectionId: input.sectionId,
      workspaceId,
      companyId: session.companyId,
      userId: session.user.id,
      content: input.content,
    });
    await insertTenderActivity({
      tenderId: input.tenderId,
      companyId: session.companyId,
      eventType: "proposal_section_saved",
      summary: "Proposal section saved",
      actorUserId: session.user.id,
    });
    revalidateWorkspace(input.tenderId);
    return { ok: true };
  } catch (error) {
    if (error instanceof CompanyAccessError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save proposal section.",
    };
  }
}

export async function saveBoqItemAction(input: {
  tenderId: string;
  itemId?: string;
  description: string;
  category: string;
  uom: string;
  quantity: string;
  unitRate: string;
  gstPercent: string;
  notes?: string;
}): Promise<ActionResult> {
  try {
    const { session, detail, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    const description = input.description.trim();
    if (!description) return { ok: false, error: "Description is required." };
    if (!(BOQ_CATEGORIES as readonly string[]).includes(input.category)) {
      return { ok: false, error: "Select a valid category." };
    }
    if (!(BOQ_UOMS as readonly string[]).includes(input.uom)) {
      return { ok: false, error: "Select a valid UOM." };
    }
    const quantity = parseNumber(input.quantity, "Quantity");
    if (typeof quantity === "object") return { ok: false, error: quantity.error };
    const unitRate = parseNumber(input.unitRate, "Unit rate");
    if (typeof unitRate === "object") return { ok: false, error: unitRate.error };
    const gstPercent = parseNumber(input.gstPercent || "0", "GST %");
    if (typeof gstPercent === "object") return { ok: false, error: gstPercent.error };
    if (gstPercent > 100) return { ok: false, error: "GST % cannot exceed 100." };

    const notes = input.notes?.trim() || null;
    if (input.itemId) {
      await updateBoqItem({
        itemId: input.itemId,
        workspaceId,
        companyId: session.companyId,
        userId: session.user.id,
        description,
        category: input.category,
        uom: input.uom,
        quantity,
        unitRate,
        gstPercent,
        notes,
      });
      await insertTenderActivity({
        tenderId: input.tenderId,
        companyId: session.companyId,
        eventType: "boq_item_updated",
        summary: "BOQ line updated",
        actorUserId: session.user.id,
      });
    } else {
      await insertBoqItem({
        workspaceId,
        companyId: session.companyId,
        tenderId: detail.id,
        userId: session.user.id,
        description,
        category: input.category,
        uom: input.uom,
        quantity,
        unitRate,
        gstPercent,
        notes,
      });
      await insertTenderActivity({
        tenderId: input.tenderId,
        companyId: session.companyId,
        eventType: "boq_item_created",
        summary: "BOQ line added",
        actorUserId: session.user.id,
      });
    }
    revalidateWorkspace(input.tenderId);
    return { ok: true };
  } catch (error) {
    if (error instanceof CompanyAccessError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save BOQ line.",
    };
  }
}

export async function deleteBoqItemAction(input: {
  tenderId: string;
  itemId: string;
}): Promise<ActionResult> {
  try {
    const { session, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    await deleteBoqItem({
      itemId: input.itemId,
      workspaceId,
      companyId: session.companyId,
      userId: session.user.id,
    });
    await insertTenderActivity({
      tenderId: input.tenderId,
      companyId: session.companyId,
      eventType: "boq_item_deleted",
      summary: "BOQ line deleted",
      actorUserId: session.user.id,
    });
    revalidateWorkspace(input.tenderId);
    return { ok: true };
  } catch (error) {
    if (error instanceof CompanyAccessError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to delete BOQ line.",
    };
  }
}

export async function uploadWorkspaceDocumentAction(formData: FormData): Promise<ActionResult> {
  try {
    const tenderId = String(formData.get("tenderId") || "").trim();
    const { session, detail, workspaceId } = await requireEditableWorkspace(
      tenderId,
      "bids.edit",
    );
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return { ok: false, error: "Choose a file to upload." };
    }
    if (file.size > MAX_SINGLE_SHOT_UPLOAD_BYTES) {
      return { ok: false, error: "File exceeds the 25 MB limit." };
    }
    const title = String(formData.get("title") || file.name).trim();
    const documentType = String(formData.get("documentType") || "Other").trim();
    const documentId = String(formData.get("documentId") || "").trim() || undefined;

    const result = await invokeWorkspaceDocumentSave({
      workspaceId,
      tenderId: detail.id,
      tenderReference: detail.sourceTenderId,
      documentId,
      documentType,
      title,
      file,
    });
    if (!result.success) {
      return { ok: false, error: result.error || "Document upload failed." };
    }
    await insertTenderActivity({
      tenderId,
      companyId: session.companyId,
      eventType: "workspace_document_uploaded",
      summary: "Workspace document uploaded",
      payload: { title },
      actorUserId: session.user.id,
    });
    revalidateWorkspace(tenderId);
    return { ok: true };
  } catch (error) {
    if (error instanceof CompanyAccessError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to upload document.",
    };
  }
}

export async function deleteWorkspaceDocumentAction(input: {
  tenderId: string;
  documentId: string;
}): Promise<ActionResult> {
  try {
    const { session } = await requireEditableWorkspace(input.tenderId, "bids.edit");
    const result = await invokeWorkspaceDocumentDelete(input.documentId);
    if (!result.success) {
      return { ok: false, error: result.error || "Unable to delete document." };
    }
    await insertTenderActivity({
      tenderId: input.tenderId,
      companyId: session.companyId,
      eventType: "workspace_document_deleted",
      summary: "Workspace document deleted",
      actorUserId: session.user.id,
    });
    revalidateWorkspace(input.tenderId);
    return { ok: true };
  } catch (error) {
    if (error instanceof CompanyAccessError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to delete document.",
    };
  }
}

export async function updateWorkspaceDocumentStatusAction(input: {
  tenderId: string;
  documentId: string;
  status: string;
}): Promise<ActionResult> {
  try {
    if (
      !(WORKSPACE_DOCUMENT_STATUSES as readonly string[]).includes(input.status)
    ) {
      return { ok: false, error: "Invalid document status." };
    }
    const { session, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    await updateWorkspaceDocumentStatus({
      documentId: input.documentId,
      workspaceId,
      companyId: session.companyId,
      userId: session.user.id,
      status: input.status as WorkspaceDocumentStatus,
    });
    revalidateWorkspace(input.tenderId);
    return { ok: true };
  } catch (error) {
    if (error instanceof CompanyAccessError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to update document status.",
    };
  }
}

export async function markBidSubmittedAction(input: {
  tenderId: string;
  submissionReference: string;
  submittedAt: string;
  notes?: string;
}): Promise<ActionResult> {
  try {
    const session = await requirePermissionStrict("bids.submit");
    const workspace = await loadBidWorkspaceForTender(input.tenderId, session.companyId);
    if (!workspace) return { ok: false, error: "Bid workspace not found." };
    if (workspace.submissionStatus === "submitted") {
      return { ok: false, error: "This bid is already marked submitted." };
    }
    if (workspace.readiness.incompleteRequired > 0) {
      return {
        ok: false,
        error: `${workspace.readiness.incompleteRequired} required item${
          workspace.readiness.incompleteRequired === 1 ? " is" : "s are"
        } still incomplete.`,
      };
    }
    const reference = input.submissionReference.trim();
    if (!reference) return { ok: false, error: "Submission reference is required." };
    const submittedAt = input.submittedAt.trim();
    if (!submittedAt) return { ok: false, error: "Submission date is required." };

    await markWorkspaceSubmitted({
      workspaceId: workspace.id,
      companyId: session.companyId,
      userId: session.user.id,
      submissionReference: reference,
      submittedAt: new Date(submittedAt).toISOString(),
      notes: input.notes?.trim() || null,
    });
    await insertTenderActivity({
      tenderId: input.tenderId,
      companyId: session.companyId,
      eventType: "bid_submitted",
      summary: "Bid marked submitted",
      payload: { submissionReference: reference },
      actorUserId: session.user.id,
    });
    revalidateWorkspace(input.tenderId);
    return { ok: true };
  } catch (error) {
    if (error instanceof CompanyAccessError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to mark bid as submitted.",
    };
  }
}

async function loadBidWorkspaceForTender(tenderId: string, companyId: string) {
  const detail = await loadTenderDetail({ tenderId, companyId });
  if (!detail?.workspaceId) return null;
  const data = await getTenderById(tenderId);
  return loadBidWorkspace({
    workspaceId: detail.workspaceId,
    companyId,
    qualification: data?.qualification ?? null,
  });
}

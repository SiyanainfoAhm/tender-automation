"use server";

import { revalidatePath } from "next/cache";

import {
  WON_DOCUMENT_CATEGORIES,
  type MarkTenderWonInput,
  type WonDocumentCategory,
  type WonExecutionStatus,
  type WonMilestoneStatus,
  type WonPaymentMode,
  type WonPbgStatus,
} from "@/lib/won-projects";
import {
  friendlyWonStatusConstraintError,
  isMilestoneStatus,
  isPaymentMode,
  parseExecutionStatus,
  parsePbgStatus,
} from "@/lib/wonTenderStatuses";
import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { getTenderDocumentById } from "@/server/repositories/bidFeeRepository";
import {
  addPaymentReceipt,
  createMilestone,
  createPayment,
  deleteMilestone,
  deletePayment,
  deleteWonProjectDocument,
  insertWonProjectDocument,
  markTenderWon,
  updateMilestone,
  updatePayment,
  updateWonProject,
} from "@/server/repositories/wonProjectRepository";

export type WonActionResult =
  | {
      ok: true;
      message?: string;
      wonProjectId?: string;
      projectCode?: string;
      documentId?: string;
      milestoneId?: string;
      paymentId?: string;
    }
  | { ok: false; error: string };

/**
 * Keep overview/PBG saves fast: only invalidate the project (+ list).
 * Use includeNav for mark-as-won where sidebar/dashboard counts change.
 */
function revalidateWonPaths(
  projectId?: string,
  tenderId?: string,
  options?: { includeNav?: boolean },
) {
  if (projectId) revalidatePath(`/won-tenders/${projectId}`);
  revalidatePath("/won-tenders");
  if (tenderId) {
    revalidatePath(`/tenders/${tenderId}`);
  }
  if (options?.includeNav) {
    revalidatePath("/", "layout");
    revalidatePath("/dashboard");
    if (tenderId) revalidatePath("/tenders", "layout");
  }
}

function accessError(error: unknown): WonActionResult {
  if (error instanceof CompanyAccessError) {
    return { ok: false, error: error.message };
  }
  const friendly = friendlyWonStatusConstraintError(error);
  if (friendly) {
    console.error("[won-projects] status constraint violation", error);
    return { ok: false, error: friendly };
  }
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected error.",
  };
}

function isDocumentCategory(value: string): value is WonDocumentCategory {
  return (WON_DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}

export async function markTenderAsWonAction(
  input: MarkTenderWonInput,
): Promise<WonActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    const tenderId = input.tenderId?.trim();
    if (!tenderId) return { ok: false, error: "Tender id is required." };
    if (!input.awardDate) return { ok: false, error: "Award date is required." };
    if (!(input.finalAwardValue >= 0) || !Number.isFinite(input.finalAwardValue)) {
      return { ok: false, error: "Final award value must be zero or greater." };
    }

    const result = await markTenderWon({
      companyId: session.companyId,
      userId: session.user.id,
      input: { ...input, tenderId },
    });
    revalidateWonPaths(result.wonProjectId, tenderId, { includeNav: true });

    return {
      ok: true,
      message: result.alreadyExisted
        ? "This tender already has a won project."
        : "Tender marked as won.",
      wonProjectId: result.wonProjectId,
      projectCode: result.projectCode,
    };
  } catch (error) {
    return accessError(error);
  }
}

export type UpdateWonProjectPayload = {
  projectId: string;
  executionStatus?: WonExecutionStatus;
  awardDate?: string;
  finalAwardValue?: number;
  poNumber?: string | null;
  poDate?: string | null;
  contractNumber?: string | null;
  contractDescription?: string | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  clientDepartment?: string | null;
  projectManagerId?: string | null;
  pbgApplicable?: boolean;
  pbgNumber?: string | null;
  pbgAmount?: number | null;
  pbgIssueDate?: string | null;
  pbgExpiryDate?: string | null;
  pbgBank?: string | null;
  pbgStatus?: WonPbgStatus | null;
  jiraProjectKey?: string | null;
  jiraUrl?: string | null;
  repositoryUrl?: string | null;
  deploymentUrl?: string | null;
  stagingUrl?: string | null;
  productionUrl?: string | null;
  developmentNotes?: string | null;
  notes?: string | null;
};

export async function updateWonProjectAction(
  payload: UpdateWonProjectPayload,
): Promise<WonActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    const projectId = payload.projectId?.trim();
    if (!projectId) return { ok: false, error: "Project id is required." };

    const patch: Record<string, unknown> = {};
    if (payload.executionStatus !== undefined) {
      const executionStatus = parseExecutionStatus(payload.executionStatus);
      if (!executionStatus) {
        return { ok: false, error: "Please select a valid status." };
      }
      patch.execution_status = executionStatus;
    }
    if (payload.awardDate !== undefined) patch.award_date = payload.awardDate;
    if (payload.finalAwardValue !== undefined) {
      patch.final_award_value = payload.finalAwardValue;
    }
    if (payload.poNumber !== undefined) patch.po_number = payload.poNumber;
    if (payload.poDate !== undefined) patch.po_date = payload.poDate || null;
    if (payload.contractNumber !== undefined) {
      patch.contract_number = payload.contractNumber;
    }
    if (payload.contractDescription !== undefined) {
      patch.contract_description = payload.contractDescription;
    }
    if (payload.contractStartDate !== undefined) {
      patch.contract_start_date = payload.contractStartDate || null;
    }
    if (payload.contractEndDate !== undefined) {
      patch.contract_end_date = payload.contractEndDate || null;
    }
    if (payload.clientDepartment !== undefined) {
      patch.client_department = payload.clientDepartment;
    }
    if (payload.projectManagerId !== undefined) {
      patch.project_manager_id = payload.projectManagerId || null;
    }

    const pbgApplicable = payload.pbgApplicable;
    if (pbgApplicable === false) {
      patch.pbg_applicable = false;
      patch.pbg_number = null;
      patch.pbg_amount = null;
      patch.pbg_issue_date = null;
      patch.pbg_expiry_date = null;
      patch.pbg_bank = null;
      patch.pbg_status = null;
    } else if (pbgApplicable === true) {
      patch.pbg_applicable = true;
      if (payload.pbgNumber !== undefined) patch.pbg_number = payload.pbgNumber;
      if (payload.pbgAmount !== undefined) {
        if (
          payload.pbgAmount == null ||
          !Number.isFinite(payload.pbgAmount) ||
          payload.pbgAmount < 0
        ) {
          return { ok: false, error: "PBG Amount is required." };
        }
        patch.pbg_amount = payload.pbgAmount;
      } else {
        return { ok: false, error: "PBG Amount is required." };
      }
      if (payload.pbgIssueDate !== undefined) {
        patch.pbg_issue_date = payload.pbgIssueDate || null;
      }
      if (payload.pbgExpiryDate !== undefined) {
        if (!payload.pbgExpiryDate) {
          return { ok: false, error: "PBG Expiry Date is required." };
        }
        patch.pbg_expiry_date = payload.pbgExpiryDate;
      } else {
        return { ok: false, error: "PBG Expiry Date is required." };
      }
      if (payload.pbgBank !== undefined) patch.pbg_bank = payload.pbgBank;

      const pbgStatus = parsePbgStatus(payload.pbgStatus);
      if (!pbgStatus) {
        return { ok: false, error: "Please select a valid status." };
      }
      patch.pbg_status = pbgStatus;
    } else {
      // pbgApplicable not in this payload — still allow partial pbg field updates
      if (payload.pbgNumber !== undefined) patch.pbg_number = payload.pbgNumber;
      if (payload.pbgAmount !== undefined) patch.pbg_amount = payload.pbgAmount;
      if (payload.pbgIssueDate !== undefined) {
        patch.pbg_issue_date = payload.pbgIssueDate || null;
      }
      if (payload.pbgExpiryDate !== undefined) {
        patch.pbg_expiry_date = payload.pbgExpiryDate || null;
      }
      if (payload.pbgBank !== undefined) patch.pbg_bank = payload.pbgBank;
      if (payload.pbgStatus !== undefined) {
        if (payload.pbgStatus == null) {
          patch.pbg_status = null;
        } else {
          const pbgStatus = parsePbgStatus(payload.pbgStatus);
          if (!pbgStatus) {
            return { ok: false, error: "Please select a valid status." };
          }
          patch.pbg_status = pbgStatus;
        }
      }
    }
    if (payload.jiraProjectKey !== undefined) {
      patch.jira_project_key = payload.jiraProjectKey;
    }
    if (payload.jiraUrl !== undefined) patch.jira_url = payload.jiraUrl;
    if (payload.repositoryUrl !== undefined) {
      patch.repository_url = payload.repositoryUrl;
    }
    if (payload.deploymentUrl !== undefined) {
      patch.deployment_url = payload.deploymentUrl;
    }
    if (payload.stagingUrl !== undefined) patch.staging_url = payload.stagingUrl;
    if (payload.productionUrl !== undefined) {
      patch.production_url = payload.productionUrl;
    }
    if (payload.developmentNotes !== undefined) {
      patch.development_notes = payload.developmentNotes;
    }
    if (payload.notes !== undefined) patch.notes = payload.notes;

    if (Object.keys(patch).length === 0) {
      return { ok: false, error: "No changes to save." };
    }

    await updateWonProject(
      projectId,
      session.companyId,
      session.user.id,
      patch,
    );
    revalidateWonPaths(projectId);
    return { ok: true, message: "Project updated." };
  } catch (error) {
    return accessError(error);
  }
}

export type SaveWonMilestonePayload = {
  projectId: string;
  milestoneId?: string;
  title: string;
  description?: string | null;
  dueDate: string;
  milestoneValue?: number | null;
  paymentLinked?: boolean;
  status?: WonMilestoneStatus;
  ownerId?: string | null;
  completedAt?: string | null;
  notes?: string | null;
};

export async function saveWonMilestoneAction(
  payload: SaveWonMilestonePayload,
): Promise<WonActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    const title = payload.title?.trim();
    if (!title) return { ok: false, error: "Milestone title is required." };
    if (!payload.dueDate) return { ok: false, error: "Due date is required." };
    if (payload.status && !isMilestoneStatus(payload.status)) {
      return { ok: false, error: "Please select a valid status." };
    }

    if (payload.milestoneId) {
      const patch: Record<string, unknown> = {
        title,
        description: payload.description ?? null,
        due_date: payload.dueDate,
        milestone_value: payload.milestoneValue ?? null,
        payment_linked: Boolean(payload.paymentLinked),
        owner_id: payload.ownerId || null,
        completed_at: payload.completedAt || null,
        notes: payload.notes ?? null,
      };
      if (payload.status) patch.status = payload.status;
      await updateMilestone({
        companyId: session.companyId,
        userId: session.user.id,
        milestoneId: payload.milestoneId,
        patch,
      });
      revalidateWonPaths(payload.projectId);
      return { ok: true, message: "Milestone updated.", milestoneId: payload.milestoneId };
    }

    const milestoneId = await createMilestone({
      companyId: session.companyId,
      userId: session.user.id,
      wonProjectId: payload.projectId,
      title,
      description: payload.description,
      dueDate: payload.dueDate,
      milestoneValue: payload.milestoneValue,
      paymentLinked: payload.paymentLinked,
      status: payload.status,
      ownerId: payload.ownerId,
      completedAt: payload.completedAt,
      notes: payload.notes,
    });
    revalidateWonPaths(payload.projectId);
    return { ok: true, message: "Milestone created.", milestoneId };
  } catch (error) {
    return accessError(error);
  }
}

export async function deleteWonMilestoneAction(options: {
  projectId: string;
  milestoneId: string;
}): Promise<WonActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    await deleteMilestone(options.milestoneId, session.companyId);
    revalidateWonPaths(options.projectId);
    return { ok: true, message: "Milestone deleted." };
  } catch (error) {
    return accessError(error);
  }
}

export type SaveWonPaymentPayload = {
  projectId: string;
  paymentId?: string;
  title: string;
  milestoneId?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  amount: number;
  dueDate: string;
  paymentMode?: WonPaymentMode | null;
  transactionReference?: string | null;
  notes?: string | null;
};

export async function saveWonPaymentAction(
  payload: SaveWonPaymentPayload,
): Promise<WonActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    const title = payload.title?.trim();
    if (!title) return { ok: false, error: "Payment title is required." };
    if (!payload.dueDate) return { ok: false, error: "Due date is required." };
    if (!(payload.amount >= 0) || !Number.isFinite(payload.amount)) {
      return { ok: false, error: "Amount must be zero or greater." };
    }
    if (payload.paymentMode && !isPaymentMode(payload.paymentMode)) {
      return { ok: false, error: "Invalid payment mode." };
    }

    if (payload.paymentId) {
      await updatePayment({
        companyId: session.companyId,
        userId: session.user.id,
        paymentId: payload.paymentId,
        patch: {
          title,
          milestone_id: payload.milestoneId || null,
          invoice_number: payload.invoiceNumber || null,
          invoice_date: payload.invoiceDate || null,
          amount: payload.amount,
          due_date: payload.dueDate,
          payment_mode: payload.paymentMode || null,
          transaction_reference: payload.transactionReference || null,
          notes: payload.notes || null,
        },
      });
      revalidateWonPaths(payload.projectId);
      return { ok: true, message: "Payment updated.", paymentId: payload.paymentId };
    }

    const paymentId = await createPayment({
      companyId: session.companyId,
      userId: session.user.id,
      wonProjectId: payload.projectId,
      title,
      milestoneId: payload.milestoneId,
      invoiceNumber: payload.invoiceNumber,
      invoiceDate: payload.invoiceDate,
      amount: payload.amount,
      dueDate: payload.dueDate,
      paymentMode: payload.paymentMode,
      transactionReference: payload.transactionReference,
      notes: payload.notes,
    });
    revalidateWonPaths(payload.projectId);
    return { ok: true, message: "Payment created.", paymentId };
  } catch (error) {
    return accessError(error);
  }
}

export type RecordWonPaymentReceivedPayload = {
  projectId: string;
  paymentId: string;
  amount: number;
  receivedDate: string;
  paymentMode: WonPaymentMode;
  transactionReference?: string | null;
  notes?: string | null;
};

export async function recordWonPaymentReceivedAction(
  payload: RecordWonPaymentReceivedPayload,
): Promise<WonActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    if (!(payload.amount > 0) || !Number.isFinite(payload.amount)) {
      return { ok: false, error: "Received amount must be greater than zero." };
    }
    if (!payload.receivedDate) {
      return { ok: false, error: "Received date is required." };
    }
    if (!isPaymentMode(payload.paymentMode)) {
      return { ok: false, error: "Invalid payment mode." };
    }

    await addPaymentReceipt({
      companyId: session.companyId,
      userId: session.user.id,
      paymentId: payload.paymentId,
      amount: payload.amount,
      receivedDate: payload.receivedDate,
      paymentMode: payload.paymentMode,
      transactionReference: payload.transactionReference,
      notes: payload.notes,
    });
    revalidateWonPaths(payload.projectId);
    return { ok: true, message: "Payment receipt recorded." };
  } catch (error) {
    return accessError(error);
  }
}

export async function deleteWonPaymentAction(options: {
  projectId: string;
  paymentId: string;
}): Promise<WonActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    await deletePayment(options.paymentId, session.companyId);
    revalidateWonPaths(options.projectId);
    return { ok: true, message: "Payment deleted." };
  } catch (error) {
    return accessError(error);
  }
}

export type UploadWonProjectDocumentPayload = {
  projectId: string;
  tenderId: string;
  tenderDocumentId: string;
  title: string;
  category: WonDocumentCategory;
  documentDate?: string | null;
  description?: string | null;
  milestoneId?: string | null;
  paymentId?: string | null;
};

export async function uploadWonProjectDocumentAction(
  payload: UploadWonProjectDocumentPayload,
): Promise<WonActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    const title = payload.title?.trim();
    if (!title) return { ok: false, error: "Document title is required." };
    if (!isDocumentCategory(payload.category)) {
      return { ok: false, error: "Invalid document category." };
    }

    const tenderDoc = await getTenderDocumentById({
      companyId: session.companyId,
      documentId: payload.tenderDocumentId,
    });
    if (!tenderDoc) {
      return { ok: false, error: "Uploaded tender document not found." };
    }
    if (tenderDoc.tenderId !== payload.tenderId) {
      return { ok: false, error: "Document does not belong to this tender." };
    }

    const documentId = await insertWonProjectDocument({
      companyId: session.companyId,
      userId: session.user.id,
      wonProjectId: payload.projectId,
      title,
      category: payload.category,
      fileName: tenderDoc.fileName,
      originalName: tenderDoc.originalName,
      mimeType: tenderDoc.mimeType,
      fileSizeBytes: tenderDoc.fileSizeBytes,
      storageUrl: tenderDoc.storageUrl,
      tenderDocumentId: tenderDoc.id,
      documentDate: payload.documentDate,
      description: payload.description,
      milestoneId: payload.milestoneId,
      paymentId: payload.paymentId,
    });
    revalidateWonPaths(payload.projectId, payload.tenderId);
    return { ok: true, message: "Document added.", documentId };
  } catch (error) {
    return accessError(error);
  }
}

export async function deleteWonProjectDocumentAction(options: {
  projectId: string;
  documentId: string;
}): Promise<WonActionResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    await deleteWonProjectDocument(options.documentId, session.companyId);
    revalidateWonPaths(options.projectId);
    return { ok: true, message: "Document deleted." };
  } catch (error) {
    return accessError(error);
  }
}

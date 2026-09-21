"use server";

import { revalidatePath } from "next/cache";

import {
  BOQ_CATEGORIES,
  BOQ_UOMS,
  WORKSPACE_DOCUMENT_STATUSES,
  toUserFacingChecklistPrepError,
  type WorkspaceDocumentStatus,
} from "@/lib/bid-workspace";
import {
  BID_AI_PROMPT_CATALOG,
  isBidAiPromptKey,
  promptKeyForChecklistCategory,
  type BidAiPromptKey,
} from "@/lib/bid-ai-prompts";
import { MAX_SINGLE_SHOT_UPLOAD_BYTES } from "@/lib/company/types";
import { getServerSupabase } from "@/lib/db/server";
import {
  CLASSIFICATION_DECISION_LABELS,
  CLASSIFICATION_REQUIRED_ACTIONS,
} from "@/lib/tender-classification";
import { resolveTenderArtifactUrls } from "@/lib/tenders/resolve-document-urls";
import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { insertTenderActivity } from "@/server/repositories/tenderActivityRepository";
import {
  resetWorkspaceAiPromptOverride,
  resolveEffectivePromptTemplate,
  saveWorkspaceAiPromptOverride,
} from "@/server/repositories/bidAiPromptRepository";
import {
  clearChecklistLinksForDeletedDocument,
  archiveManualChecklistItem,
  countLinkedDocumentsForChecklistItem,
  createManualChecklistItem,
  rematchChecklistItems,
  setChecklistCompletionState,
  setChecklistManualMatch,
  updateManualChecklistItem,
} from "@/server/repositories/bidChecklistRepository";
import {
  deleteBoqItem,
  getOrCreateWorkspace,
  insertBoqItem,
  loadBidWorkspace,
  markWorkspaceSubmitted,
  setChecklistPreparationStatus,
  tryClaimChecklistPreparation,
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
  revalidatePath("/submitted-tenders");
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
    const checklistItemId =
      String(formData.get("checklistItemId") || "").trim() || undefined;

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

    const savedDocumentId = String(
      result.workspaceDocumentId || result.documentId || "",
    );
    if (checklistItemId && savedDocumentId) {
      await setChecklistManualMatch({
        itemId: checklistItemId,
        workspaceId,
        companyId: session.companyId,
        workspaceDocumentId: savedDocumentId,
      });
    }

    await insertTenderActivity({
      tenderId,
      companyId: session.companyId,
      eventType: "workspace_document_uploaded",
      summary: "Workspace document uploaded",
      payload: { title, checklistItemId: checklistItemId || null },
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
    const { session, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    await clearChecklistLinksForDeletedDocument({
      workspaceId,
      companyId: session.companyId,
      documentId: input.documentId,
    });
    const result = await invokeWorkspaceDocumentDelete(input.documentId);
    if (!result.success) {
      return { ok: false, error: result.error || "Unable to delete document." };
    }
    const workspace = await loadBidWorkspace({
      workspaceId,
      companyId: session.companyId,
    });
    if (workspace) {
      await rematchChecklistItems({
        workspaceId,
        companyId: session.companyId,
        workspaceDocuments: workspace.documents,
      });
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
    const tender = await getTenderById(input.tenderId);
    const qualification = String(
      tender?.tender.qualification_status || "",
    ).toUpperCase();
    if (
      qualification === "SUBMITTED" ||
      qualification === "WON" ||
      qualification === "LOST" ||
      qualification === "CANCELLED"
    ) {
      return {
        ok: false,
        error: "This tender is already submitted or has a later outcome.",
      };
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

    const supabase = getServerSupabase();
    // Keep list/dashboard Submitted counts in sync (not workspace-only).
    await supabase
      .from("agenttender_tenders")
      .update({
        qualification_status: "SUBMITTED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.tenderId);

    // qualification_results can still hold Will Bid / GO. Detail and analysis
    // read that row, so replace it once the bid is submitted.
    await supabase
      .from("agenttender_qualification_results")
      .update({
        status: "SUBMITTED",
        decision_label: CLASSIFICATION_DECISION_LABELS.SUBMITTED,
        required_action: CLASSIFICATION_REQUIRED_ACTIONS.SUBMITTED,
      })
      .eq("tender_id", input.tenderId);

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

export type IngestTenderDocumentsResult =
  | {
      ok: true;
      engine: "openai" | "heuristic" | "needs_ai";
      checklistCount: number;
      annexureCount: number;
      costItemCount: number;
      sourceFileCount: number;
      warning?: string;
      summary?: string | null;
    }
  | { ok: false; error: string };

/**
 * Document Ingestion Service entrypoint for Bid Workspace "Use AI".
 *
 * Tender Source Documents → Ingestion → OpenAI/extraction →
 * Structured Results (Checklist / Annexures / Cost Items) →
 * Company Document Matching → Bid Workspace UI.
 *
 * Uses preparation-status locking so concurrent tabs cannot double-run AI.
 */
export async function ingestTenderDocumentsAction(
  tenderId: string,
  options?: { force?: boolean; alreadyClaimed?: boolean },
): Promise<IngestTenderDocumentsResult> {
  let claimed = options?.alreadyClaimed === true;
  let workspaceId: string | null = null;
  let companyId: string | null = null;
  try {
    const session = await requirePermissionStrict("bids.edit");
    companyId = session.companyId;
    const data = await getTenderById(tenderId);
    if (!data) return { ok: false, error: "Tender not found." };

    const workspace = await loadBidWorkspaceForTender(
      tenderId,
      session.companyId,
    );
    if (!workspace) {
      return {
        ok: false,
        error: "Open the bid workspace once before running document ingestion.",
      };
    }
    workspaceId = workspace.id;

    if (!options?.alreadyClaimed) {
      const claim = await tryClaimChecklistPreparation({
        workspaceId: workspace.id,
        companyId: session.companyId,
      });
      if (!claim.claimed) {
        if (claim.status === "PROCESSING") {
          return {
            ok: false,
            error:
              "Bid Workspace preparation is already running. Please wait for it to finish.",
          };
        }
        // Deliberate Use AI on READY/FAILED: take the lock.
        await setChecklistPreparationStatus({
          workspaceId: workspace.id,
          companyId: session.companyId,
          status: "PROCESSING",
        });
        claimed = true;
      } else {
        claimed = true;
      }
    }

    const [{ resolveTenderSourceDocuments }, checklistPrompt, costPrompt] =
      await Promise.all([
        import("@/server/ingestion/resolveTenderSourceDocuments"),
        resolveEffectivePromptTemplate({
          workspaceId: workspace.id,
          promptKey: "CHECKLIST_CREATION",
        }),
        resolveEffectivePromptTemplate({
          workspaceId: workspace.id,
          promptKey: "COST_ESTIMATOR",
        }),
      ]);
    const sources = await resolveTenderSourceDocuments({
      tenderId,
      companyId: session.companyId,
      workspaceId: workspace.id,
      documentsZipUrl: resolveTenderArtifactUrls({
        document_urls: data.tender.document_urls,
        documents_zip_url: data.tender.documents_zip_url,
      }).documentsZipUrl,
    });

    if (!sources.length) {
      await setChecklistPreparationStatus({
        workspaceId: workspace.id,
        companyId: session.companyId,
        status: "FAILED",
        error:
          "No tender source documents found. Download the portal archive or upload PDF/ZIP/DOCX/XLSX first.",
      });
      return {
        ok: false,
        error:
          "No tender source documents found. Download the portal archive or upload PDF/ZIP/DOCX/XLSX first.",
      };
    }

    const { runTenderDocumentIngestion } = await import(
      "@/server/ingestion/runTenderDocumentIngestion"
    );
    const result = await runTenderDocumentIngestion({
      workspaceId: workspace.id,
      companyId: session.companyId,
      tenderId,
      userId: session.user.id,
      documentUrls: sources.map((s) => ({
        fileName: s.fileName,
        url: s.url,
      })),
      workspaceDocuments: workspace.documents,
      checklistPromptTemplate: checklistPrompt.template,
      costPromptTemplate: costPrompt.template,
    });

    await setChecklistPreparationStatus({
      workspaceId: workspace.id,
      companyId: session.companyId,
      status: "READY",
    });

    await insertTenderActivity({
      tenderId,
      companyId: session.companyId,
      eventType: "document_ingestion",
      summary: `Document ingestion (${result.engine}): ${result.structured.checklist.length} checklist, ${result.structured.annexures.length} annexures, ${result.structured.cost_items.length} cost items`,
      payload: {
        engine: result.engine,
        sources: sources.map((s) => ({
          fileName: s.fileName,
          origin: s.origin,
        })),
        sourceFiles: result.sourceFiles,
        warning: result.warning || null,
        promptKeys: ["CHECKLIST_CREATION", "COST_ESTIMATOR"],
      },
      actorUserId: session.user.id,
    });

    revalidateWorkspace(tenderId);
    return {
      ok: true,
      engine: result.engine,
      checklistCount: result.structured.checklist.length,
      annexureCount: result.structured.annexures.length,
      costItemCount: result.structured.cost_items.length,
      sourceFileCount: result.sourceFiles.length,
      warning: result.warning,
      summary: result.structured.summary,
    };
  } catch (error) {
    const rawMessage =
      error instanceof Error
        ? error.message
        : "Unable to ingest tender documents.";
    if (claimed && workspaceId && companyId) {
      await setChecklistPreparationStatus({
        workspaceId,
        companyId,
        status: "FAILED",
        error: rawMessage,
      }).catch(() => undefined);
    }
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    console.error("[bid-workspace] document ingestion failed", error);
    return {
      ok: false,
      error: toUserFacingChecklistPrepError(rawMessage),
    };
  }
}

/**
 * First-open WILL_BID (GO) initialization: claim lock and run AI once.
 * Concurrent tabs that lose the claim should poll until READY/FAILED.
 */
export async function ensureWillBidWorkspacePreparedAction(
  tenderId: string,
): Promise<
  | { ok: true; status: "READY" | "PROCESSING" | "ALREADY_READY"; skipped?: boolean }
  | { ok: false; error: string; status?: "FAILED" }
> {
  try {
    const session = await requirePermissionStrict("bids.edit");
    const data = await getTenderById(tenderId);
    if (!data) return { ok: false, error: "Tender not found." };
    if (data.tender.qualification_status !== "GO") {
      return { ok: true, status: "ALREADY_READY", skipped: true };
    }

    const workspace = await loadBidWorkspaceForTender(
      tenderId,
      session.companyId,
    );
    if (!workspace) {
      return { ok: false, error: "Workspace not found." };
    }

    if (workspace.checklistPreparationStatus === "READY") {
      return { ok: true, status: "ALREADY_READY", skipped: true };
    }
    if (workspace.checklistPreparationStatus === "PROCESSING") {
      return { ok: true, status: "PROCESSING" };
    }

    const claim = await tryClaimChecklistPreparation({
      workspaceId: workspace.id,
      companyId: session.companyId,
    });
    if (!claim.claimed) {
      if (claim.status === "READY") {
        return { ok: true, status: "ALREADY_READY", skipped: true };
      }
      return { ok: true, status: "PROCESSING" };
    }

    const result = await ingestTenderDocumentsAction(tenderId, {
      force: true,
      alreadyClaimed: true,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: toUserFacingChecklistPrepError(result.error),
        status: "FAILED",
      };
    }
    return { ok: true, status: "READY" };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message, status: "FAILED" };
    }
    return {
      ok: false,
      error: toUserFacingChecklistPrepError(
        error instanceof Error
          ? error.message
          : "Unable to prepare Bid Workspace.",
      ),
      status: "FAILED",
    };
  }
}

export async function getChecklistPreparationStatusAction(
  tenderId: string,
): Promise<
  | {
      ok: true;
      status: "NOT_STARTED" | "PROCESSING" | "READY" | "FAILED";
      error: string | null;
    }
  | { ok: false; error: string }
> {
  try {
    const session = await requirePermissionStrict("bids.view");
    const workspace = await loadBidWorkspaceForTender(
      tenderId,
      session.companyId,
    );
    if (!workspace) return { ok: false, error: "Workspace not found." };
    return {
      ok: true,
      status: workspace.checklistPreparationStatus,
      error: workspace.checklistPreparationError,
    };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to read preparation status.",
    };
  }
}

export type GenerateChecklistDocumentActionResult =
  | {
      ok: true;
      documentId: string;
      fileName: string;
      title: string;
      versionLabel: string;
      documentType: string;
      fileSizeBytes: number;
      missingInformation: string[];
      warnings: string[];
    }
  | { ok: false; error: string };

/**
 * Per-item AI drafting: Generate with AI on a checklist requirement.
 * Saves ONLY as a tender workspace document (never company library).
 */
export async function generateChecklistDocumentAction(input: {
  tenderId: string;
  requirementId: string;
  customInstructions?: string;
}): Promise<GenerateChecklistDocumentActionResult> {
  try {
    const { session, detail, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );

    const supabase = getServerSupabase();
    const { data: requirement, error: reqError } = await supabase
      .from("agenttender_bid_checklist_items")
      .select("id, category")
      .eq("id", input.requirementId)
      .eq("workspace_id", workspaceId)
      .eq("company_id", session.companyId)
      .maybeSingle();
    if (reqError) throw new Error(reqError.message);
    if (!requirement) {
      return { ok: false, error: "Checklist requirement not found." };
    }

    const categoryPromptKey = promptKeyForChecklistCategory(
      String(requirement.category || "TECHNICAL"),
    );
    const [categoryPrompt, itemPrompt] = await Promise.all([
      resolveEffectivePromptTemplate({
        workspaceId,
        promptKey: categoryPromptKey,
      }),
      resolveEffectivePromptTemplate({
        workspaceId,
        promptKey: "CHECKLIST_ITEM_DOCUMENT",
      }),
    ]);

    const { generateChecklistDocument } = await import(
      "@/server/generation/generateChecklistDocument"
    );

    const result = await generateChecklistDocument({
      companyId: session.companyId,
      userId: session.user.id,
      workspaceId,
      tenderId: detail.id,
      tenderReference: detail.sourceTenderId || detail.referenceNo || detail.id,
      requirementId: input.requirementId,
      customInstructions: input.customInstructions || null,
      adminCustomPrompt: categoryPrompt.template,
      itemPromptTemplate: itemPrompt.template,
    });

    await insertTenderActivity({
      tenderId: input.tenderId,
      companyId: session.companyId,
      eventType: "checklist_document_generated",
      summary: `AI draft generated: ${result.fileName}`,
      payload: {
        requirementId: input.requirementId,
        documentId: result.documentId,
        fileName: result.fileName,
        versionLabel: result.versionLabel,
        model: result.model,
        generationPolicy: result.generationPolicy,
        fileSizeBytes: result.fileSizeBytes,
        promptKeys: [categoryPromptKey, "CHECKLIST_ITEM_DOCUMENT"],
      },
      actorUserId: session.user.id,
    });

    revalidateWorkspace(input.tenderId);
    return {
      ok: true,
      documentId: result.documentId,
      fileName: result.fileName,
      title: result.title,
      versionLabel: result.versionLabel,
      documentType: result.documentType,
      fileSizeBytes: result.fileSizeBytes,
      missingInformation: result.missingInformation,
      warnings: result.warnings,
    };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    console.error("[bid-workspace] checklist document generation failed", error);
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Document generation failed.",
    };
  }
}

export type BidAiPromptActionResult =
  | {
      ok: true;
      promptKey: BidAiPromptKey;
      template: string;
      defaultTemplate: string;
      isCustom: boolean;
      updatedAt: string | null;
      label: string;
    }
  | { ok: false; error: string };

export async function getBidAiPromptAction(input: {
  tenderId: string;
  promptKey: string;
}): Promise<BidAiPromptActionResult> {
  try {
    if (!isBidAiPromptKey(input.promptKey)) {
      return { ok: false, error: "Unknown prompt key." };
    }
    const session = await requirePermissionStrict("bids.view");
    const workspace = await loadBidWorkspaceForTender(
      input.tenderId,
      session.companyId,
    );
    if (!workspace) return { ok: false, error: "Bid workspace not found." };

    const resolved = await resolveEffectivePromptTemplate({
      workspaceId: workspace.id,
      promptKey: input.promptKey,
    });
    return {
      ok: true,
      promptKey: input.promptKey,
      template: resolved.template,
      defaultTemplate: resolved.defaultTemplate,
      isCustom: resolved.isCustom,
      updatedAt: resolved.updatedAt,
      label: BID_AI_PROMPT_CATALOG[input.promptKey].label,
    };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to load prompt.",
    };
  }
}

export async function saveBidAiPromptAction(input: {
  tenderId: string;
  promptKey: string;
  template: string;
}): Promise<BidAiPromptActionResult> {
  try {
    if (!isBidAiPromptKey(input.promptKey)) {
      return { ok: false, error: "Unknown prompt key." };
    }
    const { session, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    const saved = await saveWorkspaceAiPromptOverride({
      workspaceId,
      companyId: session.companyId,
      userId: session.user.id,
      promptKey: input.promptKey,
      template: input.template,
    });
    revalidateWorkspace(input.tenderId);
    return {
      ok: true,
      promptKey: input.promptKey,
      template: saved.template,
      defaultTemplate: BID_AI_PROMPT_CATALOG[input.promptKey].defaultTemplate,
      isCustom: true,
      updatedAt: new Date().toISOString(),
      label: BID_AI_PROMPT_CATALOG[input.promptKey].label,
    };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save prompt.",
    };
  }
}

export async function resetBidAiPromptAction(input: {
  tenderId: string;
  promptKey: string;
}): Promise<BidAiPromptActionResult> {
  try {
    if (!isBidAiPromptKey(input.promptKey)) {
      return { ok: false, error: "Unknown prompt key." };
    }
    const { session, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    const reset = await resetWorkspaceAiPromptOverride({
      workspaceId,
      companyId: session.companyId,
      userId: session.user.id,
      promptKey: input.promptKey,
    });
    revalidateWorkspace(input.tenderId);
    return {
      ok: true,
      promptKey: input.promptKey,
      template: reset.template,
      defaultTemplate: reset.template,
      isCustom: false,
      updatedAt: null,
      label: BID_AI_PROMPT_CATALOG[input.promptKey].label,
    };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to reset prompt.",
    };
  }
}

export async function toggleChecklistItemCompleteAction(input: {
  tenderId: string;
  itemId: string;
  completed: boolean;
}): Promise<ActionResult> {
  try {
    const { session, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    await setChecklistCompletionState({
      itemId: input.itemId,
      workspaceId,
      companyId: session.companyId,
      completed: input.completed,
      userId: session.user.id,
    });
    revalidateWorkspace(input.tenderId);
    return { ok: true };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to update checklist item.",
    };
  }
}

export type AddChecklistRequirementResult =
  | {
      ok: true;
      itemId: string;
      uploadFailed?: boolean;
      uploadError?: string;
    }
  | { ok: false; error: string };

const DESTINATION_SECTIONS = new Set([
  "prequalification",
  "technical",
  "annexures",
]);

export async function addChecklistRequirementAction(
  formData: FormData,
): Promise<AddChecklistRequirementResult> {
  try {
    const tenderId = String(formData.get("tenderId") || "").trim();
    const { session, detail, workspaceId } = await requireEditableWorkspace(
      tenderId,
      "bids.edit",
    );

    const title = String(formData.get("title") || "").trim();
    const sectionRaw = String(formData.get("section") || "").trim();
    const category = String(formData.get("category") || "").trim() || null;
    const description =
      String(formData.get("description") || "").trim() || null;
    const sourceReference =
      String(formData.get("sourceReference") || "").trim() || null;
    const file = formData.get("file");

    if (!title) return { ok: false, error: "Requirement title is required." };
    if (!DESTINATION_SECTIONS.has(sectionRaw)) {
      return {
        ok: false,
        error: "Choose Pre-Qualification, Technical, or Annexure.",
      };
    }

    const created = await createManualChecklistItem({
      workspaceId,
      companyId: session.companyId,
      tenderId: detail.id,
      userId: session.user.id,
      title,
      section: sectionRaw as "prequalification" | "technical" | "annexures",
      category,
      description,
      sourceReference,
    });

    let uploadFailed = false;
    let uploadError: string | undefined;

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_SINGLE_SHOT_UPLOAD_BYTES) {
        uploadFailed = true;
        uploadError = "File exceeds the 25 MB limit.";
      } else {
        try {
          const result = await invokeWorkspaceDocumentSave({
            workspaceId,
            tenderId: detail.id,
            tenderReference: detail.sourceTenderId,
            documentType: category || "Other",
            title: title || file.name,
            file,
          });
          if (!result.success) {
            uploadFailed = true;
            uploadError = result.error || "Document upload failed.";
          } else {
            const savedDocumentId = String(
              result.workspaceDocumentId || result.documentId || "",
            );
            if (!savedDocumentId) {
              uploadFailed = true;
              uploadError = "Document uploaded but could not be linked.";
            } else {
              await setChecklistManualMatch({
                itemId: created.id,
                workspaceId,
                companyId: session.companyId,
                workspaceDocumentId: savedDocumentId,
              });
            }
          }
        } catch (error) {
          uploadFailed = true;
          uploadError =
            error instanceof Error ? error.message : "Document upload failed.";
        }
      }
    }

    await insertTenderActivity({
      tenderId: detail.id,
      companyId: session.companyId,
      eventType: "checklist_requirement_added",
      summary: `Manual requirement added: ${title}`,
      payload: {
        itemId: created.id,
        section: sectionRaw,
        category,
        uploadFailed,
      },
      actorUserId: session.user.id,
    });

    revalidateWorkspace(tenderId);
    return {
      ok: true,
      itemId: created.id,
      uploadFailed: uploadFailed || undefined,
      uploadError,
    };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to add requirement.",
    };
  }
}

export async function updateChecklistRequirementAction(input: {
  tenderId: string;
  itemId: string;
  title: string;
  section: string;
  category?: string | null;
  description?: string | null;
  sourceReference?: string | null;
}): Promise<ActionResult> {
  try {
    const { session, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    if (!DESTINATION_SECTIONS.has(input.section)) {
      return { ok: false, error: "Choose a valid destination section." };
    }
    await updateManualChecklistItem({
      itemId: input.itemId,
      workspaceId,
      companyId: session.companyId,
      userId: session.user.id,
      title: input.title,
      section: input.section as "prequalification" | "technical" | "annexures",
      category: input.category,
      description: input.description,
      sourceReference: input.sourceReference,
    });
    await insertTenderActivity({
      tenderId: input.tenderId,
      companyId: session.companyId,
      eventType: "checklist_requirement_updated",
      summary: `Manual requirement updated: ${input.title.trim()}`,
      payload: { itemId: input.itemId, section: input.section },
      actorUserId: session.user.id,
    });
    revalidateWorkspace(input.tenderId);
    return { ok: true };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to update requirement.",
    };
  }
}

export type DeleteChecklistRequirementResult =
  | { ok: true; linkedDocumentCount: number }
  | { ok: false; error: string; linkedDocumentCount?: number };

export async function previewDeleteChecklistRequirementAction(input: {
  tenderId: string;
  itemId: string;
}): Promise<DeleteChecklistRequirementResult> {
  try {
    const { workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    const linkedDocumentCount = await countLinkedDocumentsForChecklistItem({
      itemId: input.itemId,
      workspaceId,
    });
    return { ok: true, linkedDocumentCount };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to check linked documents.",
    };
  }
}

export async function deleteChecklistRequirementAction(input: {
  tenderId: string;
  itemId: string;
}): Promise<DeleteChecklistRequirementResult> {
  try {
    const { session, workspaceId } = await requireEditableWorkspace(
      input.tenderId,
      "bids.edit",
    );
    const result = await archiveManualChecklistItem({
      itemId: input.itemId,
      workspaceId,
      companyId: session.companyId,
      userId: session.user.id,
    });
    await insertTenderActivity({
      tenderId: input.tenderId,
      companyId: session.companyId,
      eventType: "checklist_requirement_deleted",
      summary: "Manual requirement removed",
      payload: {
        itemId: input.itemId,
        linkedDocumentCount: result.linkedDocumentCount,
      },
      actorUserId: session.user.id,
    });
    revalidateWorkspace(input.tenderId);
    return { ok: true, linkedDocumentCount: result.linkedDocumentCount };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to delete requirement.",
    };
  }
}

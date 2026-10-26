"use server";

import { revalidatePath } from "next/cache";

import { getServerSupabase } from "@/lib/db/server";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { insertTenderActivity } from "@/server/repositories/tenderActivityRepository";
import { loadTenderDetail } from "@/server/tenders/load-tender-detail";

export type ChecklistWorkCategory = "company" | "ai" | "manual";

const CATEGORY_CONFIG: Record<
  ChecklistWorkCategory,
  {
    requirementKind: "EXISTING_EVIDENCE" | "TEMPLATE_OR_DRAFT" | "MANUAL_ACTION";
    generationAllowed: boolean;
    label: string;
  }
> = {
  company: {
    requirementKind: "EXISTING_EVIDENCE",
    generationAllowed: false,
    label: "Company Docs",
  },
  ai: {
    requirementKind: "TEMPLATE_OR_DRAFT",
    generationAllowed: true,
    label: "AI Draft",
  },
  manual: {
    requirementKind: "MANUAL_ACTION",
    generationAllowed: false,
    label: "Manual",
  },
};

function resolveCategory(
  processingType: unknown,
  generationAllowed: unknown,
): ChecklistWorkCategory {
  const type = String(processingType || "").toUpperCase();
  if (type === "COMPANY_DOC" || type === "COMPANY_DOCUMENT") return "company";
  if (type === "AI_DRAFT") return "ai";
  if (type === "MANUAL_ENTRY" || type === "MANUAL") return "manual";
  return generationAllowed === true ? "ai" : "manual";
}

export async function changeChecklistWorkCategoryAction(input: {
  tenderId: string;
  itemId: string;
  category: ChecklistWorkCategory;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!(input.category in CATEGORY_CONFIG)) {
      return { ok: false, error: "Choose a valid checklist category." };
    }

    const session = await requirePermissionStrict("bids.edit");
    const detail = await loadTenderDetail({
      tenderId: input.tenderId,
      companyId: session.companyId,
    });

    if (!detail) return { ok: false, error: "Tender not found." };
    if (detail.qualificationStatus === "NO_GO") {
      return { ok: false, error: "This tender is marked No Bid. Editing is disabled." };
    }
    if (detail.submitted) {
      return { ok: false, error: "This bid has been marked submitted. Editing is disabled." };
    }
    if (!detail.workspaceId) {
      return { ok: false, error: "Bid workspace not found." };
    }

    const db = getServerSupabase();
    const { data: item, error: itemError } = await db
      .from("agenttender_bid_checklist_items")
      .select(
        "id, requirement_name, requirement_kind, processing_type, generation_allowed",
      )
      .eq("id", input.itemId)
      .eq("workspace_id", detail.workspaceId)
      .eq("company_id", session.companyId)
      .eq("is_archived", false)
      .maybeSingle();

    if (itemError) throw new Error(itemError.message);
    if (!item) return { ok: false, error: "Checklist item not found." };

    const previousCategory = resolveCategory(
      item.processing_type,
      item.generation_allowed,
    );
    if (previousCategory === input.category) return { ok: true };

    const next = CATEGORY_CONFIG[input.category];

    // processing_type is a PostgreSQL GENERATED ALWAYS column. Do not update it
    // directly. Its value is derived automatically from requirement_kind and
    // generation_allowed:
    //   EXISTING_EVIDENCE                       -> COMPANY_DOC
    //   TEMPLATE_OR_DRAFT + generation_allowed -> AI_DRAFT
    //   MANUAL_ACTION                           -> MANUAL_ENTRY
    const { data: updated, error: updateError } = await db
      .from("agenttender_bid_checklist_items")
      .update({
        requirement_kind: next.requirementKind,
        generation_allowed: next.generationAllowed,
        updated_by: session.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.itemId)
      .eq("workspace_id", detail.workspaceId)
      .eq("company_id", session.companyId)
      .select("processing_type")
      .maybeSingle();

    if (updateError) throw new Error(updateError.message);
    if (!updated) return { ok: false, error: "Checklist item could not be updated." };

    const expectedProcessingType =
      input.category === "company"
        ? "COMPANY_DOC"
        : input.category === "ai"
          ? "AI_DRAFT"
          : "MANUAL_ENTRY";

    if (String(updated.processing_type || "") !== expectedProcessingType) {
      throw new Error("Checklist category did not update correctly. Please try again.");
    }

    await insertTenderActivity({
      tenderId: input.tenderId,
      companyId: session.companyId,
      eventType: "checklist_work_category_changed",
      summary: `Checklist item moved to ${next.label}`,
      payload: {
        requirementId: input.itemId,
        requirementName: item.requirement_name,
        fromCategory: previousCategory,
        toCategory: input.category,
        previousRequirementKind: item.requirement_kind,
        requirementKind: next.requirementKind,
        processingType: updated.processing_type,
      },
      actorUserId: session.user.id,
    });

    revalidatePath(`/tenders/${input.tenderId}`);
    revalidatePath(`/tenders/${input.tenderId}/bid-workspace`);
    revalidatePath("/will-bid");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to move checklist item.",
    };
  }
}

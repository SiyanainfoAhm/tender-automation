"use server";

import { revalidatePath } from "next/cache";

import { isProjectCategory } from "@/lib/project-category";
import {
  normalizeTenderCity,
  stripLocationDecorators,
} from "@/lib/normalize-tender-city";
import { TENDER_STATUSES, type TenderStatus } from "@/lib/tender-status";
import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { getServerSupabase } from "@/lib/db/server";
import { insertTenderActivity } from "@/server/repositories/tenderActivityRepository";
import { getTenderById } from "@/server/repositories/tenderRepository";
import {
  CLASSIFICATION_DECISION_LABELS,
  CLASSIFICATION_REQUIRED_ACTIONS,
} from "@/lib/tender-classification";

export type UpdateTenderResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type UpdateTenderPayload = {
  tenderId: string;
  title?: string;
  referenceNo?: string;
  portal?: "TENDER247" | "BIDASSIST" | "MANUAL";
  portalLink?: string | null;
  category?: string | null;
  tenderType?: string | null;
  organization?: string | null;
  department?: string | null;
  location?: string | null;
  publishedDate?: string | null;
  closingDate?: string | null;
  tenderValue?: number | null;
  emdAmount?: number | null;
  description?: string | null;
  qualificationStatus?: TenderStatus | null;
  notes?: string | null;
  tenderEstCost?: number | null;
  tenderFee?: number | null;
  processingFee?: number | null;
  finalCost?: number | null;
  msmeExemption?: boolean;
  startupExemption?: boolean;
  exemptionTypes?: string[];
  contacts?: Array<{ name: string; mobile: string; email?: string | null }>;
  decisionReason?: string | null;
  lostReason?: string | null;
  disqualificationReason?: string | null;
};

function revalidateTender(tenderId: string) {
  revalidatePath("/tenders", "layout");
  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath(`/tenders/${tenderId}/analyze`);
  revalidatePath(`/tenders/${tenderId}/bid-workspace`);
  revalidatePath("/dashboard");
  revalidatePath("/bid-fees");
}

export async function updateTenderDetailsAction(
  payload: UpdateTenderPayload,
): Promise<UpdateTenderResult> {
  try {
    const session = await requirePermissionStrict("tenders.edit");
    const tenderId = payload.tenderId?.trim();
    if (!tenderId) return { ok: false, error: "Tender id is required." };

    const existing = await getTenderById(tenderId);
    if (!existing) return { ok: false, error: "Tender not found." };

    const supabase = getServerSupabase();
    const prevMeta =
      existing.tender.raw_metadata &&
      typeof existing.tender.raw_metadata === "object"
        ? (existing.tender.raw_metadata as Record<string, unknown>)
        : {};

    const nextMeta: Record<string, unknown> = {
      ...prevMeta,
    };
    if (payload.tenderEstCost !== undefined) {
      nextMeta.tenderEstCost = payload.tenderEstCost;
    }
    if (payload.tenderFee !== undefined) nextMeta.tenderFee = payload.tenderFee;
    if (payload.processingFee !== undefined) {
      nextMeta.processingFee = payload.processingFee;
    }
    if (payload.finalCost !== undefined) nextMeta.finalCost = payload.finalCost;
    if (payload.msmeExemption !== undefined) {
      nextMeta.msmeExemption = payload.msmeExemption;
    }
    if (payload.startupExemption !== undefined) {
      nextMeta.startupExemption = payload.startupExemption;
    }
    if (payload.exemptionTypes !== undefined) {
      nextMeta.exemptionTypes = payload.exemptionTypes;
    }
    if (payload.contacts !== undefined) nextMeta.contacts = payload.contacts;
    if (payload.notes !== undefined) nextMeta.notes = payload.notes;
    if (payload.decisionReason !== undefined) {
      nextMeta.decisionReason = payload.decisionReason;
    }
    if (payload.lostReason !== undefined) nextMeta.lostReason = payload.lostReason;
    if (payload.disqualificationReason !== undefined) {
      nextMeta.disqualificationReason = payload.disqualificationReason;
    }

    const patch: Record<string, unknown> = {
      raw_metadata: nextMeta,
    };

    if (payload.title !== undefined) patch.title = payload.title.trim();
    if (payload.referenceNo !== undefined) {
      patch.folder_id = payload.referenceNo.trim() || null;
    }
    if (payload.portal !== undefined) patch.source_portal = payload.portal;
    if (payload.portalLink !== undefined) {
      patch.source_url = payload.portalLink || null;
    }
    if (payload.category !== undefined) {
      const cat = payload.category;
      patch.category = cat;
      if (cat && isProjectCategory(cat)) patch.project_category = cat;
    }
    if (payload.tenderType !== undefined) {
      patch.tender_type = payload.tenderType || null;
    }
    if (payload.organization !== undefined) {
      patch.organization = payload.organization || null;
    }
    if (payload.department !== undefined) {
      patch.department = payload.department || null;
    }
    if (payload.location !== undefined) {
      const raw = payload.location || null;
      const cleaned = raw ? stripLocationDecorators(raw) || raw : null;
      patch.city = cleaned ? normalizeTenderCity(cleaned) : null;
      patch.location_text = cleaned;
    }
    if (payload.publishedDate !== undefined) {
      patch.published_date = payload.publishedDate || null;
    }
    if (payload.closingDate !== undefined) {
      patch.closing_date = payload.closingDate || null;
    }
    if (payload.tenderValue !== undefined) {
      patch.tender_value = payload.tenderValue;
      patch.tender_value_text =
        payload.tenderValue != null
          ? `₹${payload.tenderValue.toLocaleString("en-IN")}`
          : null;
    }
    if (payload.emdAmount !== undefined) {
      patch.emd_amount = payload.emdAmount;
      patch.emd_text =
        payload.emdAmount != null
          ? `₹${payload.emdAmount.toLocaleString("en-IN")}`
          : null;
    }
    if (payload.description !== undefined) {
      patch.description = payload.description || null;
    }

    if (payload.contacts?.[0]?.name) {
      patch.authority = payload.contacts[0].name;
    }

    if (payload.qualificationStatus !== undefined) {
      const status = payload.qualificationStatus;
      if (status && !(TENDER_STATUSES as readonly string[]).includes(status)) {
        return { ok: false, error: "Invalid status." };
      }
      patch.qualification_status = status;

      if (existing.qualification && status) {
        const { error: qualError } = await supabase
          .from("agenttender_qualification_results")
          .update({
            status,
            decision_label: CLASSIFICATION_DECISION_LABELS[status],
            required_action: CLASSIFICATION_REQUIRED_ACTIONS[status],
            reason:
              payload.decisionReason ||
              payload.lostReason ||
              payload.disqualificationReason ||
              existing.qualification.reason,
          })
          .eq("tender_id", tenderId);
        if (qualError) throw new Error(qualError.message);
      }
    }

    const { error } = await supabase
      .from("agenttender_tenders")
      .update(patch)
      .eq("id", tenderId);
    if (error) throw new Error(error.message);

    await insertTenderActivity({
      tenderId,
      companyId: session.companyId,
      eventType: "tender_updated",
      summary: "Tender details updated",
      actorUserId: session.user.id,
    });

    revalidateTender(tenderId);
    return { ok: true, message: "Tender saved." };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save tender.",
    };
  }
}

export async function updateTenderStatusAction(input: {
  tenderId: string;
  status: string;
  reason?: string;
}): Promise<UpdateTenderResult> {
  return updateTenderDetailsAction({
    tenderId: input.tenderId,
    qualificationStatus: input.status as TenderStatus,
    decisionReason: input.reason || null,
  });
}

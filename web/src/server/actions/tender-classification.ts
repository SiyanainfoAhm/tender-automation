"use server";

import { revalidatePath } from "next/cache";

import {
  CLASSIFICATION_ACTION_META,
  CLASSIFICATION_DECISION_LABELS,
  CLASSIFICATION_REQUIRED_ACTIONS,
  isClassificationAction,
  type ClassificationAction,
} from "@/lib/tender-classification";
import { CompanyAccessError } from "@/server/auth/company-access";
import { requirePermissionStrict } from "@/server/auth/permissions";
import { getServerSupabase } from "@/lib/db/server";
import { insertTenderActivity } from "@/server/repositories/tenderActivityRepository";
import { getTenderById } from "@/server/repositories/tenderRepository";

export type ClassificationResult =
  | { ok: true; status: ClassificationAction; message: string }
  | { ok: false; error: string };

function revalidateTender(tenderId: string) {
  revalidatePath("/tenders", "layout");
  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath(`/tenders/${tenderId}/analyze`);
  revalidatePath(`/tenders/${tenderId}/bid-workspace`);
}

export async function updateTenderClassificationAction(input: {
  tenderId: string;
  status: string;
  reason?: string;
}): Promise<ClassificationResult> {
  try {
    const session = await requirePermissionStrict("tenders.classify");
    if (!isClassificationAction(input.status)) {
      return { ok: false, error: "Invalid classification." };
    }

    const tenderId = input.tenderId.trim();
    if (!tenderId) return { ok: false, error: "Tender id is required." };

    const data = await getTenderById(tenderId);
    if (!data) return { ok: false, error: "Tender not found." };

    const reason = input.reason?.trim() || "";
    if (input.status === "NO_GO" && data.qualification && reason.length < 8) {
      return {
        ok: false,
        error: "Please enter a short reason before marking No Bid.",
      };
    }

    const supabase = getServerSupabase();
    const meta = CLASSIFICATION_ACTION_META[input.status];

    if (data.qualification) {
      const patch: Record<string, unknown> = {
        status: input.status,
        decision_label: CLASSIFICATION_DECISION_LABELS[input.status],
        required_action: CLASSIFICATION_REQUIRED_ACTIONS[input.status],
      };
      if (reason) patch.reason = reason;
      const { error } = await supabase
        .from("agenttender_qualification_results")
        .update(patch)
        .eq("tender_id", tenderId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("agenttender_tenders")
        .update({ qualification_status: input.status })
        .eq("id", tenderId);
      if (error) throw new Error(error.message);
    }

    await insertTenderActivity({
      tenderId,
      companyId: session.companyId,
      eventType: "classification_changed",
      summary: `Classification changed to ${meta.label}`,
      payload: {
        status: input.status,
        previousStatus:
          data.qualification?.status ?? data.tender.qualification_status ?? null,
        reason: reason || null,
      },
      actorUserId: session.user.id,
    });

    revalidateTender(tenderId);
    return { ok: true, status: input.status, message: meta.toast };
  } catch (error) {
    if (error instanceof CompanyAccessError) {
      return { ok: false, error: error.message };
    }
    console.error("[tender-classification] update failed", error);
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to update classification.",
    };
  }
}

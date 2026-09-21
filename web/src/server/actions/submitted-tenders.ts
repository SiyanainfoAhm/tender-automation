"use server";

import { revalidatePath } from "next/cache";

import { updateTenderDetailsAction } from "@/server/actions/tender-update";

export type MarkTenderLostResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function revalidateSubmittedPaths(tenderId: string) {
  revalidatePath("/submitted-tenders");
  revalidatePath("/tenders", "layout");
  revalidatePath(`/tenders/${tenderId}`);
  revalidatePath("/dashboard");
  revalidatePath("/bid-fees");
  revalidatePath("/", "layout");
}

/**
 * Mark a submitted tender as LOST. Lost reason is required and stored
 * in raw_metadata.lostReason (also mirrored to qualification reason).
 */
export async function markTenderAsLostAction(input: {
  tenderId: string;
  lostReason: string;
}): Promise<MarkTenderLostResult> {
  const tenderId = input.tenderId?.trim();
  const lostReason = input.lostReason?.trim();
  if (!tenderId) return { ok: false, error: "Tender id is required." };
  if (!lostReason) {
    return { ok: false, error: "Lost reason is required." };
  }

  const result = await updateTenderDetailsAction({
    tenderId,
    qualificationStatus: "LOST",
    lostReason,
    decisionReason: lostReason,
  });

  if (!result.ok) return result;
  revalidateSubmittedPaths(tenderId);
  return { ok: true, message: "Tender marked as lost." };
}

/** Update lost reason for an already-LOST tender. */
export async function updateSubmittedLostReasonAction(input: {
  tenderId: string;
  lostReason: string;
}): Promise<MarkTenderLostResult> {
  const tenderId = input.tenderId?.trim();
  const lostReason = input.lostReason?.trim();
  if (!tenderId) return { ok: false, error: "Tender id is required." };
  if (!lostReason) {
    return { ok: false, error: "Lost reason is required." };
  }

  const result = await updateTenderDetailsAction({
    tenderId,
    lostReason,
    decisionReason: lostReason,
  });

  if (!result.ok) return result;
  revalidateSubmittedPaths(tenderId);
  return { ok: true, message: "Lost reason saved." };
}

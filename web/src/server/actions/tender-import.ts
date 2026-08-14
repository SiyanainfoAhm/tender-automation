"use server";

import { revalidatePath } from "next/cache";

import { parseInrInput } from "@/lib/format-inr";
import type { ImportPortal, ImportPreviewRow } from "@/lib/tender-import";
import { requirePermissionStrict } from "@/server/auth/permissions";
import {
  confirmSelectedTendersInPipeline,
  previewImportCandidates,
} from "@/server/repositories/tenderImportRepository";

export type PreviewImportResult =
  | { ok: true; rows: ImportPreviewRow[]; total: number }
  | { ok: false; error: string };

export type ConfirmImportResult =
  | {
      ok: true;
      newAdded: number;
      duplicates: number;
      failed: number;
    }
  | { ok: false; error: string };

function asPortal(value: string): ImportPortal | null {
  if (value === "TENDER247" || value === "BIDASSIST") return value;
  return null;
}

export async function previewImportTendersAction(input: {
  source: string;
  keywords?: string;
  location?: string;
  minValue?: string;
  maxValue?: string;
  minDaysToDeadline?: string;
}): Promise<PreviewImportResult> {
  try {
    await requirePermissionStrict("tenders.import");
    const source = asPortal(input.source);
    if (!source) {
      return { ok: false, error: "Select a connected tender source." };
    }

    const minValue = input.minValue ? parseInrInput(input.minValue) : undefined;
    const maxValue = input.maxValue ? parseInrInput(input.maxValue) : undefined;
    const minDaysRaw = input.minDaysToDeadline?.trim();
    const minDaysToDeadline = minDaysRaw
      ? Number.parseInt(minDaysRaw, 10)
      : undefined;

    const { rows, total } = await previewImportCandidates({
      source,
      keywords: input.keywords?.trim() || undefined,
      location: input.location?.trim() || undefined,
      minValue: minValue ?? undefined,
      maxValue: maxValue ?? undefined,
      minDaysToDeadline:
        minDaysToDeadline != null && Number.isFinite(minDaysToDeadline)
          ? minDaysToDeadline
          : undefined,
    });

    return { ok: true, rows, total };
  } catch {
    return {
      ok: false,
      error: "Unable to load tenders from this source. Try again.",
    };
  }
}

export async function confirmImportTendersAction(
  ids: string[],
): Promise<ConfirmImportResult> {
  try {
    await requirePermissionStrict("tenders.import");
    const result = await confirmSelectedTendersInPipeline(ids);
    revalidatePath("/tenders", "layout");
    revalidatePath("/dashboard");
    return { ok: true, ...result };
  } catch {
    return {
      ok: false,
      error: "Import could not be completed. No new records were written.",
    };
  }
}

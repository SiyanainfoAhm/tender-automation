/**
 * Parse duplicate-of reference from GPT / screening decision reason text.
 */
import type { DuplicateMarkKind } from "./duplicateScreening.js";

export type ParsedDuplicateReference = {
  matchedSourceTenderId: string | null;
  matchKind: DuplicateMarkKind | null;
};

function digitsOnly(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim();
}

export function parseDuplicateReferenceFromReason(
  reason: string | null | undefined,
): ParsedDuplicateReference {
  const text = String(reason ?? "").trim();
  if (!text) {
    return { matchedSourceTenderId: null, matchKind: null };
  }

  let match = text.match(/Matches Tender247 ID\s+(\d+)/i);
  if (match?.[1]) {
    return {
      matchedSourceTenderId: digitsOnly(match[1]),
      matchKind: "reference",
    };
  }

  match = text.match(/as Tender247 ID\s+(\d+)/i);
  if (match?.[1]) {
    return {
      matchedSourceTenderId: digitsOnly(match[1]),
      matchKind: "authority_brief_deadline",
    };
  }

  match = text.match(/matches existing Tender247 ID\s+(\d+)/i);
  if (match?.[1]) {
    return {
      matchedSourceTenderId: digitsOnly(match[1]),
      matchKind: "historical",
    };
  }

  match = text.match(/Duplicate Tender247 ID:\s*(\d+)/i);
  if (match?.[1]) {
    return {
      matchedSourceTenderId: digitsOnly(match[1]),
      matchKind: "tender247_id",
    };
  }

  return { matchedSourceTenderId: null, matchKind: null };
}

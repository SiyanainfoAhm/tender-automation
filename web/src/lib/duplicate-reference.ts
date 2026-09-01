export type DuplicateMatchKind =
  | "tender247_id"
  | "reference"
  | "authority_brief_deadline"
  | "historical";

export type ParsedDuplicateReference = {
  matchedSourceTenderId: string | null;
  matchKind: DuplicateMatchKind | null;
};

export type DuplicateReferenceDisplay = {
  portalId: string | null;
  tenderId: string | null;
  label: string;
  href: string | null;
  matchKind: DuplicateMatchKind | null;
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

export function formatDuplicateReference(options: {
  duplicateOfSourceTenderId?: string | null;
  duplicateOfTenderId?: string | null;
  duplicateMatchKind?: string | null;
  screeningReason?: string | null;
  sourcePortal?: string | null;
}): DuplicateReferenceDisplay | null {
  const parsed = parseDuplicateReferenceFromReason(options.screeningReason);
  const portalId =
    String(options.duplicateOfSourceTenderId ?? "").trim() ||
    parsed.matchedSourceTenderId;
  const tenderId = String(options.duplicateOfTenderId ?? "").trim() || null;
  const matchKind =
    (String(options.duplicateMatchKind ?? "").trim() as DuplicateMatchKind) ||
    parsed.matchKind;
  if (!portalId && !tenderId) return null;

  const prefix =
    String(options.sourcePortal ?? "TENDER247").toUpperCase() === "BIDASSIST"
      ? "BA-"
      : "T247-";
  const label = portalId ? `${prefix}${portalId}` : "Matched tender";
  return {
    portalId,
    tenderId,
    label,
    href: tenderId ? `/tenders/${tenderId}` : null,
    matchKind: matchKind || null,
  };
}

export function duplicateMatchKindLabel(
  kind: string | null | undefined,
): string | null {
  switch (String(kind ?? "").trim()) {
    case "tender247_id":
      return "Same Tender247 ID";
    case "reference":
      return "Same reference number";
    case "authority_brief_deadline":
      return "Same authority, brief, and deadline";
    case "historical":
      return "Already reviewed in history";
    default:
      return null;
  }
}

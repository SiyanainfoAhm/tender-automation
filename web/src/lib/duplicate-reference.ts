export type DuplicateReferenceDisplay = {
  portalId: string | null;
  tenderId: string | null;
  label: string;
  href: string | null;
};

export function formatDuplicateReference(options: {
  duplicateOfSourceTenderId?: string | null;
  duplicateOfTenderId?: string | null;
  sourcePortal?: string | null;
}): DuplicateReferenceDisplay | null {
  const portalId = String(options.duplicateOfSourceTenderId ?? "").trim() || null;
  const tenderId = String(options.duplicateOfTenderId ?? "").trim() || null;
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

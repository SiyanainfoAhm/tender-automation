export const WORK_CATEGORIES = [
  { key: "company", label: "Company Docs", description: "Match and attach existing company documents." },
  { key: "ai", label: "AI Draft", description: "Generate, review and edit tender-specific drafts." },
  { key: "manual", label: "Manual", description: "Complete required actions or upload supporting files." },
] as const;

export function checklistWorkCategory(item: {
  processingType?: string | null;
  generationAllowed: boolean;
  matchedDocumentSource: string | null;
}) {
  const type = item.processingType?.toUpperCase();
  if (type === "MANUAL_ENTRY" || type === "MANUAL") return "manual";
  if (type === "AI_DRAFT") return "ai";
  if (type === "COMPANY_DOC" || type === "COMPANY_DOCUMENT") return "company";
  if (item.generationAllowed) return "ai";
  if (item.matchedDocumentSource === "COMPANY") return "company";
  return "manual";
}

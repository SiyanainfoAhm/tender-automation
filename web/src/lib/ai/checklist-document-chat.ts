export const CHECKLIST_DOCUMENT_MODES = ["modify", "regenerate", "recreate"] as const;
export type ChecklistDocumentMode = (typeof CHECKLIST_DOCUMENT_MODES)[number];
export type ChecklistDocumentSource = { id: string; source: "TENDER" | "COMPANY" };
export type ChecklistDocumentChatOptions = {
  mode: ChecklistDocumentMode;
  sourceDocument?: ChecklistDocumentSource;
};

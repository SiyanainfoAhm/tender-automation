export type ChatFeedbackKind = "HELPFUL" | "UNHELPFUL" | "CORRECTION";
export type ChatFeedbackReceipt = { id: string; status: string; kind: ChatFeedbackKind };
export function feedbackStatusText(feedback: ChatFeedbackReceipt): string {
  if (feedback.kind === "HELPFUL") return "Thanks — marked helpful.";
  if (feedback.kind === "UNHELPFUL") return "Thanks — your feedback was saved.";
  switch (feedback.status) {
    case "VERIFIED": return "Correction verified against documents. Future answers for this tender can use it.";
    case "REJECTED": return "The documents did not support this correction. It has not been learned.";
    case "INSUFFICIENT_EVIDENCE": return "More document evidence is needed before this correction can be learned.";
    case "CONFLICTING_EVIDENCE": return "The evidence conflicts. This correction needs review.";
    case "NEEDS_REVIEW": case "DEAD_LETTER": return "Correction saved, but it needs review before it can be learned.";
    case "VERIFYING": return "Checking your correction against the documents.";
    default: return "Correction saved and queued for document checks. It has not been learned yet.";
  }
}


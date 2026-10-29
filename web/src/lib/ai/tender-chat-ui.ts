export type TenderSmartQuestion = { label: string; category: string; question: string };

/**
 * The tender chatbot only offers these two quick questions, in this order.
 * Any other configured categories are ignored.
 */
export const TENDER_QUICK_QUESTION_CATEGORIES = ["DO_WE_QUALIFY", "SCOPE_OF_WORK"] as const;

export function parseSmartQuestions(value: unknown): TenderSmartQuestion[] {
  if (!Array.isArray(value)) throw new Error("The tender quick questions are unavailable.");
  const byCategory = new Map<string, TenderSmartQuestion>();
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Invalid quick-question configuration.");
    const q = item as Record<string, unknown>;
    if (![q.label, q.category, q.question].every(v => typeof v === "string" && v.trim())) throw new Error("Invalid quick-question configuration.");
    if (String(q.question).length > 4000 || !/^[A-Z_]+$/.test(String(q.category))) throw new Error("Invalid quick-question configuration.");
    if (byCategory.has(String(q.category))) throw new Error("Duplicate quick-question categories.");
    byCategory.set(String(q.category), { label: String(q.label), category: String(q.category), question: String(q.question) });
  }
  const questions = TENDER_QUICK_QUESTION_CATEGORIES.map(category => byCategory.get(category));
  if (questions.some(q => !q)) throw new Error("The tender quick questions are unavailable.");
  return questions as TenderSmartQuestion[];
}

/** Replace only explicitly labelled trailing suggestions; retain the evidence narrative. */
export function withoutSuggestedFollowups(answer: string): string {
  return answer.replace(/\n\s*(?:#{1,6}\s*)?(?:\*\*)?(?:suggested (?:follow[- ]?ups?|(?:next )?questions)|(?:useful |relevant )?next questions|follow[- ]?up questions)(?:\*\*)?\s*:?[^\n]*(?:\n[\s\S]*)?$/i, "").trimEnd();
}


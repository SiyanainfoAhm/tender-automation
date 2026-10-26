export type TenderSmartQuestion = { label: string; category: string; question: string };

export function parseSmartQuestions(value: unknown): TenderSmartQuestion[] {
  if (!Array.isArray(value) || value.length !== 10) throw new Error("The tender quick questions are unavailable.");
  const questions = value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid quick-question configuration.");
    const q = item as Record<string, unknown>;
    if (![q.label, q.category, q.question].every(v => typeof v === "string" && v.trim())) throw new Error("Invalid quick-question configuration.");
    if (String(q.question).length > 4000 || !/^[A-Z_]+$/.test(String(q.category))) throw new Error("Invalid quick-question configuration.");
    return { label: String(q.label), category: String(q.category), question: String(q.question) };
  });
  if (new Set(questions.map(q => q.category)).size !== 10) throw new Error("Duplicate quick-question categories.");
  return questions;
}

/** Replace only explicitly labelled trailing suggestions; retain the evidence narrative. */
export function withoutSuggestedFollowups(answer: string): string {
  return answer.replace(/\n\s*(?:#{1,6}\s*)?(?:\*\*)?(?:suggested (?:follow[- ]?ups?|(?:next )?questions)|(?:useful |relevant )?next questions|follow[- ]?up questions)(?:\*\*)?\s*:?[^\n]*(?:\n[\s\S]*)?$/i, "").trimEnd();
}


import { describe, expect, it } from "vitest";

import {
  BID_AI_PROMPT_CATALOG,
  BID_AI_PROMPT_KEYS,
  isBidAiPromptKey,
  promptKeyForChecklistCategory,
  promptKeyForWorkspaceTab,
  sanitizePromptTemplate,
} from "@/lib/bid-ai-prompts";

describe("bid AI prompt catalog", () => {
  it("exposes a default template for every prompt key", () => {
    for (const key of BID_AI_PROMPT_KEYS) {
      expect(BID_AI_PROMPT_CATALOG[key].defaultTemplate.trim().length).toBeGreaterThan(
        40,
      );
    }
  });

  it("maps workspace tabs and categories to prompt keys", () => {
    expect(promptKeyForWorkspaceTab("checklist")).toBe("CHECKLIST_CREATION");
    expect(promptKeyForWorkspaceTab("technical")).toBe("TECHNICAL_DOCUMENT");
    expect(promptKeyForChecklistCategory("ANNEXURE")).toBe("ANNEXURE_DOCUMENT");
    expect(promptKeyForChecklistCategory("COMPLIANCE")).toBe("PREQUAL_DOCUMENT");
    expect(isBidAiPromptKey("TECHNICAL_DOCUMENT")).toBe(true);
    expect(isBidAiPromptKey("nope")).toBe(false);
  });

  it("sanitizes editable templates", () => {
    expect(sanitizePromptTemplate("  Hello  ", 100)).toBe("Hello");
    expect(() => sanitizePromptTemplate("", 100)).toThrow(/empty/i);
    expect(() => sanitizePromptTemplate("x".repeat(20), 10)).toThrow(/limit/i);
  });
});

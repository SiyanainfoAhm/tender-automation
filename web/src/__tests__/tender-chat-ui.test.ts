import { describe, expect, it } from "vitest";
import { parseSmartQuestions, withoutSuggestedFollowups } from "@/lib/ai/tender-chat-ui";
import { normalizeV2Sources } from "@/lib/ai/v2-sources";
describe("database quick questions", () => {
  it("keeps only Do We Qualify and Scope of Work, in that order", () => {
    const config = ["SCOPE_OF_WORK","EMD","DO_WE_QUALIFY"].map(category => ({label:category,category,question:`${category}?`}));
    expect(parseSmartQuestions(config).map(q => q.category)).toEqual(["DO_WE_QUALIFY","SCOPE_OF_WORK"]);
    expect(() => parseSmartQuestions(config.slice(0, 2))).toThrow();
  });
  it("rejects incomplete config without fallback prompts", () => expect(() => parseSmartQuestions([])).toThrow());
  it("preserves the answer and citations while replacing labelled suggestions", () => {
    expect(withoutSuggestedFollowups("EMD is 100 [R1].\n\n### Suggested follow-ups\n1. What next?" )).toBe("EMD is 100 [R1].");
    expect(withoutSuggestedFollowups("Required documents\n1. Certificate [R1]" )).toBe("Required documents\n1. Certificate [R1]");
  });
  it("restores V2 evidence links and page references in saved history", () => {
    expect(normalizeV2Sources([{ref:"R1",document:"RFP.pdf",page:12,document_url:"https://example.com/rfp",chunk_id:"chunk"}])[0]).toMatchObject({id:"R1",fileName:"RFP.pdf",pageNumber:12,documentUrl:"https://example.com/rfp",sourceId:"chunk"});
    expect(normalizeV2Sources([{ref:"R1",document_url:"javascript:alert(1)"}])[0].documentUrl).toBeNull();
  });
});


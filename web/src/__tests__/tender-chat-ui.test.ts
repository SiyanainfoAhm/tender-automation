import { describe, expect, it } from "vitest";
import { parseSmartQuestions, withoutSuggestedFollowups } from "@/lib/ai/tender-chat-ui";
import { normalizeV2Sources } from "@/lib/ai/v2-sources";
describe("database quick questions", () => {
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


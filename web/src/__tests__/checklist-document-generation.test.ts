import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import {
  resolveGenerationPolicy,
  resolveRequirementPattern,
} from "@/lib/bid-checklist";
import {
  buildGeneratedFileName,
  nextVersionLabel,
  sanitizeFileNamePart,
} from "@/server/generation/filenames";
import { renderGeneratedDocx } from "@/server/generation/renderDocx";
import type { GeneratedDocumentContent } from "@/server/generation/types";

describe("generation policy", () => {
  it("blocks external evidence requirements", () => {
    expect(
      resolveGenerationPolicy({
        requirementKey: "GST_REGISTRATION",
        requirementName: "GST Registration Certificate",
      }),
    ).toBe("EXTERNAL_EVIDENCE_REQUIRED");
    expect(resolveRequirementPattern("ISO 9001")?.generationAllowed).toBe(false);
  });

  it("allows technical approach and draft-only cover letter", () => {
    expect(
      resolveGenerationPolicy({
        requirementKey: "TECHNICAL_APPROACH",
        requirementName: "Technical Approach & Methodology",
      }),
    ).toBe("GENERATABLE");
    expect(
      resolveGenerationPolicy({
        requirementKey: "COVERING_LETTER",
        requirementName: "Cover Letter",
      }),
    ).toBe("GENERATABLE_DRAFT_ONLY");
    expect(resolveRequirementPattern("Integrity Pact")?.generationAllowed).toBe(
      true,
    );
  });
});

describe("generated filenames", () => {
  it("builds deterministic sanitized names", () => {
    expect(sanitizeFileNamePart("Technical Approach & Methodology")).toBe(
      "Technical_Approach_Methodology",
    );
    expect(
      buildGeneratedFileName({
        requirementName: "Technical Approach & Methodology",
        tenderReference: "103500369",
        versionLabel: "v1.0",
      }),
    ).toBe("Technical_Approach_Methodology_103500369_v1.0.docx");
    expect(nextVersionLabel(0)).toBe("v1.0");
    expect(nextVersionLabel(1)).toBe("v1.1");
  });
});

describe("DOCX renderer", () => {
  it("produces a valid OOXML package with expected sections", async () => {
    const content: GeneratedDocumentContent = {
      document_title: "Technical Approach & Methodology",
      document_type: "TECHNICAL_APPROACH",
      sections: [
        {
          heading: "1. Understanding of Requirement",
          content: [
            {
              type: "paragraph",
              text: "We understand the RFP scope for application support.",
            },
            {
              type: "bullets",
              items: ["Scope alignment", "Delivery model"],
            },
          ],
        },
        {
          heading: "2. Proposed Technical Approach",
          content: [
            {
              type: "numbered",
              items: ["Discovery", "Build", "Operate"],
            },
          ],
        },
      ],
      tables: [
        {
          title: "Milestones",
          headers: ["Phase", "Duration"],
          rows: [
            ["Discovery", "2 weeks"],
            ["Build", "8 weeks"],
          ],
        },
      ],
      missing_information: ["[Company to provide project-specific information]"],
      warnings: ["Draft pending review"],
    };

    const buffer = await renderGeneratedDocx({
      content,
      tenderTitle: "Sample Tender",
      tenderReference: "103500369",
      companyName: "Siyana Infotech",
      requirementName: "Technical Approach & Methodology",
    });

    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toBeTruthy();
    expect(documentXml!).toContain("Technical Approach");
    expect(documentXml!).toContain("Understanding of Requirement");
    expect(documentXml!).toContain("Proposed Technical Approach");
    expect(documentXml!).toContain("103500369");
  });
});

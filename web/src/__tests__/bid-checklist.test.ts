import { describe, expect, it } from "vitest";

import {
  buildChecklistSeedFromMissingDocuments,
  calculateSectionProgress,
  isChecklistItemComplete,
  isRequirementCompleted,
  matchRequirementToDocuments,
  normalizeRequirementIdentityKey,
  resolveRequirementPattern,
} from "@/lib/bid-checklist";

describe("bid checklist matching", () => {
  it("resolves CMMI requirement variants", () => {
    expect(
      resolveRequirementPattern(
        "Evidence of CMMI Maturity Level 3 or higher",
      )?.key,
    ).toBe("CMMI_LEVEL_3");
  });

  it("completes from verified company CMMI document", () => {
    const result = matchRequirementToDocuments({
      requirementName: "CMMI Level 3 Certificate",
      requirementKey: "CMMI_LEVEL_3",
      companyDocuments: [
        {
          id: "doc-1",
          name: "CMMI Level 3 Appraisal",
          originalFileName: "CMMI Level 3 Appraisal.pdf",
          documentCategory: "Certificate",
          certificateType: "CMMI",
          documentType: null,
          verificationStatus: "verified",
          expiryState: "VALID",
          status: "active",
        },
      ],
      workspaceDocuments: [],
    });
    expect(result.matched).toBe(true);
    expect(result.source).toBe("COMPANY");
    expect(result.completionStatus).toBe("COMPLETED_COMPANY_DOCUMENT");
    expect(isChecklistItemComplete(result.completionStatus)).toBe(true);
  });

  it("allows draft AI generation for missing integrity pact", () => {
    const result = matchRequirementToDocuments({
      requirementName: "Integrity Pact (Stamp Paper + Notarized)",
      requirementKey: "INTEGRITY_PACT",
      companyDocuments: [],
      workspaceDocuments: [],
    });
    expect(result.matched).toBe(false);
    expect(result.completionStatus).toBe("MISSING");
    expect(resolveRequirementPattern("Integrity Pact")?.generationAllowed).toBe(
      true,
    );
  });

  it("allows AI generation for missing technical approach", () => {
    const result = matchRequirementToDocuments({
      requirementName: "Technical Approach & Methodology",
      requirementKey: "TECHNICAL_APPROACH",
      companyDocuments: [],
      workspaceDocuments: [],
    });
    expect(result.completionStatus).toBe("MISSING");
  });

  it("does not satisfy from-scratch docs with company library uploads", () => {
    const result = matchRequirementToDocuments({
      requirementName: "Covering letter on company letterhead",
      requirementKey: "COVERING_LETTER",
      companyDocuments: [
        {
          id: "doc-1",
          name: "Covering letter template",
          originalFileName: "cover.docx",
          documentCategory: "Other",
          certificateType: null,
          documentType: null,
          verificationStatus: "verified",
          expiryState: "VALID",
          status: "active",
        },
      ],
      workspaceDocuments: [],
    });
    expect(result.matched).toBe(false);
    expect(result.completionStatus).toBe("MISSING");
  });

  it("still matches external evidence from company library", () => {
    const result = matchRequirementToDocuments({
      requirementName: "GST registration certificate",
      requirementKey: "GST_REGISTRATION",
      companyDocuments: [
        {
          id: "gst-1",
          name: "GST Registration",
          originalFileName: "gst.pdf",
          documentCategory: "Certificate",
          certificateType: "GST",
          documentType: null,
          verificationStatus: "verified",
          expiryState: "VALID",
          status: "active",
        },
      ],
      workspaceDocuments: [],
    });
    expect(result.matched).toBe(true);
    expect(result.source).toBe("COMPANY");
  });

  it("completes checklist from linked AI/uploaded tender document", () => {
    const result = matchRequirementToDocuments({
      requirementName:
        "Provide one dedicated onsite resource (CV and deployment details)",
      requirementKey: "DEDICATED_ONSITE_RESOURCE",
      companyDocuments: [],
      workspaceDocuments: [
        {
          id: "ws-1",
          title:
            "Provide one dedicated onsite resource (CV and deployment details) (v1.0)",
          fileName:
            "Provide_one_dedicated_onsite_resource_CV_and_deployment_details_MAN_v1.docx",
          documentType: "Technical",
          status: "drafting",
          hasFile: true,
        },
      ],
      generationAllowed: true,
    });
    expect(result.matched).toBe(true);
    expect(result.source).toBe("TENDER");
    expect(result.workspaceDocumentId).toBe("ws-1");
    expect(result.completionStatus).toBe("COMPLETED_TENDER_DOCUMENT");
    expect(isChecklistItemComplete(result.completionStatus)).toBe(true);
  });

  it("seeds checklist keys from missing documents", () => {
    const seeds = buildChecklistSeedFromMissingDocuments([
      "GST Registration Certificate",
      { name: "CMMI Level 3 Certificate" },
    ]);
    expect(seeds).toHaveLength(2);
    expect(seeds[0]?.requirementKey).toBe("GST_REGISTRATION");
    expect(seeds[1]?.requirementKey).toBe("CMMI_LEVEL_3");
  });

  it("treats manual_completed as completed even without a document", () => {
    expect(
      isRequirementCompleted({
        manualCompleted: true,
        completionStatus: "MISSING",
      }),
    ).toBe(true);
  });

  it("calculates section progress from unique requirements only", () => {
    const items = [
      {
        mandatory: true,
        category: "TECHNICAL",
        completionStatus: "COMPLETED_TENDER_DOCUMENT" as const,
        manualCompleted: false,
      },
      {
        mandatory: true,
        category: "TECHNICAL",
        completionStatus: "MISSING" as const,
        manualCompleted: false,
      },
      {
        mandatory: true,
        category: "TECHNICAL",
        completionStatus: "MISSING" as const,
        manualCompleted: true,
      },
      {
        mandatory: true,
        category: "ANNEXURE",
        completionStatus: "MISSING" as const,
        manualCompleted: false,
      },
    ];
    expect(calculateSectionProgress(items, "technical")).toEqual({
      completed: 2,
      total: 3,
      percent: 67,
    });
    expect(normalizeRequirementIdentityKey("MOBILIZATION_PLAN", "Mobilization")).toBe(
      "MOBILIZATION_PLAN",
    );
  });
});

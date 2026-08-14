import { describe, expect, it } from "vitest";

import { canManageBidProfileTemplates } from "@/lib/company/types";
import { bidProfileTemplateSchema } from "@/lib/templates/schema";

describe("bid profile template permissions", () => {
  it("allows admin and bid manager to manage templates", () => {
    expect(canManageBidProfileTemplates("ADMIN")).toBe(true);
    expect(canManageBidProfileTemplates("BID_MANAGER")).toBe(true);
    expect(canManageBidProfileTemplates("BID_COORDINATOR")).toBe(false);
    expect(canManageBidProfileTemplates("DOCUMENT_SPECIALIST")).toBe(false);
  });
});

describe("bid profile template schema", () => {
  const valid = {
    templateName: "IT Division - Standard Bid",
    description: "Standard IT bids",
    isDefault: true,
    companyName: "Siyana Info Solutions Pvt. Ltd.",
    referenceNumber: "SISL/TENDER/2025/001",
    tenderAcceptanceUndertakingDate: "2026-01-15",
    minimumLocalContent: "50",
    localValueAdditionLocation: "Ahmedabad, Gujarat",
    authorizedPersonName: "Mr. Shashank Sharma",
    authorizedPersonPosition: "Sr. Project Manager",
    signatoryName: "Mr. Shashank Sharma",
    signatoryDesignation: "Sr. Project Manager",
    departmentName: "Information Technology Division",
    departmentAddress: "1302, 13th Floor",
    companyAddress: "Ahmedabad",
  };

  it("accepts a complete template", () => {
    const parsed = bidProfileTemplateSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.minimumLocalContent).toBe(50);
      expect(parsed.data.isDefault).toBe(true);
    }
  });

  it("requires template name and signatory fields", () => {
    const parsed = bidProfileTemplateSchema.safeParse({
      ...valid,
      templateName: "  ",
      signatoryName: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects local content outside 0-100", () => {
    expect(
      bidProfileTemplateSchema.safeParse({
        ...valid,
        minimumLocalContent: "120",
      }).success,
    ).toBe(false);
  });
});

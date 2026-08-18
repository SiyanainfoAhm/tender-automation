import { describe, expect, it } from "vitest";

import { canManageBidProfileTemplates, TEMPLATE_ASSET_EXTENSIONS, TEMPLATE_ASSET_MIME_TYPES } from "@/lib/company/types";
import { bidProfileTemplateSchema } from "@/lib/templates/schema";
import {
  TEMPLATE_ASSET_ACCEPT,
  fileNameFromStoragePath,
  fileNameFromUrl,
  getTemplateAssetType,
  isAllowedTemplateAsset,
  templateSignStampReadUrl,
} from "@/lib/templates/templateAsset";

describe("bid profile template permissions", () => {
  it("allows admin and bid manager to manage templates", () => {
    expect(canManageBidProfileTemplates("ADMIN")).toBe(true);
    expect(canManageBidProfileTemplates("BID_MANAGER")).toBe(true);
    expect(canManageBidProfileTemplates("BID_COORDINATOR")).toBe(false);
    expect(canManageBidProfileTemplates("DOCUMENT_SPECIALIST")).toBe(false);
  });

  it("allows PDF along with image types for company sign + stamp", () => {
    expect(TEMPLATE_ASSET_EXTENSIONS).toEqual([
      ".pdf",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
    ]);
    expect(TEMPLATE_ASSET_MIME_TYPES).toContain("application/pdf");
    expect(TEMPLATE_ASSET_ACCEPT.startsWith(".pdf")).toBe(true);
    expect(
      isAllowedTemplateAsset(
        new File(["%PDF"], "stamp.pdf", { type: "application/octet-stream" }),
      ),
    ).toBe(true);
  });

  it("detects pdf vs image assets from url or filename", () => {
    expect(
      getTemplateAssetType(
        "https://cdn.example/company-sign-stamp-1.pdf?x=1",
      ),
    ).toBe("pdf");
    expect(getTemplateAssetType(null, "stamp.PNG")).toBe("image");
    expect(fileNameFromUrl("https://cdn.example/a/b/company-sign-stamp-uuid.pdf")).toBe(
      "company-sign-stamp-uuid.pdf",
    );
    expect(
      fileNameFromStoragePath(
        "co/templates/it/company-sign-stamp/company-sign-stamp-uuid.pdf",
      ),
    ).toBe("company-sign-stamp-uuid.pdf");
    expect(templateSignStampReadUrl("tpl-1")).toBe(
      "/api/templates/tpl-1/assets/signatory",
    );
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

  it("does not require template document assets", () => {
    const parsed = bidProfileTemplateSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("companyLogoUrl");
      expect(parsed.data).not.toHaveProperty("companySignatoryUrl");
    }
  });
});

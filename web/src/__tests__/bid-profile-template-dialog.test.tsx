/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";

import { BidProfileTemplateDialog } from "@/components/templates/bid-profile-template-dialog";
import { TEMPLATE_ASSET_ACCEPT } from "@/lib/templates/templateAsset";
import type { BidProfileTemplate } from "@/lib/templates/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/server/actions/templates", () => ({
  createBidProfileTemplateAction: async () => ({}),
  updateBidProfileTemplateAction: async () => ({}),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const pdfUrl = "/api/templates/tpl-1/assets/signatory";
const pngUrl = "/api/templates/tpl-1/assets/signatory";

function existingTemplate(
  fileName: string,
): BidProfileTemplate {
  return {
    id: "tpl-1",
    companyId: "co-1",
    templateName: "IT Division",
    description: "Standard",
    isDefault: false,
    companyName: "Siyana",
    referenceNumber: "SISL/1",
    tenderAcceptanceUndertakingDate: null,
    minimumLocalContent: 50,
    localValueAdditionLocation: "Ahmedabad",
    authorizedPersonName: "A",
    authorizedPersonPosition: "PM",
    signatoryName: "A",
    signatoryDesignation: "PM",
    departmentName: "IT",
    departmentAddress: "Floor 13",
    companyAddress: "Ahmedabad",
    companySignStampUrl: pdfUrl,
    companySignStampFileName: fileName,
    companySignatoryUrl: pdfUrl,
    companyLogoUrl: null,
    companyLogoBlobName: null,
    companySignatoryBlobName: `co/templates/it/company-sign-stamp/${fileName}`,
    status: "active",
    createdBy: "u1",
    updatedBy: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.mocked(toast.error).mockClear();
});

describe("BidProfileTemplateDialog documents", () => {
  it("shows a single Company Sign + Stamp upload and no logo field", () => {
    render(
      <BidProfileTemplateDialog
        open
        onOpenChange={() => undefined}
        mode="create"
        companyName="Siyana"
        companyAddress="Ahmedabad"
      />,
    );

    expect(screen.getByText("Documents")).toBeTruthy();
    expect(screen.getByLabelText("Company Sign + Stamp")).toBeTruthy();
    expect(screen.queryByLabelText("Company Logo")).toBeNull();
    expect(screen.queryByLabelText("Company Signatory")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Choose File" })).toHaveLength(
      1,
    );
    expect(screen.getByText("PDF, PNG, JPG, JPEG, WEBP")).toBeTruthy();
    expect(screen.queryByText("No file chosen")).toBeNull();
  });

  it("lets Windows see PDFs by listing .pdf before image types", () => {
    render(
      <BidProfileTemplateDialog
        open
        onOpenChange={() => undefined}
        mode="create"
        companyName="Siyana"
        companyAddress="Ahmedabad"
      />,
    );

    const input = document.getElementById(
      "companySignStamp",
    ) as HTMLInputElement;
    expect(input.accept).toBe(TEMPLATE_ASSET_ACCEPT);
    expect(input.accept.startsWith(".pdf")).toBe(true);
    expect(input.accept).toContain(".png");
    expect(input.accept).toContain("application/pdf");
    expect(input.accept).not.toContain("image/*");
  });

  it("shows an existing PDF in Edit instead of No file chosen", () => {
    render(
      <BidProfileTemplateDialog
        open
        onOpenChange={() => undefined}
        mode="edit"
        template={existingTemplate("company-sign-stamp-uuid.pdf")}
        companyName="Siyana"
        companyAddress="Ahmedabad"
      />,
    );

    expect(screen.queryByText("No file chosen")).toBeNull();
    expect(screen.queryByAltText("Company Sign and Stamp")).toBeNull();
    expect(screen.getByText("company-sign-stamp-uuid.pdf")).toBeTruthy();
    expect(screen.getByText("Current uploaded file")).toBeTruthy();
    expect(screen.getByText("PDF document")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View" }).getAttribute("href")).toBe(
      "/api/templates/tpl-1/assets/signatory",
    );
    expect(
      screen.getByRole("link", { name: "View" }).getAttribute("href"),
    ).not.toContain("blob.core.windows.net");
    expect(
      screen.getByRole("link", { name: "View" }).getAttribute("target"),
    ).toBe("_blank");
    expect(
      screen.getByRole("button", { name: "Choose Replacement" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose File" })).toBeNull();
  });

  it("shows an existing image thumbnail in Edit", () => {
    render(
      <BidProfileTemplateDialog
        open
        onOpenChange={() => undefined}
        mode="edit"
        template={existingTemplate("company-sign-stamp-uuid.png")}
        companyName="Siyana"
        companyAddress="Ahmedabad"
      />,
    );

    expect(screen.getByAltText("Company Sign and Stamp").getAttribute("src")).toBe(
      pngUrl,
    );
    expect(screen.getByText("company-sign-stamp-uuid.png")).toBeTruthy();
    expect(screen.getByText("Current uploaded file")).toBeTruthy();
  });

  it("shows a selected PDF filename as a replacement, not an image", () => {
    render(
      <BidProfileTemplateDialog
        open
        onOpenChange={() => undefined}
        mode="edit"
        template={existingTemplate("company-sign-stamp-uuid.pdf")}
        companyName="Siyana"
        companyAddress="Ahmedabad"
      />,
    );

    const input = document.getElementById(
      "companySignStamp",
    ) as HTMLInputElement;
    const file = new File(["%PDF-1.4"], "new-sign-stamp.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText("new-sign-stamp.pdf")).toBeTruthy();
    expect(screen.getByText("New file selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change File" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "View" })).toBeNull();
    expect(screen.queryByAltText("Company Sign and Stamp")).toBeNull();
  });

  it("rejects unsupported types instead of ignoring them", () => {
    render(
      <BidProfileTemplateDialog
        open
        onOpenChange={() => undefined}
        mode="create"
        companyName="Siyana"
        companyAddress="Ahmedabad"
      />,
    );

    const input = document.getElementById(
      "companySignStamp",
    ) as HTMLInputElement;
    const file = new File(["doc"], "stamp.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(input, { target: { files: [file] } });

    expect(toast.error).toHaveBeenCalledWith(
      "Unsupported file type. Upload PDF, PNG, JPG, JPEG, or WEBP.",
    );
    expect(screen.queryByText("stamp.docx")).toBeNull();
  });
});

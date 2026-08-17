/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FileUploadProgress } from "@/components/documents/file-upload-progress";
import { UploadDocumentDialog } from "@/components/documents/upload-document-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FileUploadProgress", () => {
  it("exposes an accessible progressbar and finalizing copy at 100%", () => {
    render(
      <FileUploadProgress
        fileName="Tender_All_Documents.zip"
        uploadedBytes={50 * 1024 * 1024}
        totalBytes={50 * 1024 * 1024}
        percentage={100}
        currentChunk={10}
        totalChunks={10}
        status="finalizing"
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(screen.getByText(/Finalizing upload/i)).toBeTruthy();
    expect(screen.getByText(/50\.0 MB of 50\.0 MB/)).toBeTruthy();
  });

  it("shows a retry action on failure", async () => {
    const onRetry = vi.fn();
    render(
      <FileUploadProgress
        fileName="pack.pdf"
        uploadedBytes={10}
        totalBytes={100}
        percentage={10}
        currentChunk={1}
        totalChunks={2}
        status="failed"
        error="Network interrupted"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/Upload failed/)).toBeTruthy();
    expect(screen.getByText(/Network interrupted/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("upload failures stay in the modal", () => {
  it("keeps the documents page mounted when upload fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, error: "Network interrupted" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    render(
      <div>
        <h1>Documents & Experience</h1>
        <UploadDocumentDialog open onOpenChange={() => undefined} kind="general" />
      </div>,
    );

    expect(screen.getByText("Documents & Experience")).toBeTruthy();
    expect(screen.queryByText(/couldn't load this page/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Document Name/i), {
      target: { value: "ISO Pack" },
    });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "pack.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText(/Upload File/i), {
      target: { files: [file] },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Upload Document" }).closest("form")!);

    expect(await screen.findByText(/Storage unavailable|Network interrupted|Upload failed/i)).toBeTruthy();
    expect(screen.getByText("Documents & Experience")).toBeTruthy();
    expect(screen.queryByText(/couldn't load this page/i)).toBeNull();
  });
});

describe("UploadDocumentDialog copy", () => {
  it("shows the configured size limit instead of a hardcoded 25 MB cap", async () => {
    render(
      <UploadDocumentDialog open onOpenChange={() => undefined} kind="general" />,
    );
    expect(screen.getAllByText(/up to 100 MB/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/up to 25 MB/i)).toBeNull();
  });
});

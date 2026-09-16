import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_DOCUMENT_UPLOAD_BYTES } from "@/lib/uploads/config";
import {
  SHAREPOINT_UPLOAD_CHUNK_BYTES,
  uploadTenderDocumentDirectToSharePoint,
} from "@/lib/uploads/directSharePointUpload";
import { validateDocumentFile } from "@/lib/uploads/validation";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeFile(sizeBytes: number, name = "pack.pdf") {
  const bytes = new Uint8Array(Math.min(sizeBytes, 64));
  const file = new File([bytes], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

describe("tender direct SharePoint upload", () => {
  it("rejects oversize files before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await uploadTenderDocumentDirectToSharePoint({
      tenderId: "tender-1",
      section: "tender",
      file: makeFile(MAX_DOCUMENT_UPLOAD_BYTES + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/maximum size/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads bytes to a Graph session, not via Vercel", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/documents/direct-upload")) {
        const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        if (body.intent === "create" || body.intent == null) {
          return new Response(
            JSON.stringify({
              success: true,
              documentId: "doc-1",
              blobPath: "companies/siyana-info-solutions-pvt-ltd_id/tender-artifacts/manual/date/id/pack.pdf",
              uploadUrl: "https://it1stop.sharepoint.com/upload-session",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (body.intent === "complete") {
          expect(body.documentId).toBe("doc-1");
          expect(body.fileSizeBytes).toBe(1024);
          // No file / base64 in metadata call
          expect(JSON.stringify(body).length).toBeLessThan(2_000);
          return new Response(
            JSON.stringify({ success: true, documentId: "doc-1", message: "Document uploaded." }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
      }
      if (url.includes("sharepoint.com/upload-session")) {
        expect(init?.method).toBe("PUT");
        expect(new Headers(init?.headers).get("Content-Range")).toBe(
          "bytes 0-1023/1024",
        );
        return new Response(null, { status: 201 });
      }
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadTenderDocumentDirectToSharePoint({
      tenderId: "tender-1",
      section: "tender",
      file: makeFile(1024),
    });
    expect(result.ok).toBe(true);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes("sharepoint.com/upload-session"))).toBe(true);
    expect(urls.filter((u) => u.includes("/documents/direct-upload")).length).toBe(2);
  });

  it("links an existing SharePoint file without uploading duplicate bytes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/documents/direct-upload")) {
        const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        if (body.intent === "create" || body.intent == null) {
          return new Response(
            JSON.stringify({
              success: true,
              documentId: "doc-1",
              blobPath: "companies/company/tender-artifacts/manual/date/id/pack.pdf",
              storageUrl: "https://it1stop.sharepoint.com/sites/site/TenderDocs/pack.pdf",
              duplicate: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ success: true, documentId: "doc-1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await uploadTenderDocumentDirectToSharePoint({
      tenderId: "tender-1",
      section: "tender",
      file: makeFile(1024),
    });
    expect(result.ok).toBe(true);
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("sharepoint.com/upload-session"),
      ),
    ).toBe(false);
  });

  it("uses Graph-compatible 320 KiB chunk multiples", () => {
    expect(SHAREPOINT_UPLOAD_CHUNK_BYTES % (320 * 1024)).toBe(0);
    expect(SHAREPOINT_UPLOAD_CHUNK_BYTES).toBeLessThan(60 * 1024 * 1024);
  });

  it("validates common size thresholds used in QA", () => {
    expect(validateDocumentFile(makeFile(1 * 1024 * 1024))).toBeNull();
    expect(validateDocumentFile(makeFile(10 * 1024 * 1024))).toBeNull();
    expect(validateDocumentFile(makeFile(50 * 1024 * 1024))).toBeNull();
    expect(validateDocumentFile(makeFile(100 * 1024 * 1024))).toBeNull();
    expect(
      validateDocumentFile(makeFile(100 * 1024 * 1024 + 1))?.message,
    ).toMatch(/maximum size/i);
  });
});


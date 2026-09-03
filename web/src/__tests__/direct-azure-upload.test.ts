import { describe, expect, it, vi, afterEach } from "vitest";

import { computeDirectUploadSasWindow } from "@/lib/uploads/sasTimeWindow";
import { MAX_DOCUMENT_UPLOAD_BYTES } from "@/lib/uploads/config";
import { uploadTenderDocumentDirectToAzure } from "@/lib/uploads/directAzureUpload";
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

describe("tender direct Azure upload", () => {
  it("rejects oversize files before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await uploadTenderDocumentDirectToAzure({
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

  it("uploads bytes only to the Azure SAS URL, not via FormData to Vercel actions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/documents/direct-upload") && !url.includes("blob.core")) {
        const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        if (body.intent === "create" || body.intent == null) {
          return new Response(
            JSON.stringify({
              success: true,
              documentId: "doc-1",
              blobPath: "co/doc/General/pack.pdf",
              uploadUrl: "https://acct.blob.core.windows.net/container/co/doc/General/pack.pdf?sig=test",
              headers: {
                "x-ms-blob-type": "BlockBlob",
                "Content-Type": "application/pdf",
              },
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
      if (url.includes("blob.core.windows.net")) {
        expect(init?.method).toBe("PUT");
        expect(init?.body).toBeInstanceOf(File);
        return new Response(null, { status: 201 });
      }
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadTenderDocumentDirectToAzure({
      tenderId: "tender-1",
      section: "tender",
      file: makeFile(1024),
    });
    expect(result.ok).toBe(true);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes("blob.core.windows.net"))).toBe(true);
    expect(urls.filter((u) => u.includes("/documents/direct-upload")).length).toBe(2);
  });

  it("uses BlockBlob + Content-Type from /direct-upload and does not add x-ms-version", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/documents/direct-upload") && !url.includes("blob.core")) {
        const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        if (body.intent === "create" || body.intent == null) {
          return new Response(
            JSON.stringify({
              success: true,
              documentId: "doc-1",
              blobPath: "co/doc/General/pack.pdf",
              uploadUrl: "https://acct.blob.core.windows.net/container/co/doc/General/pack.pdf?sig=test",
              headers: {
                "x-ms-blob-type": "BlockBlob",
                "Content-Type": "application/pdf",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ success: true, documentId: "doc-1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("blob.core.windows.net")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("x-ms-blob-type")).toBe("BlockBlob");
        expect(headers.get("Content-Type")).toBe("application/pdf");
        expect(headers.has("x-ms-version")).toBe(false);
        return new Response(null, { status: 201 });
      }
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await uploadTenderDocumentDirectToAzure({
      tenderId: "tender-1",
      section: "tender",
      file: makeFile(1024),
    });
    expect(result.ok).toBe(true);
  });

  it("uses a UTC SAS window of -5 minutes to +30 minutes", () => {
    const now = Date.parse("2026-09-03T06:56:00.000Z");
    const window = computeDirectUploadSasWindow(now);
    expect(window.startsOn.toISOString()).toBe("2026-09-03T06:51:00.000Z");
    expect(window.expiresOn.toISOString()).toBe("2026-09-03T07:26:00.000Z");
    expect(window.validityDurationMs).toBe(35 * 60 * 1000);
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


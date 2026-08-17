/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

import { encodeAzureBlockId, azureBlockLabel } from "@/lib/uploads/blockIds";
import { CHUNK_SIZE } from "@/lib/uploads/config";
import { UploadError } from "@/lib/uploads/errors";
import {
  formatUploadBytes,
  totalChunksForSize,
  uploadPercentage,
} from "@/lib/uploads/progress";
import type { ChunkedUploadApi, DocumentUploadMetadata } from "@/lib/uploads/types";
import { UploadManager } from "@/lib/uploads/uploadManager";
import { validateDocumentFile } from "@/lib/uploads/validation";

const metadata: DocumentUploadMetadata = {
  name: "Tender pack",
  uploadKind: "general",
};

function makeFile(name: string, size: number, type = "application/pdf") {
  const file = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  file.slice = (start = 0, end = size) => {
    const length = Math.max(0, Math.min(size, end) - start);
    return new Blob([new Uint8Array(Math.min(length, 8))]);
  };
  return file;
}

function mockApi(overrides?: Partial<ChunkedUploadApi>): ChunkedUploadApi & {
  calls: { chunks: number[]; completes: number; aborts: number; sessions: number };
} {
  const calls = { chunks: [] as number[], completes: 0, aborts: 0, sessions: 0 };
  const received = new Set<number>();
  const api: ChunkedUploadApi & { calls: typeof calls } = {
    calls,
    async createSession(input) {
      calls.sessions += 1;
      const totalChunks = totalChunksForSize(input.fileSizeBytes, CHUNK_SIZE);
      return {
        uploadId: "upload-1",
        documentId: "doc-1",
        chunkSize: CHUNK_SIZE,
        totalChunks,
      };
    },
    async uploadChunk(input) {
      calls.chunks.push(input.chunkIndex);
      received.add(input.chunkIndex);
      return {
        success: true,
        chunkIndex: input.chunkIndex,
        receivedIndexes: [...received],
      };
    },
    async completeUpload() {
      calls.completes += 1;
      return { success: true, documentId: "doc-1" };
    },
    async abortUpload() {
      calls.aborts += 1;
    },
    ...overrides,
  };
  return api;
}

describe("upload progress math", () => {
  it("calculates percentage from uploaded bytes", () => {
    const total = 50 * 1024 * 1024;
    const uploaded = 4 * CHUNK_SIZE;
    expect(uploadPercentage(uploaded, total)).toBe(40);
    expect(totalChunksForSize(total, CHUNK_SIZE)).toBe(10);
    expect(formatUploadBytes(total)).toBe("50.0 MB");
  });

  it("stays at 100 when finalizing", () => {
    expect(uploadPercentage(50 * 1024 * 1024, 50 * 1024 * 1024)).toBe(100);
  });
});

describe("azure block ids", () => {
  it("uses deterministic padded labels and base64 ids", () => {
    expect(azureBlockLabel(0)).toBe("block-000001");
    expect(azureBlockLabel(6)).toBe("block-000007");
    expect(encodeAzureBlockId(0)).toBe(btoa("block-000001"));
    expect(encodeAzureBlockId(0).length).toBe(encodeAzureBlockId(9).length);
  });
});

describe("file validation", () => {
  it("rejects empty, oversized, and unsupported files", () => {
    expect(validateDocumentFile(makeFile("a.pdf", 0))?.code).toBe("empty_file");
    expect(
      validateDocumentFile(makeFile("a.pdf", 101 * 1024 * 1024))?.code,
    ).toBe("file_too_large");
    expect(validateDocumentFile(makeFile("a.exe", 1000))?.code).toBe(
      "unsupported_type",
    );
    expect(validateDocumentFile(makeFile("pack.zip", 2048, "application/zip"))).toBeNull();
  });
});

describe("UploadManager", () => {
  it("uploads a small file as a single chunk then finalizes", async () => {
    const api = mockApi();
    const manager = new UploadManager({ api, concurrency: 2 });
    const id = manager.addFile(makeFile("small.pdf", 1200), metadata);
    const states: string[] = [];
    manager.subscribe((items) => {
      const status = items[0]?.status;
      if (status && states.at(-1) !== status) states.push(status);
    });
    const result = await manager.start(id);
    expect(result.status).toBe("complete");
    expect(result.percentage).toBe(100);
    expect(api.calls.chunks).toEqual([0]);
    expect(api.calls.completes).toBe(1);
    expect(states).toContain("preparing");
    expect(states).toContain("uploading");
    expect(states).toContain("finalizing");
    expect(states.at(-1)).toBe("complete");
  });

  it("splits a large file into 5 MB chunks with bounded concurrency", async () => {
    const active: number[] = [];
    let maxActive = 0;
    const received = new Set<number>();
    const api = mockApi({
      async uploadChunk(input) {
        active.push(1);
        maxActive = Math.max(maxActive, active.length);
        await Promise.resolve();
        active.pop();
        received.add(input.chunkIndex);
        return {
          success: true,
          chunkIndex: input.chunkIndex,
          receivedIndexes: [...received],
        };
      },
    });
    const manager = new UploadManager({ api, concurrency: 2 });
    const size = 50 * 1024 * 1024;
    const id = manager.addFile(makeFile("Tender_All_Documents.zip", size, "application/zip"), metadata);
    const result = await manager.start(id);
    expect(result.status).toBe("complete");
    expect(result.totalChunks).toBe(10);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(api.calls.completes).toBe(1);
  });

  it("retries only the failed middle chunk", async () => {
    let attemptsForSix = 0;
    const received = new Set<number>();
    const api = mockApi({
      async uploadChunk(input) {
        if (input.chunkIndex === 6) {
          attemptsForSix += 1;
          if (attemptsForSix === 1) {
            throw new UploadError("chunk_failed", "Chunk upload failed", {
              retryable: true,
            });
          }
        }
        received.add(input.chunkIndex);
        return {
          success: true,
          chunkIndex: input.chunkIndex,
          receivedIndexes: [...received],
        };
      },
    });
    const manager = new UploadManager({ api, concurrency: 1 });
    vi.useFakeTimers();
    const id = manager.addFile(makeFile("pack.pdf", 10 * CHUNK_SIZE), metadata);
    const start = manager.start(id);
    await vi.runAllTimersAsync();
    const result = await start;
    vi.useRealTimers();
    expect(result.status).toBe("complete");
    expect(attemptsForSix).toBe(2);
  });

  it("marks failed after chunk retry exhaustion", async () => {
    const api = mockApi({
      async uploadChunk() {
        throw new UploadError("chunk_failed", "Chunk upload failed", {
          retryable: true,
        });
      },
    });
    const manager = new UploadManager({ api, concurrency: 1 });
    vi.useFakeTimers();
    const id = manager.addFile(makeFile("pack.pdf", CHUNK_SIZE * 2), metadata);
    const start = manager.start(id);
    await vi.runAllTimersAsync();
    const result = await start;
    vi.useRealTimers();
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Chunk upload failed");
    expect(api.calls.completes).toBe(0);
  });

  it("cancels in-flight uploads and aborts the session", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = mockApi({
      async uploadChunk(input, signal) {
        await gate;
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return { success: true, chunkIndex: input.chunkIndex };
      },
    });
    const manager = new UploadManager({ api, concurrency: 1 });
    const id = manager.addFile(makeFile("pack.pdf", CHUNK_SIZE * 3), metadata);
    const start = manager.start(id);
    await Promise.resolve();
    await manager.cancel(id);
    release();
    await start;
    const state = manager.getItem(id);
    expect(state?.status).toBe("cancelled");
    expect(api.calls.aborts).toBe(1);
    expect(api.calls.completes).toBe(0);
  });

  it("keeps 100% while finalizing then fails without completing", async () => {
    const seen: Array<{ status: string; percentage: number }> = [];
    let completeAttempts = 0;
    const api = mockApi({
      async completeUpload() {
        completeAttempts += 1;
        throw new UploadError("finalize_failed", "Storage unavailable");
      },
    });
    const manager = new UploadManager({ api, concurrency: 2 });
    const id = manager.addFile(makeFile("pack.pdf", CHUNK_SIZE), metadata);
    manager.subscribe((items) => {
      const item = items[0];
      if (item) seen.push({ status: item.status, percentage: item.percentage });
    });
    const result = await manager.start(id);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Storage unavailable");
    expect(
      seen.some((entry) => entry.status === "finalizing" && entry.percentage === 100),
    ).toBe(true);
    expect(completeAttempts).toBe(1);
  });

  it("retries finalization without re-uploading finished chunks", async () => {
    let completeAttempts = 0;
    const api = mockApi({
      async completeUpload() {
        completeAttempts += 1;
        if (completeAttempts === 1) {
          throw new UploadError("metadata_failed", "document record could not be saved");
        }
        return { success: true, documentId: "doc-1" };
      },
    });
    const manager = new UploadManager({ api, concurrency: 1 });
    const id = manager.addFile(makeFile("pack.pdf", 800), metadata);
    const first = await manager.start(id);
    expect(first.status).toBe("failed");
    const chunkCount = api.calls.chunks.length;
    const second = await manager.retry(id);
    expect(second.status).toBe("complete");
    expect(api.calls.chunks.length).toBe(chunkCount);
    expect(completeAttempts).toBe(2);
  });

  it("creates a fresh session when the previous one expired", async () => {
    const api = mockApi({
      async uploadChunk() {
        throw new UploadError("session_expired", "Upload session expired");
      },
    });
    const manager = new UploadManager({ api, concurrency: 1 });
    const id = manager.addFile(makeFile("pack.pdf", CHUNK_SIZE), metadata);
    const first = await manager.start(id);
    expect(first.status).toBe("failed");
    expect(first.uploadId).toBeNull();
    await manager.retry(id);
    expect(api.calls.sessions).toBe(2);
  });
});

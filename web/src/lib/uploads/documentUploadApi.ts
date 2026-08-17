import { UPLOAD_CHUNK_TIMEOUT_MS } from "@/lib/uploads/config";
import {
  uploadErrorFromHttpStatus,
  uploadErrorFromUnknown,
} from "@/lib/uploads/errors";
import type {
  ChunkedUploadApi,
  CompleteUploadResult,
  CreateUploadSessionInput,
  UploadChunkResult,
  UploadSession,
} from "@/lib/uploads/types";

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(body: Record<string, unknown>): string | null {
  const error = body.error;
  return typeof error === "string" && error.trim() ? error : null;
}

async function ensureOk(
  response: Response,
  body: Record<string, unknown>,
): Promise<void> {
  if (response.ok && body.success !== false) return;
  throw uploadErrorFromHttpStatus(response.status, errorMessage(body));
}

export function createDocumentUploadApi(
  timeoutMs = UPLOAD_CHUNK_TIMEOUT_MS,
): ChunkedUploadApi {
  return {
    async createSession(
      input: CreateUploadSessionInput,
      signal?: AbortSignal,
    ): Promise<UploadSession> {
      const response = await fetch("/api/documents/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
      const body = await parseJson(response);
      await ensureOk(response, body);
      const uploadId = String(body.uploadId || "");
      const documentId = String(body.documentId || "");
      const chunkSize = Number(body.chunkSize);
      const totalChunks = Number(body.totalChunks);
      if (!uploadId || !documentId || !chunkSize || !totalChunks) {
        throw uploadErrorFromHttpStatus(500, "Invalid upload session response");
      }
      return { uploadId, documentId, chunkSize, totalChunks };
    },

    async uploadChunk(input, signal?: AbortSignal): Promise<UploadChunkResult> {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(
          `/api/documents/uploads/${encodeURIComponent(input.uploadId)}/chunks?index=${input.chunkIndex}&total=${input.totalChunks}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/octet-stream",
              "x-block-id": input.blockId,
            },
            body: input.chunk,
            signal: controller.signal,
          },
        );
        const body = await parseJson(response);
        await ensureOk(response, body);
        return {
          success: true,
          chunkIndex: input.chunkIndex,
          receivedIndexes: Array.isArray(body.receivedIndexes)
            ? body.receivedIndexes.map((n) => Number(n))
            : undefined,
          uploadedBytes:
            typeof body.uploadedBytes === "number"
              ? body.uploadedBytes
              : undefined,
        };
      } catch (error) {
        throw uploadErrorFromUnknown(error, {
          code: "chunk_failed",
          message: "Chunk upload failed",
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },

    async completeUpload(input, signal?: AbortSignal): Promise<CompleteUploadResult> {
      const response = await fetch(
        `/api/documents/uploads/${encodeURIComponent(input.uploadId)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentHash: input.contentHash ?? null }),
          signal,
        },
      );
      const body = await parseJson(response);
      await ensureOk(response, body);
      return {
        success: true,
        documentId: String(body.documentId || ""),
      };
    },

    async abortUpload(input, signal?: AbortSignal): Promise<void> {
      const response = await fetch(
        `/api/documents/uploads/${encodeURIComponent(input.uploadId)}/abort`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal,
        },
      );
      if (response.status === 404) return;
      const body = await parseJson(response);
      await ensureOk(response, body);
    },
  };
}

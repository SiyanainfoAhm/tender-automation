import { encodeAzureBlockId } from "@/lib/uploads/blockIds";
import {
  CHUNK_RETRY_BACKOFF_MS,
  CHUNK_SIZE,
  MAX_CHUNK_RETRIES,
  UPLOAD_CHUNK_CONCURRENCY,
} from "@/lib/uploads/config";
import { createDocumentUploadApi } from "@/lib/uploads/documentUploadApi";
import {
  isAbortError,
  UploadError,
  uploadErrorFromUnknown,
} from "@/lib/uploads/errors";
import {
  chunkByteRange,
  totalChunksForSize,
  uploadedBytesFromIndexes,
  uploadPercentage,
} from "@/lib/uploads/progress";
import type {
  ChunkedUploadApi,
  DocumentUploadMetadata,
  FileUploadProgressState,
  UploadSession,
  UploadStatus,
} from "@/lib/uploads/types";
import {
  validateDocumentFile,
  validateDocumentMetadata,
} from "@/lib/uploads/validation";

export type UploadManagerListener = (items: FileUploadProgressState[]) => void;

type InternalItem = {
  id: string;
  file: File;
  metadata: DocumentUploadMetadata;
  session: UploadSession | null;
  received: Set<number>;
  uploadedBytes: number;
  currentChunk: number;
  totalChunks: number;
  chunkSize: number;
  status: UploadStatus;
  error: string | null;
  abortController: AbortController;
  cancelled: boolean;
  finalizeFailed: boolean;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class UploadManager {
  private readonly api: ChunkedUploadApi;
  private readonly items = new Map<string, InternalItem>();
  private readonly listeners = new Set<UploadManagerListener>();
  private readonly concurrency: number;
  private readonly chunkSize: number;

  constructor(options?: {
    api?: ChunkedUploadApi;
    concurrency?: number;
    chunkSize?: number;
  }) {
    this.api = options?.api ?? createDocumentUploadApi();
    this.concurrency = options?.concurrency ?? UPLOAD_CHUNK_CONCURRENCY;
    this.chunkSize = options?.chunkSize ?? CHUNK_SIZE;
  }

  subscribe(listener: UploadManagerListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getItem(id: string): FileUploadProgressState | null {
    const item = this.items.get(id);
    return item ? this.toState(item) : null;
  }

  snapshot(): FileUploadProgressState[] {
    return [...this.items.values()].map((item) => this.toState(item));
  }

  clear(): void {
    this.items.clear();
    this.emit();
  }

  addFile(file: File, metadata: DocumentUploadMetadata): string {
    const id = newId();
    this.items.set(id, {
      id,
      file,
      metadata,
      session: null,
      received: new Set(),
      uploadedBytes: 0,
      currentChunk: 0,
      totalChunks: totalChunksForSize(file.size, this.chunkSize),
      chunkSize: this.chunkSize,
      status: "queued",
      error: null,
      abortController: new AbortController(),
      cancelled: false,
      finalizeFailed: false,
    });
    this.emit();
    return id;
  }

  async start(id: string): Promise<FileUploadProgressState> {
    const item = this.requireItem(id);
    try {
      await this.run(item);
    } catch (error) {
      this.failItem(item, error);
    }
    this.emit();
    return this.toState(item);
  }

  async cancel(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;
    if (item.status === "complete" || item.status === "cancelled") return;

    item.cancelled = true;
    item.abortController.abort();
    item.status = "cancelled";
    item.error = "Cancelled";
    this.emit();

    const uploadId = item.session?.uploadId;
    if (!uploadId) return;
    try {
      await this.api.abortUpload({ uploadId });
    } catch {
      // Best-effort server cleanup; UI already reflects cancel.
    }
  }

  async retry(id: string): Promise<FileUploadProgressState> {
    const item = this.requireItem(id);
    if (item.status !== "failed") return this.toState(item);

    item.cancelled = false;
    item.error = null;
    item.abortController = new AbortController();
    try {
      await this.run(item, { resume: true });
    } catch (error) {
      this.failItem(item, error);
    }
    this.emit();
    return this.toState(item);
  }

  private async run(
    item: InternalItem,
    options?: { resume?: boolean },
  ): Promise<void> {
    const fileError = validateDocumentFile(item.file);
    if (fileError) throw fileError;
    const metaError = validateDocumentMetadata(item.metadata);
    if (metaError) throw metaError;

    item.status = "preparing";
    item.error = null;
    this.emit();

    const canResume =
      Boolean(options?.resume) &&
      Boolean(item.session?.uploadId) &&
      !item.cancelled;

    if (!canResume) {
      item.session = null;
      item.received = new Set();
      item.uploadedBytes = 0;
      item.finalizeFailed = false;
    }

    if (!item.session) {
      try {
        item.session = await this.api.createSession(
          {
            ...item.metadata,
            fileName: item.file.name,
            mimeType: item.file.type || "application/octet-stream",
            fileSizeBytes: item.file.size,
          },
          item.abortController.signal,
        );
      } catch (error) {
        throw this.wrapSessionError(error);
      }
    }

    item.chunkSize = item.session.chunkSize || this.chunkSize;
    item.totalChunks =
      item.session.totalChunks ||
      totalChunksForSize(item.file.size, item.chunkSize);

    if (!item.finalizeFailed) {
      item.status = "uploading";
      this.syncProgress(item);
      this.emit();
      await this.uploadMissingChunks(item);
    }

    this.throwIfCancelled(item);

    item.status = "finalizing";
    item.uploadedBytes = item.file.size;
    item.currentChunk = item.totalChunks;
    this.emit();

    try {
      const completed = await this.api.completeUpload(
        { uploadId: item.session.uploadId },
        item.abortController.signal,
      );
      item.session.documentId = completed.documentId || item.session.documentId;
      item.finalizeFailed = false;
    } catch (error) {
      this.throwIfCancelled(item);
      item.finalizeFailed = true;
      throw new UploadError(
        "finalize_failed",
        error instanceof UploadError ? error.message : "Storage unavailable",
        { cause: error, retryable: true },
      );
    }

    this.throwIfCancelled(item);
    item.status = "complete";
    item.error = null;
    item.uploadedBytes = item.file.size;
  }

  private async uploadMissingChunks(item: InternalItem): Promise<void> {
    const pending = Array.from(
      { length: item.totalChunks },
      (_, index) => index,
    ).filter((index) => !item.received.has(index));

    if (pending.length === 0) return;

    let cursor = 0;
    const workerCount = Math.max(
      1,
      Math.min(this.concurrency, pending.length),
    );
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < pending.length) {
        this.throwIfCancelled(item);
        const index = pending[cursor];
        cursor += 1;
        if (index == null || item.received.has(index)) continue;
        await this.uploadChunkWithRetry(item, index);
      }
    });
    await Promise.all(workers);
  }

  private async uploadChunkWithRetry(
    item: InternalItem,
    chunkIndex: number,
  ): Promise<void> {
    const session = item.session;
    if (!session) {
      throw new UploadError("session_expired", "Upload session expired");
    }

    let lastError: unknown;
    const attempts = MAX_CHUNK_RETRIES + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      this.throwIfCancelled(item);
      try {
        const range = chunkByteRange(
          item.file.size,
          item.chunkSize,
          chunkIndex,
        );
        const blob = item.file.slice(range.start, range.end);
        item.currentChunk = chunkIndex + 1;
        this.emit();
        const result = await this.api.uploadChunk(
          {
            uploadId: session.uploadId,
            chunkIndex,
            totalChunks: item.totalChunks,
            blockId: encodeAzureBlockId(chunkIndex),
            chunk: blob,
          },
          item.abortController.signal,
        );
        if (Array.isArray(result.receivedIndexes)) {
          for (const received of result.receivedIndexes) {
            item.received.add(received);
          }
        } else {
          item.received.add(chunkIndex);
        }
        item.uploadedBytes =
          result.uploadedBytes ??
          uploadedBytesFromIndexes(
            item.file.size,
            item.chunkSize,
            item.received,
          );
        this.emit();
        return;
      } catch (error) {
        lastError = error;
        this.throwIfCancelled(item);
        const mapped = uploadErrorFromUnknown(error, {
          code: "chunk_failed",
          message: "Chunk upload failed",
        });
        if (mapped.code === "session_expired") throw mapped;
        if (attempt >= MAX_CHUNK_RETRIES) break;
        const backoff =
          CHUNK_RETRY_BACKOFF_MS[
            Math.min(attempt, CHUNK_RETRY_BACKOFF_MS.length - 1)
          ] ?? 1000;
        await sleep(backoff, item.abortController.signal);
      }
    }

    throw uploadErrorFromUnknown(lastError, {
      code: "chunk_failed",
      message: "Chunk upload failed",
    });
  }

  private wrapSessionError(error: unknown): UploadError {
    const mapped = uploadErrorFromUnknown(error, {
      code: "storage_unavailable",
      message: "Storage unavailable",
    });
    if (mapped.code === "unknown") {
      return new UploadError("storage_unavailable", mapped.message, {
        cause: error,
        retryable: true,
      });
    }
    return mapped;
  }

  private failItem(item: InternalItem, error: unknown): void {
    if (item.cancelled || isAbortError(error)) {
      item.status = "cancelled";
      item.error = "Cancelled";
      return;
    }
    if (error instanceof UploadError && error.code === "cancelled") {
      item.status = "cancelled";
      item.error = "Cancelled";
      return;
    }
    const mapped = uploadErrorFromUnknown(error, {
      code: "unknown",
      message: "Upload failed",
    });
    item.status = "failed";
    item.error = mapped.message;
    if (mapped.code === "session_expired") {
      item.session = null;
      item.received = new Set();
      item.finalizeFailed = false;
    }
  }

  private throwIfCancelled(item: InternalItem): void {
    if (item.cancelled || item.abortController.signal.aborted) {
      throw new UploadError("cancelled", "Cancelled");
    }
  }

  private syncProgress(item: InternalItem): void {
    item.uploadedBytes = uploadedBytesFromIndexes(
      item.file.size,
      item.chunkSize,
      item.received,
    );
    item.currentChunk = item.received.size;
  }

  private requireItem(id: string): InternalItem {
    const item = this.items.get(id);
    if (!item) {
      throw new UploadError("unknown", "Upload was not found");
    }
    return item;
  }

  private toState(item: InternalItem): FileUploadProgressState {
    return {
      id: item.id,
      fileName: item.file.name,
      uploadedBytes: item.uploadedBytes,
      totalBytes: item.file.size,
      percentage: uploadPercentage(item.uploadedBytes, item.file.size),
      currentChunk: item.currentChunk,
      totalChunks: item.totalChunks,
      status: item.status,
      error: item.error,
      documentId: item.session?.documentId ?? null,
      uploadId: item.session?.uploadId ?? null,
    };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function createUploadManager(options?: {
  api?: ChunkedUploadApi;
  concurrency?: number;
  chunkSize?: number;
}): UploadManager {
  return new UploadManager(options);
}

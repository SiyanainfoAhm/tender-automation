export type UploadStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "finalizing"
  | "complete"
  | "failed"
  | "cancelled";

export type UploadKind = "general" | "certificate" | "financial";

export type DocumentUploadMetadata = {
  name: string;
  uploadKind: UploadKind;
  notes?: string;
  certificateType?: string;
  issuingAuthority?: string;
  issueDate?: string;
  expiryDate?: string;
  financialYear?: string;
  documentType?: string;
};

export type FileUploadProgressState = {
  id: string;
  fileName: string;
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
  currentChunk: number;
  totalChunks: number;
  status: UploadStatus;
  error: string | null;
  documentId: string | null;
  uploadId: string | null;
};

export type UploadSession = {
  uploadId: string;
  documentId: string;
  chunkSize: number;
  totalChunks: number;
};

export type CreateUploadSessionInput = DocumentUploadMetadata & {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
};

export type UploadChunkResult = {
  success: boolean;
  chunkIndex: number;
  receivedIndexes?: number[];
  uploadedBytes?: number;
  error?: string;
};

export type CompleteUploadResult = {
  success: boolean;
  documentId: string;
};

export type ChunkedUploadApi = {
  createSession(
    input: CreateUploadSessionInput,
    signal?: AbortSignal,
  ): Promise<UploadSession>;
  uploadChunk(
    input: {
      uploadId: string;
      chunkIndex: number;
      totalChunks: number;
      blockId: string;
      chunk: Blob;
    },
    signal?: AbortSignal,
  ): Promise<UploadChunkResult>;
  completeUpload(
    input: { uploadId: string; contentHash?: string | null },
    signal?: AbortSignal,
  ): Promise<CompleteUploadResult>;
  abortUpload(
    input: { uploadId: string },
    signal?: AbortSignal,
  ): Promise<void>;
};

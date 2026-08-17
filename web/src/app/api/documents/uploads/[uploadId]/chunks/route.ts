import { StorageNotConfiguredError } from "@/lib/storage/documentStorageProvider";
import {
  StorageFunctionError,
  getDocumentStorageProvider,
} from "@/server/storage/edgeDocumentStorageProvider";
import {
  jsonError,
  requireDocumentUploader,
} from "@/server/uploads/requireDocumentUploader";

export const maxDuration = 120;

type RouteContext = {
  params: Promise<{ uploadId: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const auth = await requireDocumentUploader();
    if (auth.error) return auth.error;

    const { uploadId } = await context.params;
    if (!uploadId) return jsonError("uploadId is required", 400);

    const url = new URL(request.url);
    const chunkIndex = Number(url.searchParams.get("index"));
    const totalChunks = Number(url.searchParams.get("total"));
    const blockId = request.headers.get("x-block-id") || "";
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return jsonError("chunkIndex is required", 400);
    }
    if (!Number.isInteger(totalChunks) || totalChunks < 1) {
      return jsonError("totalChunks is required", 400);
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    const provider = getDocumentStorageProvider();
    const result = await provider.uploadChunk({
      uploadId,
      chunkIndex,
      totalChunks,
      blockId,
      bytes,
    });

    return Response.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return jsonError("Storage unavailable", 503);
    }
    if (error instanceof StorageFunctionError) {
      return jsonError(error.message, error.status || 500);
    }
    console.error("[documents] chunk upload failed", error);
    return jsonError(
      error instanceof Error ? error.message : "Chunk upload failed",
      500,
    );
  }
}

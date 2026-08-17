import { StorageNotConfiguredError } from "@/lib/storage/documentStorageProvider";
import {
  StorageFunctionError,
  getDocumentStorageProvider,
} from "@/server/storage/edgeDocumentStorageProvider";
import {
  jsonError,
  requireDocumentUploader,
} from "@/server/uploads/requireDocumentUploader";

type RouteContext = {
  params: Promise<{ uploadId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const auth = await requireDocumentUploader();
    if (auth.error) return auth.error;

    const { uploadId } = await context.params;
    if (!uploadId) return jsonError("uploadId is required", 400);

    const provider = getDocumentStorageProvider();
    await provider.abortUpload({ uploadId });
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return jsonError("Storage unavailable", 503);
    }
    if (error instanceof StorageFunctionError) {
      return jsonError(error.message, error.status || 500);
    }
    console.error("[documents] abort upload failed", error);
    return jsonError(
      error instanceof Error ? error.message : "Unable to cancel upload.",
      500,
    );
  }
}

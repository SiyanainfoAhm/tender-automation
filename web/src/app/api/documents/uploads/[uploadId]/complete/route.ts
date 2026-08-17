import { revalidatePath } from "next/cache";

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

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireDocumentUploader();
    if (auth.error) return auth.error;

    const { uploadId } = await context.params;
    if (!uploadId) return jsonError("uploadId is required", 400);

    const body = (await request.json().catch(() => ({}))) as {
      contentHash?: string | null;
    };

    const provider = getDocumentStorageProvider();
    const result = await provider.completeUpload({
      uploadId,
      contentHash: body.contentHash ?? null,
    });

    revalidatePath("/documents");
    revalidatePath("/dashboard");

    return Response.json({
      success: true,
      documentId: result.documentId,
      document: result,
    });
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return jsonError("Storage unavailable", 503);
    }
    if (error instanceof StorageFunctionError) {
      return jsonError(error.message, error.status || 500);
    }
    console.error("[documents] complete upload failed", error);
    return jsonError(
      error instanceof Error ? error.message : "Unable to finalize document.",
      500,
    );
  }
}

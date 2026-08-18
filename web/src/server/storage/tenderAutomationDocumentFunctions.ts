import "server-only";

import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/server/auth/session";

const FUNCTION_NAME = "tender-automation-company-documents";

type EdgeJson = {
  success?: boolean;
  error?: string;
  documentId?: string;
  document?: unknown;
  uploadId?: string;
  chunkSize?: number;
  totalChunks?: number;
  chunkIndex?: number;
  receivedIndexes?: number[];
  uploadedBytes?: number;
  templateId?: string;
  companySignatoryUrl?: string | null;
  companySignStampUrl?: string | null;
  experienceId?: string;
  workOrderUrl?: string | null;
  completionCertificateUrl?: string | null;
  workspaceDocumentId?: string;
};

type EdgeResult = EdgeJson & { status: number };

function resolveServiceKey(): string {
  return (
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

async function invokeCompanyDocumentsRaw(
  init: RequestInit,
): Promise<Response> {
  const base = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const key = resolveServiceKey();
  if (!base || !key) {
    return Response.json(
      {
        success: false,
        error: "Document storage is not configured correctly.",
      },
      { status: 503 },
    );
  }

  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    return Response.json(
      { success: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  return fetch(`${base}/functions/v1/${FUNCTION_NAME}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${key}`,
      apikey: key,
      "x-agenttender-session": sessionToken,
    },
  });
}

async function invokeCompanyDocuments(
  init: RequestInit,
): Promise<EdgeResult> {
  const response = await invokeCompanyDocumentsRaw(init);
  const body = (await response.json().catch(() => ({
    success: false,
    error: "Invalid response from document storage function.",
  }))) as EdgeJson;
  return { ...body, status: response.status };
}

export async function invokeDocumentUpload(
  formData: FormData,
): Promise<EdgeResult> {
  if (!formData.get("action")) formData.set("action", "upload");
  return invokeCompanyDocuments({ method: "POST", body: formData });
}

export async function invokeCreateUploadSession(
  payload: Record<string, unknown>,
): Promise<EdgeResult> {
  return invokeCompanyDocuments({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create-upload-session", ...payload }),
  });
}

export async function invokeUploadChunk(input: {
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  blockId: string;
  bytes: Uint8Array;
}): Promise<EdgeResult> {
  return invokeCompanyDocuments({
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-upload-action": "upload-chunk",
      "x-upload-id": input.uploadId,
      "x-chunk-index": String(input.chunkIndex),
      "x-total-chunks": String(input.totalChunks),
      "x-block-id": input.blockId,
    },
    body: Buffer.from(input.bytes),
  });
}

export async function invokeCompleteUpload(input: {
  uploadId: string;
  contentHash?: string | null;
}): Promise<EdgeResult> {
  return invokeCompanyDocuments({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "complete-upload",
      uploadId: input.uploadId,
      contentHash: input.contentHash ?? null,
    }),
  });
}

export async function invokeAbortUpload(input: {
  uploadId: string;
}): Promise<EdgeResult> {
  return invokeCompanyDocuments({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "abort-upload",
      uploadId: input.uploadId,
    }),
  });
}

export async function invokeDocumentDelete(
  documentId: string,
): Promise<EdgeJson> {
  return invokeCompanyDocuments({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", documentId }),
  });
}

export async function invokeDocumentRead(
  documentId: string,
  disposition: "inline" | "attachment" = "inline",
): Promise<Response> {
  return invokeCompanyDocumentsRaw({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "document-read",
      documentId,
      disposition,
    }),
  });
}

export async function invokeTemplateAssetsSave(options: {
  templateId: string;
  templateName: string;
  companySignStamp?: File | null;
  cleanupLegacyLogo?: boolean;
}): Promise<EdgeJson> {
  const formData = new FormData();
  formData.set("action", "template-assets-save");
  formData.set("templateId", options.templateId);
  formData.set("templateName", options.templateName);
  if (options.cleanupLegacyLogo) {
    formData.set("cleanupLegacyLogo", "true");
  }
  if (options.companySignStamp) {
    formData.set("companySignStamp", options.companySignStamp);
  }
  return invokeCompanyDocuments({ method: "POST", body: formData });
}

export async function invokeTemplateAssetsDelete(
  templateId: string,
): Promise<EdgeJson> {
  return invokeCompanyDocuments({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "template-assets-delete",
      templateId,
    }),
  });
}

export async function invokeTemplateAssetRead(
  templateId: string,
  assetType: "logo" | "signatory",
): Promise<Response> {
  return invokeCompanyDocumentsRaw({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "template-asset-read",
      templateId,
      assetType,
    }),
  });
}

export async function invokeExperienceAssetsSave(options: {
  experienceId: string;
  projectName: string;
  workOrder?: File | null;
  completionCertificate?: File | null;
  clearCompletionCertificate?: boolean;
}): Promise<EdgeJson> {
  const formData = new FormData();
  formData.set("action", "experience-assets-save");
  formData.set("experienceId", options.experienceId);
  formData.set("projectName", options.projectName);
  if (options.clearCompletionCertificate) {
    formData.set("clearCompletionCertificate", "true");
  }
  if (options.workOrder) formData.set("workOrder", options.workOrder);
  if (options.completionCertificate) {
    formData.set("completionCertificate", options.completionCertificate);
  }
  return invokeCompanyDocuments({ method: "POST", body: formData });
}

export async function invokeExperienceAssetsDelete(
  experienceId: string,
): Promise<EdgeJson> {
  return invokeCompanyDocuments({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "experience-assets-delete",
      experienceId,
    }),
  });
}

export async function invokeExperienceAssetRead(
  experienceId: string,
  assetType: "work-order" | "completion-certificate",
): Promise<Response> {
  return invokeCompanyDocumentsRaw({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "experience-asset-read",
      experienceId,
      assetType,
    }),
  });
}

export async function invokeWorkspaceDocumentSave(options: {
  workspaceId: string;
  tenderId: string;
  tenderReference: string;
  documentId?: string;
  documentType: string;
  title: string;
  file: File;
}): Promise<EdgeJson> {
  const formData = new FormData();
  formData.set("action", "workspace-document-save");
  formData.set("workspaceId", options.workspaceId);
  formData.set("tenderId", options.tenderId);
  formData.set("tenderReference", options.tenderReference);
  formData.set("documentType", options.documentType);
  formData.set("title", options.title);
  if (options.documentId) formData.set("documentId", options.documentId);
  formData.set("file", options.file);
  return invokeCompanyDocuments({ method: "POST", body: formData });
}

export async function invokeWorkspaceDocumentDelete(
  documentId: string,
): Promise<EdgeJson> {
  return invokeCompanyDocuments({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "workspace-document-delete",
      documentId,
    }),
  });
}

export async function invokeWorkspaceDocumentRead(
  documentId: string,
): Promise<Response> {
  return invokeCompanyDocumentsRaw({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "workspace-document-read",
      documentId,
    }),
  });
}

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-agenttender-session, x-upload-action, x-upload-id, x-chunk-index, x-total-chunks, x-block-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_COMPANY_DOCUMENT_BYTES = 100 * 1024 * 1024;
const CHUNK_SIZE = 5 * 1024 * 1024;
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_EXT = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".zip"];
const ALLOWED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/octet-stream",
];
const TEMPLATE_SIGN_STAMP_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
];
const TEMPLATE_SIGN_STAMP_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
];
const GENERIC_TEMPLATE_ASSET_MIME = new Set(["", "application/octet-stream"]);
const UPLOAD_ROLES = new Set([
  "ADMIN",
  "BID_MANAGER",
  "TECHNICAL_LEAD",
  "FINANCIAL_ANALYST",
  "DOCUMENT_SPECIALIST",
]);
const DELETE_ROLES = new Set(["ADMIN", "DOCUMENT_SPECIALIST"]);
const TEMPLATE_ROLES = new Set(["ADMIN", "BID_MANAGER"]);
const BID_WORKSPACE_ROLES = new Set([
  "ADMIN",
  "BID_MANAGER",
  "TECHNICAL_LEAD",
  "FINANCIAL_ANALYST",
  "BID_COORDINATOR",
  "DOCUMENT_SPECIALIST",
]);

type Category = "General" | "Certificate" | "Financial";
type AuthUser = {
  id: string;
  role: string;
  companyId: string;
  companyName: string;
};

type AzureConfig = {
  accountName: string;
  containerName: string;
  sasToken: string;
};

type AzureUploadResult = {
  blobName: string;
  storageUrl: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireAzureConfig(): AzureConfig {
  const accountName = Deno.env.get("TENDER_AUTOMATION_AZURE_STORAGE_ACCOUNT_NAME")?.trim();
  const containerName = Deno.env.get("TENDER_AUTOMATION_AZURE_STORAGE_CONTAINER_NAME")?.trim();
  const sasToken = Deno.env.get("TENDER_AUTOMATION_AZURE_STORAGE_SAS_TOKEN")?.trim();

  if (!accountName || !containerName || !sasToken) {
    throw new ConfigError();
  }

  const azure = { accountName, containerName, sasToken };
  validateFullSasUrlAgainstConfig(azure);
  normalizeSas(azure.sasToken);

  const sas = getSafeSasInfo(azure.sasToken);
  if (!String(sas.sp || "").includes("r")) {
    console.error("[tender-automation-azure] SAS token is missing read (r) permission", {
      sas,
    });
  }

  console.info("[tender-automation-azure] configuration", {
    accountName: azure.accountName,
    containerName: azure.containerName,
    sas,
  });

  return azure;
}

function normalizeSas(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new ConfigError();
  }

  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    try {
      const url = new URL(trimmed);
      if (!url.search) {
        throw new Error("SAS URL does not contain a query string");
      }
      return url.search;
    } catch {
      throw new ConfigError();
    }
  }

  if (trimmed.startsWith("?")) {
    return trimmed;
  }

  return `?${trimmed}`;
}

function validateFullSasUrlAgainstConfig(azure: AzureConfig) {
  const raw = azure.sasToken.trim();

  if (!raw.startsWith("https://") && !raw.startsWith("http://")) {
    return;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError();
  }

  const expectedHost = `${azure.accountName}.blob.core.windows.net`;
  if (url.hostname.toLowerCase() !== expectedHost.toLowerCase()) {
    console.error("[tender-automation-azure] SAS URL host does not match account name", {
      expectedHost,
      actualHost: url.hostname,
    });
    throw new ConfigError();
  }

  const containerFromUrl = url.pathname.split("/").filter(Boolean)[0];
  if (containerFromUrl && containerFromUrl !== azure.containerName) {
    console.error("[tender-automation-azure] SAS URL container does not match config", {
      expectedContainer: azure.containerName,
      actualContainer: containerFromUrl,
    });
    throw new ConfigError();
  }
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim().replace(/[/\\]/g, "");
  const lastDot = trimmed.lastIndexOf(".");
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext = lastDot > 0 ? trimmed.slice(lastDot) : "";
  return `${slugify(base) || "file"}${ext.toLowerCase().replace(/[^a-z0-9.]/g, "")}`;
}

function encodeBlobPath(blobName: string) {
  return blobName.split("/").map(encodeURIComponent).join("/");
}

function azureBaseUrl(azure: AzureConfig) {
  return `https://${azure.accountName}.blob.core.windows.net/${azure.containerName}`;
}

function getSafeSasInfo(value: string) {
  let query: string;

  try {
    query = normalizeSas(value);
  } catch {
    return {
      validFormat: false,
      format: "invalid",
      sp: null,
      sr: null,
      sv: null,
      st: null,
      se: null,
      spr: null,
      sigPresent: false,
    };
  }

  const params = new URLSearchParams(
    query.startsWith("?") ? query.slice(1) : query,
  );
  const trimmed = value.trim();

  return {
    validFormat: true,
    format:
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? "full-url"
        : trimmed.startsWith("?")
          ? "query-with-question-mark"
          : "query-only",
    sp: params.get("sp"),
    sr: params.get("sr"),
    sv: params.get("sv"),
    st: params.get("st"),
    se: params.get("se"),
    spr: params.get("spr"),
    sipPresent: Boolean(params.get("sip")),
    sigPresent: Boolean(params.get("sig")),
  };
}

function blobNameFromUrl(azure: AzureConfig, storageUrl: string | null) {
  if (!storageUrl) return null;
  const marker = `/${azure.containerName}/`;
  const idx = storageUrl.indexOf(marker);
  if (idx < 0) return null;
  const path = storageUrl.slice(idx + marker.length).split("?")[0] || "";
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function templateAssetContentType(file: File, ext: string) {
  const mime = (file.type || "").toLowerCase();
  if (mime && mime !== "application/octet-stream") return file.type || mime;
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return file.type || "application/octet-stream";
}

async function uploadAzureBlob(
  azure: AzureConfig,
  blobName: string,
  file: File,
  options?: { contentType?: string; contentDisposition?: "inline" | "attachment" },
): Promise<AzureUploadResult> {
  const encoded = encodeBlobPath(blobName);
  const storageUrl = `${azureBaseUrl(azure)}/${encoded}`;
  const azureRequestUrl = `${storageUrl}${normalizeSas(azure.sasToken)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const safeName = file.name.replace(/"/g, "");
  const disposition = options?.contentDisposition || "attachment";
  const put = await fetch(azureRequestUrl, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": options?.contentType || file.type || "application/octet-stream",
      "x-ms-blob-content-disposition": `${disposition}; filename="${safeName}"`,
      "x-ms-version": "2020-10-02",
    },
    body: bytes,
  });

  if (!put.ok) {
    const body = await put.text();
    console.error("[tender-automation-azure] upload failed", {
      status: put.status,
      statusText: put.statusText,
      errorCode: put.headers.get("x-ms-error-code"),
      requestId: put.headers.get("x-ms-request-id"),
      blobName,
      sas: getSafeSasInfo(azure.sasToken),
      responseBody: body.slice(0, 1500),
    });
    throw new HttpError(500, "Unable to upload the file to document storage. Please try again.");
  }

  return { blobName, storageUrl };
}

function azureQueryUrl(azure: AzureConfig, blobName: string, extraQuery: string) {
  const encoded = encodeBlobPath(blobName);
  const storageUrl = `${azureBaseUrl(azure)}/${encoded}`;
  const sas = normalizeSas(azure.sasToken);
  const extra = extraQuery.startsWith("?") ? extraQuery.slice(1) : extraQuery;
  return `${storageUrl}?${extra}${sas.replace("?", "&")}`;
}

function encodeAzureBlockId(chunkIndex: number) {
  const label = `block-${String(chunkIndex + 1).padStart(6, "0")}`;
  return btoa(label);
}

function expectedChunkSize(fileSize: number, chunkSize: number, chunkIndex: number) {
  const start = chunkIndex * chunkSize;
  return Math.max(0, Math.min(fileSize, start + chunkSize) - start);
}

function uploadedBytesFromIndexes(
  fileSize: number,
  chunkSize: number,
  indexes: number[],
) {
  return indexes.reduce(
    (sum, index) => sum + expectedChunkSize(fileSize, chunkSize, index),
    0,
  );
}

async function stageAzureBlock(
  azure: AzureConfig,
  blobName: string,
  blockId: string,
  bytes: Uint8Array,
) {
  const url = azureQueryUrl(
    azure,
    blobName,
    `comp=block&blockid=${encodeURIComponent(blockId)}`,
  );
  const put = await fetch(url, {
    method: "PUT",
    headers: {
      "x-ms-version": "2020-10-02",
      "Content-Length": String(bytes.byteLength),
    },
    body: bytes,
  });
  if (!put.ok) {
    const body = await put.text();
    console.error("[tender-automation-azure] stage block failed", {
      status: put.status,
      errorCode: put.headers.get("x-ms-error-code"),
      requestId: put.headers.get("x-ms-request-id"),
      blobName,
      blockId,
      responseBody: body.slice(0, 1500),
    });
    throw new HttpError(500, "Chunk upload failed");
  }
}

async function commitAzureBlockList(
  azure: AzureConfig,
  blobName: string,
  blockIds: string[],
  options: { mimeType: string; fileName: string },
) {
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>\n<BlockList>\n` +
    blockIds.map((id) => `  <Latest>${id}</Latest>`).join("\n") +
    `\n</BlockList>`;
  const url = azureQueryUrl(azure, blobName, "comp=blocklist");
  const put = await fetch(url, {
    method: "PUT",
    headers: {
      "x-ms-version": "2020-10-02",
      "Content-Type": "application/xml",
      "x-ms-blob-content-type": options.mimeType || "application/octet-stream",
      "x-ms-blob-content-disposition":
        `attachment; filename="${options.fileName.replace(/"/g, "")}"`,
    },
    body: xml,
  });
  if (!put.ok) {
    const body = await put.text();
    console.error("[tender-automation-azure] commit block list failed", {
      status: put.status,
      errorCode: put.headers.get("x-ms-error-code"),
      requestId: put.headers.get("x-ms-request-id"),
      blobName,
      responseBody: body.slice(0, 1500),
    });
    throw new HttpError(500, "Unable to finalize document storage. Please try again.");
  }
}

function validateCompanyDocumentFile(
  fileName: string,
  mimeType: string,
  fileSize: number,
  maxBytes = MAX_COMPANY_DOCUMENT_BYTES,
) {
  const name = fileName.trim();
  if (!name) throw new HttpError(400, "File name is required");
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new HttpError(400, "File is empty");
  }
  if (fileSize > maxBytes) {
    throw new HttpError(413, `File too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  const lowerName = name.toLowerCase();
  if (!ALLOWED_EXT.some((ext) => lowerName.endsWith(ext))) {
    throw new HttpError(415, "Unsupported type. Use PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, or ZIP.");
  }
  const mime = (mimeType || "").trim().toLowerCase();
  if (mime && !ALLOWED_MIME.includes(mime)) {
    throw new HttpError(415, "Unsupported type");
  }
}

function resolveCategoryFromValue(raw: unknown): Category {
  const value = String(raw || "").trim();
  const lower = value.toLowerCase();
  if (lower === "certificate") return "Certificate";
  if (lower === "financial") return "Financial";
  if (value === "Certificate" || value === "Financial" || value === "General") {
    return value as Category;
  }
  return "General";
}

async function deleteAzureBlob(azure: AzureConfig, blobName: string | null) {
  if (!blobName) return;

  const encoded = encodeBlobPath(blobName);
  const url = `${azureBaseUrl(azure)}/${encoded}${normalizeSas(azure.sasToken)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "x-ms-version": "2020-10-02" },
  });

  if (!response.ok && response.status !== 404) {
    const errorBody = await response.text();
    console.error("[tender-automation-azure] delete failed", {
      status: response.status,
      statusText: response.statusText,
      errorCode: response.headers.get("x-ms-error-code"),
      requestId: response.headers.get("x-ms-request-id"),
      blobName,
      sas: getSafeSasInfo(azure.sasToken),
      responseBody: errorBody.slice(0, 1500),
    });
    throw new HttpError(500, "Unable to clean up the previous template file.");
  }
}

async function deleteAzureBlobBestEffort(
  azure: AzureConfig,
  blobName: string | null,
  context: string,
) {
  try {
    await deleteAzureBlob(azure, blobName);
  } catch (error) {
    console.error("[tender-automation-templates] blob cleanup failed", {
      context,
      blobName,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function readAzureBlob(azure: AzureConfig, blobName: string) {
  const encoded = encodeBlobPath(blobName);
  const storageUrl = `${azureBaseUrl(azure)}/${encoded}`;
  const authenticatedUrl = `${storageUrl}${normalizeSas(azure.sasToken)}`;

  const response = await fetch(authenticatedUrl, {
    method: "GET",
    headers: {
      "x-ms-version": "2020-10-02",
    },
  });

  if (response.status === 404) {
    throw new HttpError(404, "File not found.");
  }

  if (!response.ok) {
    const body = await response.text();
    console.error("[tender-automation-templates] azure read failed", {
      status: response.status,
      statusText: response.statusText,
      errorCode: response.headers.get("x-ms-error-code"),
      requestId: response.headers.get("x-ms-request-id"),
      blobName,
      responseBody: body.slice(0, 1500),
      sas: getSafeSasInfo(azure.sasToken),
    });
    throw new HttpError(500, "Unable to read the file.");
  }

  return response;
}

/** Authenticated blob stream — Azure account disallows anonymous/public access. */
async function handleBlobRead(
  req: Request,
  body: {
    storageUrl?: string;
    blobName?: string;
    disposition?: string;
    fileName?: string;
  },
) {
  const azure = requireAzureConfig();
  await authenticate(req);

  const explicitBlob = String(body.blobName || "").trim();
  const storageUrl = String(body.storageUrl || "").trim();
  let blobName = explicitBlob || blobNameFromUrl(azure, storageUrl || null);
  if (!blobName) {
    throw new HttpError(400, "storageUrl or blobName is required.");
  }
  // Prevent path escape outside the configured container namespace space.
  if (blobName.includes("..")) {
    throw new HttpError(400, "Invalid blob path.");
  }

  const dispositionMode =
    String(body.disposition || "inline").trim() === "attachment"
      ? "attachment"
      : "inline";
  const fileName =
    String(body.fileName || "").trim() ||
    blobName.split("/").pop() ||
    "document";

  const azureResponse = await readAzureBlob(azure, blobName);
  const headers = new Headers({
    ...corsHeaders,
    "Content-Type":
      azureResponse.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `${dispositionMode}; filename="${fileName.replace(/"/g, "")}"`,
  });
  const contentLength = azureResponse.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(azureResponse.body, { status: 200, headers });
}

function serviceSupabase() {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SECRET_KEY")?.trim();
  if (!url || !key) throw new Error("Missing SUPABASE_URL or service role key");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authenticate(req: Request): Promise<AuthUser> {
  const token = req.headers.get("x-agenttender-session")?.trim();
  if (!token) throw new HttpError(401, "Authentication required.");

  const supabase = serviceSupabase();
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();

  const { data: session } = await supabase
    .from("agenttender_user_sessions")
    .select("id, user_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!session || session.revoked_at || session.expires_at <= now) {
    throw new HttpError(401, "Session expired or invalid.");
  }

  const { data: user } = await supabase
    .from("agenttender_users")
    .select("id, role, company_id, is_active")
    .eq("id", session.user_id)
    .maybeSingle();

  if (!user?.is_active || !user.company_id) {
    throw new HttpError(401, "User account is not active or has no company.");
  }

  const { data: company } = await supabase
    .from("agenttender_companies")
    .select("id, name")
    .eq("id", user.company_id)
    .maybeSingle();

  if (!company) throw new HttpError(401, "Company record not found.");

  await supabase
    .from("agenttender_user_sessions")
    .update({ last_seen_at: now })
    .eq("id", session.id);

  return {
    id: String(user.id),
    role: String(user.role),
    companyId: String(company.id),
    companyName: String(company.name),
  };
}

function resolveCategory(form: FormData): Category {
  const raw = String(form.get("category") || form.get("uploadKind") || "General").trim();
  const lower = raw.toLowerCase();
  if (lower === "certificate") return "Certificate";
  if (lower === "financial") return "Financial";
  if (raw === "Certificate" || raw === "Financial" || raw === "General") {
    return raw as Category;
  }
  return "General";
}

function getFormFile(form: FormData, name: string): File | null {
  const value = form.get(name);
  if (value instanceof File && value.size > 0) return value;
  return null;
}

function buildTemplateAssetPrefix(
  companyName: string,
  companyId: string,
  templateName: string,
  templateId: string,
) {
  return (
    `${slugify(companyName)}_${companyId}/` +
    `templates/` +
    `${slugify(templateName)}_${templateId}`
  );
}

function templatePrefixFromBlobName(blobName: string | null) {
  if (!blobName) return null;
  const parts = blobName.split("/").filter(Boolean);
  const templatesIdx = parts.indexOf("templates");
  if (templatesIdx >= 1 && parts.length >= templatesIdx + 2) {
    return parts.slice(0, templatesIdx + 2).join("/");
  }
  return null;
}

function validateTemplateAsset(file: File, label: string) {
  if (file.size <= 0) {
    throw new HttpError(400, `${label} file is empty.`);
  }
  const lowerName = file.name.toLowerCase();
  const ext = TEMPLATE_SIGN_STAMP_EXTENSIONS.find((item) =>
    lowerName.endsWith(item),
  );
  if (!ext) {
    throw new HttpError(
      400,
      "Unsupported file type. Upload PDF, PNG, JPG, JPEG, or WEBP.",
    );
  }
  const mime = (file.type || "").toLowerCase();
  if (
    !GENERIC_TEMPLATE_ASSET_MIME.has(mime) &&
    !TEMPLATE_SIGN_STAMP_MIME.includes(mime)
  ) {
    throw new HttpError(
      400,
      "Unsupported file type. Upload PDF, PNG, JPG, JPEG, or WEBP.",
    );
  }
  return ext;
}

async function handleCreateUploadSession(
  req: Request,
  body: Record<string, unknown>,
) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!UPLOAD_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to manage company documents.");
  }

  const documentName = String(body.documentName || body.name || "").trim();
  const fileName = String(body.fileName || "").trim();
  const mimeType = String(body.mimeType || "application/octet-stream");
  const fileSizeBytes = Number(body.fileSizeBytes);
  const notes = String(body.notes || "").trim() || null;
  const category = resolveCategoryFromValue(body.category || body.uploadKind);

  if (!documentName) throw new HttpError(400, "Document name is required");
  validateCompanyDocumentFile(fileName, mimeType, fileSizeBytes);

  let documentType: string | null = null;
  let certificateType: string | null = null;
  let financialYear: string | null = null;
  let issuingAuthority: string | null = null;
  let issueDate: string | null = null;
  let expiryDate: string | null = null;

  if (category === "Certificate") {
    certificateType = String(body.certificateType || "").trim();
    issuingAuthority = String(body.issuingAuthority || "").trim();
    issueDate = String(body.issueDate || "").trim() || null;
    expiryDate = String(body.expiryDate || "").trim() || null;
    if (!certificateType) throw new HttpError(400, "Certificate type is required");
    if (!issuingAuthority) throw new HttpError(400, "Issuing authority is required");
    if (!issueDate) throw new HttpError(400, "Issue date is required");
    if (!expiryDate) throw new HttpError(400, "Expiry date is required");
    if (expiryDate < issueDate) {
      throw new HttpError(400, "Expiry date must be on or after issue date");
    }
  } else if (category === "Financial") {
    financialYear = String(body.financialYear || "").trim();
    documentType = String(body.documentType || "").trim();
    if (!financialYear) throw new HttpError(400, "Financial year is required");
    if (!documentType) throw new HttpError(400, "Document type is required");
  }

  const documentId = crypto.randomUUID();
  const uploadId = crypto.randomUUID();
  const totalChunks = Math.max(1, Math.ceil(fileSizeBytes / CHUNK_SIZE));
  const blobName =
    `${slugify(user.companyName)}_${user.companyId}/` +
    `${slugify(documentName)}_${documentId}/` +
    `${category}/` +
    sanitizeFileName(fileName);
  const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS).toISOString();
  const supabase = serviceSupabase();

  const { error: insertDocError } = await supabase
    .from("agenttender_company_documents")
    .insert({
      id: documentId,
      company_id: user.companyId,
      name: documentName,
      original_file_name: fileName,
      document_category: category,
      document_type: documentType,
      certificate_type: certificateType,
      financial_year: financialYear,
      issuing_authority: issuingAuthority,
      issue_date: issueDate,
      expiry_date: expiryDate,
      notes,
      mime_type: mimeType || null,
      file_size_bytes: fileSizeBytes,
      storage_provider: "azure",
      storage_container: azure.containerName,
      storage_blob_name: blobName,
      storage_url: null,
      content_hash: null,
      verification_status: "pending",
      status: "uploading",
      created_by: user.id,
    });

  if (insertDocError) {
    console.error("[tender-automation-documents] pending document insert failed", {
      message: insertDocError.message,
      documentId,
    });
    throw new HttpError(500, "Unable to start upload session.");
  }

  const { error: insertSessionError } = await supabase
    .from("agenttender_document_upload_sessions")
    .insert({
      id: uploadId,
      document_id: documentId,
      company_id: user.companyId,
      created_by: user.id,
      blob_name: blobName,
      original_file_name: fileName,
      mime_type: mimeType || null,
      file_size_bytes: fileSizeBytes,
      chunk_size: CHUNK_SIZE,
      total_chunks: totalChunks,
      received_indexes: [],
      status: "pending",
      expires_at: expiresAt,
    });

  if (insertSessionError) {
    console.error("[tender-automation-documents] upload session insert failed", {
      message: insertSessionError.message,
      uploadId,
    });
    await supabase.from("agenttender_company_documents").delete().eq("id", documentId);
    throw new HttpError(500, "Unable to start upload session.");
  }

  console.info("[tender-automation-documents] upload session created", {
    companyId: user.companyId,
    uploadId,
    documentId,
    totalChunks,
  });

  return json({
    success: true,
    uploadId,
    documentId,
    chunkSize: CHUNK_SIZE,
    totalChunks,
  });
}

async function loadOwnedUploadSession(
  req: Request,
  uploadId: string,
) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!UPLOAD_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to manage company documents.");
  }
  assertSafeId(uploadId, "uploadId");

  const supabase = serviceSupabase();
  const { data: session, error } = await supabase
    .from("agenttender_document_upload_sessions")
    .select("*")
    .eq("id", uploadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!session) throw new HttpError(404, "Upload session expired");
  if (String(session.company_id) !== user.companyId) {
    throw new HttpError(403, "You cannot access another company's upload.");
  }
  if (String(session.created_by) !== user.id) {
    throw new HttpError(403, "You cannot access another user's upload.");
  }

  const status = String(session.status);
  if (status === "aborted" || status === "expired") {
    throw new HttpError(410, "Upload session expired");
  }
  if (status === "complete") {
    throw new HttpError(409, "Upload session already completed.");
  }
  if (new Date(String(session.expires_at)).getTime() <= Date.now()) {
    await supabase
      .from("agenttender_document_upload_sessions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", uploadId)
      .eq("company_id", user.companyId);
    await supabase
      .from("agenttender_company_documents")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", session.document_id)
      .eq("company_id", user.companyId)
      .eq("status", "uploading");
    throw new HttpError(410, "Upload session expired");
  }

  return { azure, user, supabase, session };
}

async function handleUploadChunk(req: Request) {
  const uploadId = String(req.headers.get("x-upload-id") || "").trim();
  const chunkIndex = Number(req.headers.get("x-chunk-index"));
  const totalChunksHeader = Number(req.headers.get("x-total-chunks"));
  const blockIdHeader = String(req.headers.get("x-block-id") || "").trim();
  if (!uploadId) throw new HttpError(400, "uploadId is required");
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new HttpError(400, "chunkIndex is required");
  }

  const { azure, supabase, session } = await loadOwnedUploadSession(req, uploadId);
  const chunkSize = Number(session.chunk_size) || CHUNK_SIZE;
  const totalChunks = Number(session.total_chunks);
  const fileSize = Number(session.file_size_bytes);
  if (Number.isInteger(totalChunksHeader) && totalChunksHeader !== totalChunks) {
    throw new HttpError(400, "totalChunks does not match the upload session.");
  }
  if (chunkIndex >= totalChunks) {
    throw new HttpError(400, "chunkIndex is out of range.");
  }

  const expectedId = encodeAzureBlockId(chunkIndex);
  const blockId = blockIdHeader || expectedId;
  if (blockId !== expectedId) {
    throw new HttpError(400, "Invalid block id.");
  }

  const received = Array.isArray(session.received_indexes)
    ? (session.received_indexes as number[]).map((n) => Number(n))
    : [];
  const bytes = new Uint8Array(await req.arrayBuffer());
  const expected = expectedChunkSize(fileSize, chunkSize, chunkIndex);
  if (bytes.byteLength !== expected) {
    throw new HttpError(400, "Chunk size does not match the expected range.");
  }
  if (bytes.byteLength > chunkSize) {
    throw new HttpError(413, "Chunk exceeds the configured size limit.");
  }

  if (!received.includes(chunkIndex)) {
    await stageAzureBlock(azure, String(session.blob_name), blockId, bytes);
    received.push(chunkIndex);
    const { error: updateError } = await supabase
      .from("agenttender_document_upload_sessions")
      .update({
        received_indexes: received,
        status: "uploading",
        updated_at: new Date().toISOString(),
      })
      .eq("id", uploadId)
      .eq("company_id", session.company_id);
    if (updateError) throw new Error(updateError.message);
  }

  return json({
    success: true,
    chunkIndex,
    receivedIndexes: received,
    uploadedBytes: uploadedBytesFromIndexes(fileSize, chunkSize, received),
  });
}

async function handleCompleteUpload(
  req: Request,
  body: Record<string, unknown>,
) {
  const uploadId = String(body.uploadId || "").trim();
  if (!uploadId) throw new HttpError(400, "uploadId is required");
  const { azure, user, supabase, session } = await loadOwnedUploadSession(
    req,
    uploadId,
  );

  const chunkSize = Number(session.chunk_size) || CHUNK_SIZE;
  const totalChunks = Number(session.total_chunks);
  const received = Array.isArray(session.received_indexes)
    ? (session.received_indexes as number[]).map((n) => Number(n))
    : [];
  const missing = Array.from({ length: totalChunks }, (_, i) => i).filter(
    (i) => !received.includes(i),
  );
  if (missing.length > 0) {
    throw new HttpError(400, "Upload is incomplete. Missing chunks must be retried.");
  }

  const { error: finalizingError } = await supabase
    .from("agenttender_document_upload_sessions")
    .update({ status: "finalizing", updated_at: new Date().toISOString() })
    .eq("id", uploadId)
    .eq("company_id", user.companyId);
  if (finalizingError) throw new Error(finalizingError.message);

  await supabase
    .from("agenttender_company_documents")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", session.document_id)
    .eq("company_id", user.companyId)
    .eq("status", "uploading");

  const blockIds = Array.from({ length: totalChunks }, (_, index) =>
    encodeAzureBlockId(index),
  );
  const blobName = String(session.blob_name);
  const fileName = String(session.original_file_name || "document");
  const mimeType = String(session.mime_type || "application/octet-stream");

  try {
    await commitAzureBlockList(azure, blobName, blockIds, { mimeType, fileName });
  } catch (error) {
    await supabase
      .from("agenttender_document_upload_sessions")
      .update({
        status: "failed",
        error_message: "Storage commit failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", uploadId);
    await supabase
      .from("agenttender_company_documents")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", session.document_id)
      .eq("company_id", user.companyId);
    throw error;
  }

  const storageUrl = `${azureBaseUrl(azure)}/${encodeBlobPath(blobName)}`;
  const contentHash =
    typeof body.contentHash === "string" && body.contentHash.trim()
      ? body.contentHash.trim()
      : null;

  const { data: updated, error: updateDocError } = await supabase
    .from("agenttender_company_documents")
    .update({
      status: "active",
      storage_provider: "azure",
      storage_container: azure.containerName,
      storage_blob_name: blobName,
      storage_url: storageUrl,
      content_hash: contentHash,
      mime_type: mimeType,
      file_size_bytes: Number(session.file_size_bytes),
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.document_id)
    .eq("company_id", user.companyId)
    .select("*")
    .single();

  if (updateDocError) {
    console.error("[tender-automation-documents] metadata finalize failed", {
      message: updateDocError.message,
      documentId: session.document_id,
    });
    await deleteAzureBlob(azure, blobName).catch(() => null);
    await supabase
      .from("agenttender_document_upload_sessions")
      .update({
        status: "failed",
        error_message: "Metadata persistence failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", uploadId);
    await supabase
      .from("agenttender_company_documents")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", session.document_id)
      .eq("company_id", user.companyId);
    throw new HttpError(
      500,
      "The file was uploaded but the document record could not be saved. The uploaded file was cleaned up. Please try again.",
    );
  }

  await supabase
    .from("agenttender_document_upload_sessions")
    .update({
      status: "complete",
      content_hash: contentHash,
      updated_at: new Date().toISOString(),
    })
    .eq("id", uploadId)
    .eq("company_id", user.companyId);

  console.info("[tender-automation-documents] chunked upload complete", {
    documentId: session.document_id,
    uploadId,
  });

  return json({
    success: true,
    documentId: session.document_id,
    document: updated,
  });
}

async function handleAbortUpload(req: Request, body: Record<string, unknown>) {
  const uploadId = String(body.uploadId || "").trim();
  if (!uploadId) throw new HttpError(400, "uploadId is required");

  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!UPLOAD_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to manage company documents.");
  }
  assertSafeId(uploadId, "uploadId");

  const supabase = serviceSupabase();
  const { data: session, error } = await supabase
    .from("agenttender_document_upload_sessions")
    .select("*")
    .eq("id", uploadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!session) return json({ success: true });
  if (String(session.company_id) !== user.companyId) {
    throw new HttpError(403, "You cannot access another company's upload.");
  }
  if (String(session.created_by) !== user.id) {
    throw new HttpError(403, "You cannot access another user's upload.");
  }
  if (String(session.status) === "complete") {
    throw new HttpError(409, "Completed uploads cannot be cancelled.");
  }

  await deleteAzureBlob(azure, String(session.blob_name)).catch(() => null);
  await supabase
    .from("agenttender_document_upload_sessions")
    .update({
      status: "aborted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", uploadId)
    .eq("company_id", user.companyId);
  await supabase
    .from("agenttender_company_documents")
    .update({ status: "deleted", updated_at: new Date().toISOString() })
    .eq("id", session.document_id)
    .eq("company_id", user.companyId)
    .in("status", ["uploading", "processing", "failed"]);

  return json({ success: true });
}

async function handleUpload(req: Request, form: FormData) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!UPLOAD_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to manage company documents.");
  }

  const documentName = String(
    form.get("documentName") || form.get("name") || "",
  ).trim();
  const notes = String(form.get("notes") || "").trim() || null;
  const file = form.get("file");
  const category = resolveCategory(form);

  if (!documentName) throw new HttpError(400, "Document name is required");
  if (!(file instanceof File) || file.size <= 0) {
    throw new HttpError(400, "Please select a file to upload");
  }
  if (file.size > MAX_BYTES) throw new HttpError(400, "File exceeds the 25 MB limit");
  const lowerName = file.name.toLowerCase();
  if (!ALLOWED_EXT.some((ext) => lowerName.endsWith(ext))) {
    throw new HttpError(400, "File type not allowed. Use PDF, DOC, DOCX, XLS, or XLSX.");
  }

  let documentType: string | null = null;
  let certificateType: string | null = null;
  let financialYear: string | null = null;
  let issuingAuthority: string | null = null;
  let issueDate: string | null = null;
  let expiryDate: string | null = null;

  if (category === "Certificate") {
    certificateType = String(form.get("certificateType") || "").trim();
    issuingAuthority = String(form.get("issuingAuthority") || "").trim();
    issueDate = String(form.get("issueDate") || "").trim() || null;
    expiryDate = String(form.get("expiryDate") || "").trim() || null;
    if (!certificateType) throw new HttpError(400, "Certificate type is required");
    if (!issuingAuthority) throw new HttpError(400, "Issuing authority is required");
    if (!issueDate) throw new HttpError(400, "Issue date is required");
    if (!expiryDate) throw new HttpError(400, "Expiry date is required");
    if (expiryDate < issueDate) {
      throw new HttpError(400, "Expiry date must be on or after issue date");
    }
  } else if (category === "Financial") {
    financialYear = String(form.get("financialYear") || "").trim();
    documentType = String(form.get("documentType") || "").trim();
    if (!financialYear) throw new HttpError(400, "Financial year is required");
    if (!documentType) throw new HttpError(400, "Document type is required");
  }

  const documentId = crypto.randomUUID();
  const artifactPortal = String(form.get("tenderArtifactPortal") || "")
    .trim()
    .toUpperCase();
  const artifactId = String(form.get("tenderArtifactId") || "").trim();
  const artifactDate = String(form.get("tenderArtifactDate") || "").trim();
  const useManualArtifactPath =
    artifactPortal === "MANUAL" && Boolean(artifactId);

  // Manual tenders → companies/{key}/tender-artifacts/manual/{created-date}/{tender-id}/…
  // (same layout as tender247 date folders; portal segment is "manual")
  const blobName = useManualArtifactPath
    ? buildTenderArtifactBlobName({
        sourcePortal: "MANUAL",
        sourceTenderId: artifactId,
        runDate: artifactDate,
        fileName: `${documentId.slice(0, 8)}_${file.name}`,
        companyKey: resolveCompanyArtifactKey(user.companyName),
      })
    : `${slugify(user.companyName)}_${user.companyId}/` +
      `${slugify(documentName)}_${documentId}/` +
      `${category}/` +
      sanitizeFileName(file.name);

  console.info("[tender-automation-documents] upload started", {
    companyId: user.companyId,
    documentId,
    category,
    artifactPortal: useManualArtifactPath ? "MANUAL" : null,
    blobName,
  });

  await uploadAzureBlob(azure, blobName, file);
  const storedFileUrl = `${azureBaseUrl(azure)}/${encodeBlobPath(blobName)}`;

  const supabase = serviceSupabase();
  const { data: inserted, error: insertError } = await supabase
    .from("agenttender_company_documents")
    .insert({
      id: documentId,
      company_id: user.companyId,
      name: documentName,
      original_file_name: file.name,
      document_category: category,
      document_type: documentType,
      certificate_type: certificateType,
      financial_year: financialYear,
      issuing_authority: issuingAuthority,
      issue_date: issueDate,
      expiry_date: expiryDate,
      notes,
      mime_type: file.type || null,
      file_size_bytes: file.size,
      storage_provider: "azure",
      storage_container: azure.containerName,
      storage_blob_name: blobName,
      storage_url: storedFileUrl,
      verification_status: "pending",
      status: "active",
      created_by: user.id,
    })
    .select("*")
    .single();

  if (insertError) {
    console.error("[tender-automation-documents] supabase insert failed", {
      message: insertError.message,
      documentId,
    });
    await deleteAzureBlob(azure, blobName).catch(() => null);
    throw new HttpError(
      500,
      "The file was uploaded but the document record could not be saved. The uploaded file was cleaned up. Please try again.",
    );
  }

  console.info("[tender-automation-documents] upload complete", { documentId });
  return json({ success: true, documentId, document: inserted });
}

async function handleDocumentRead(
  req: Request,
  body: { documentId?: string; disposition?: string },
) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);

  const documentId = String(body.documentId || "").trim();
  if (!documentId) throw new HttpError(400, "documentId is required");

  const supabase = serviceSupabase();
  const { data: doc, error } = await supabase
    .from("agenttender_company_documents")
    .select(
      "id, company_id, status, storage_provider, storage_blob_name, storage_url, original_file_name, name, mime_type",
    )
    .eq("id", documentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!doc || doc.status !== "active") {
    throw new HttpError(404, "Document not found.");
  }
  if (String(doc.company_id) !== user.companyId) {
    throw new HttpError(403, "You do not have permission to view this document.");
  }

  const blobName =
    (doc.storage_blob_name as string | null) ||
    blobNameFromUrl(azure, doc.storage_url ? String(doc.storage_url) : null);
  if (!blobName) {
    throw new HttpError(404, "File not found.");
  }

  const fileName =
    (doc.original_file_name as string | null) ||
    (doc.name as string | null) ||
    "document";
  const dispositionMode =
    String(body.disposition || "inline").trim() === "attachment"
      ? "attachment"
      : "inline";

  console.info("[tender-automation-documents] read started", {
    companyId: user.companyId,
    documentId,
    disposition: dispositionMode,
  });

  const azureResponse = await readAzureBlob(azure, blobName);
  const headers = new Headers({
    ...corsHeaders,
    "Content-Type":
      azureResponse.headers.get("content-type") ||
      String(doc.mime_type || "application/octet-stream"),
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `${dispositionMode}; filename="${String(fileName).replace(/"/g, "")}"`,
  });
  const contentLength = azureResponse.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);

  console.info("[tender-automation-documents] read complete", { documentId });
  return new Response(azureResponse.body, { status: 200, headers });
}

async function handleDelete(req: Request, body: { documentId?: string }) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!DELETE_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to delete documents.");
  }

  const documentId = String(body.documentId || "").trim();
  if (!documentId) throw new HttpError(400, "documentId is required");

  const supabase = serviceSupabase();
  const { data: doc, error } = await supabase
    .from("agenttender_company_documents")
    .select("id, company_id, storage_provider, storage_blob_name, storage_url")
    .eq("id", documentId)
    .eq("company_id", user.companyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!doc) throw new HttpError(404, "Document not found.");

  let blobName = doc.storage_blob_name ? String(doc.storage_blob_name) : null;
  if (!blobName) {
    blobName = blobNameFromUrl(azure, doc.storage_url ? String(doc.storage_url) : null);
  }

  if (doc.storage_provider === "azure" && blobName) {
    try {
      await deleteAzureBlob(azure, blobName);
    } catch (error) {
      if (error instanceof HttpError) {
        throw new HttpError(
          500,
          "Unable to delete the file from document storage. Please try again.",
        );
      }
      throw error;
    }
  }

  // Remove the DB row after storage succeeds so deletes are not soft-orphans.
  const { error: hardDeleteError } = await supabase
    .from("agenttender_company_documents")
    .delete()
    .eq("id", documentId)
    .eq("company_id", user.companyId);

  if (hardDeleteError) throw new Error(hardDeleteError.message);

  console.info("[tender-automation-documents] delete complete", { documentId });
  return json({ success: true, documentId });
}

async function handleTemplateAssetsSave(req: Request, form: FormData) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!TEMPLATE_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to manage bid profile templates.");
  }

  const templateId = String(form.get("templateId") || "").trim();
  const templateName = String(form.get("templateName") || "").trim();
  const stampFile =
    getFormFile(form, "companySignStamp") ||
    getFormFile(form, "companySignatory");
  const cleanupLegacyLogo = String(form.get("cleanupLegacyLogo") || "").trim() === "true";

  if (!templateId) throw new HttpError(400, "templateId is required");
  if (!templateName) throw new HttpError(400, "templateName is required");
  if (!stampFile && !cleanupLegacyLogo) {
    throw new HttpError(400, "No template assets were provided.");
  }

  const supabase = serviceSupabase();
  const { data: template, error } = await supabase
    .from("agenttender_bid_profile_templates")
    .select(
      "id, company_id, template_name, status, company_logo_url, company_signatory_url, company_logo_blob_name, company_signatory_blob_name",
    )
    .eq("id", templateId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!template) throw new HttpError(404, "Template not found.");
  if (String(template.company_id) !== user.companyId) {
    throw new HttpError(403, "You do not have permission to update this template.");
  }
  if (template.status !== "active") {
    throw new HttpError(404, "Template not found.");
  }

  const previousLogoBlob =
    (template.company_logo_blob_name as string | null) ||
    blobNameFromUrl(azure, template.company_logo_url as string | null);
  const previousSignatoryBlob =
    (template.company_signatory_blob_name as string | null) ||
    blobNameFromUrl(azure, template.company_signatory_url as string | null);

  const templatePrefix =
    templatePrefixFromBlobName(previousSignatoryBlob) ||
    templatePrefixFromBlobName(previousLogoBlob) ||
    buildTemplateAssetPrefix(
      user.companyName,
      user.companyId,
      templateName,
      templateId,
    );

  console.info("[tender-automation-templates] asset upload started", {
    companyId: user.companyId,
    templateId,
  });

  let stampUpload: AzureUploadResult | null = null;

  try {
    if (stampFile) {
      const ext = validateTemplateAsset(stampFile, "Company Sign + Stamp");
      const stampVersionId = crypto.randomUUID();
      stampUpload = await uploadAzureBlob(
        azure,
        `${templatePrefix}/company-sign-stamp/company-sign-stamp-${stampVersionId}${ext}`,
        stampFile,
        {
          contentType: templateAssetContentType(stampFile, ext),
          contentDisposition: "inline",
        },
      );
      console.info("[tender-automation-templates] sign+stamp uploaded", { templateId });
    }
  } catch (uploadError) {
    await deleteAzureBlob(azure, stampUpload?.blobName ?? null).catch(() => null);
    throw uploadError;
  }

  const patch: Record<string, unknown> = {
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  if (stampUpload) {
    patch.company_signatory_url = stampUpload.storageUrl;
    patch.company_signatory_blob_name = stampUpload.blobName;
  }
  if (cleanupLegacyLogo && (previousLogoBlob || template.company_logo_url)) {
    patch.company_logo_url = null;
    patch.company_logo_blob_name = null;
  }

  const { error: updateError } = await supabase
    .from("agenttender_bid_profile_templates")
    .update(patch)
    .eq("id", templateId)
    .eq("company_id", user.companyId);

  if (updateError) {
    console.error("[tender-automation-templates] supabase update failed", {
      message: updateError.message,
      templateId,
    });
    await deleteAzureBlob(azure, stampUpload?.blobName ?? null).catch(() => null);
    throw new HttpError(500, "Unable to save template file records. Please try again.");
  }

  if (
    stampUpload &&
    previousSignatoryBlob &&
    previousSignatoryBlob !== stampUpload.blobName
  ) {
    await deleteAzureBlobBestEffort(
      azure,
      previousSignatoryBlob,
      "previous-sign-stamp",
    );
  }

  if (cleanupLegacyLogo && previousLogoBlob) {
    await deleteAzureBlobBestEffort(azure, previousLogoBlob, "legacy-company-logo");
  }

  console.info("[tender-automation-templates] asset save complete", { templateId });
  return json({
    success: true,
    templateId,
    companySignatoryUrl:
      stampUpload?.storageUrl ?? template.company_signatory_url,
    companySignStampUrl:
      stampUpload?.storageUrl ?? template.company_signatory_url,
  });
}

async function handleTemplateAssetRead(
  req: Request,
  body: { templateId?: string; assetType?: string },
) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!TEMPLATE_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to manage bid profile templates.");
  }

  const templateId = String(body.templateId || "").trim();
  const assetType = String(body.assetType || "").trim();
  if (!templateId) throw new HttpError(400, "templateId is required");
  if (assetType !== "logo" && assetType !== "signatory") {
    throw new HttpError(400, "assetType must be logo or signatory");
  }

  const supabase = serviceSupabase();
  const { data: template, error } = await supabase
    .from("agenttender_bid_profile_templates")
    .select(
      "id, company_id, status, company_logo_url, company_signatory_url, company_logo_blob_name, company_signatory_blob_name",
    )
    .eq("id", templateId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!template) throw new HttpError(404, "Template not found.");
  if (String(template.company_id) !== user.companyId) {
    throw new HttpError(403, "You do not have permission to view this template.");
  }
  if (template.status !== "active") {
    throw new HttpError(404, "Template not found.");
  }

  const blobName =
    assetType === "logo"
      ? (template.company_logo_blob_name as string | null) ||
        blobNameFromUrl(azure, template.company_logo_url as string | null)
      : (template.company_signatory_blob_name as string | null) ||
        blobNameFromUrl(azure, template.company_signatory_url as string | null);

  if (!blobName) {
    return json({ success: false, error: "Template asset not found." }, 404);
  }

  console.info("[tender-automation-templates] asset read started", {
    companyId: user.companyId,
    templateId,
    assetType,
  });

  const azureResponse = await readAzureBlob(azure, blobName);
  const contentType = azureResponse.headers.get("content-type") || "";
    const lowerBlob = blobName.toLowerCase();
    let resolvedType = contentType || "application/octet-stream";
    if (
      !resolvedType ||
      resolvedType === "application/octet-stream"
    ) {
      if (lowerBlob.endsWith(".pdf")) resolvedType = "application/pdf";
      else if (lowerBlob.endsWith(".png")) resolvedType = "image/png";
      else if (lowerBlob.endsWith(".jpg") || lowerBlob.endsWith(".jpeg")) {
        resolvedType = "image/jpeg";
      } else if (lowerBlob.endsWith(".webp")) resolvedType = "image/webp";
    }
    const fileName = blobName.split("/").filter(Boolean).pop() || "file";
    const headers = new Headers({
      ...corsHeaders,
      "Content-Type": resolvedType,
      "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=300",
    });
  const contentLength = azureResponse.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  console.info("[tender-automation-templates] asset read complete", {
    templateId,
    assetType,
  });

  return new Response(azureResponse.body, {
    status: 200,
    headers,
  });
}

async function handleTemplateAssetsDelete(
  req: Request,
  body: { templateId?: string },
) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!TEMPLATE_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to manage bid profile templates.");
  }

  const templateId = String(body.templateId || "").trim();
  if (!templateId) throw new HttpError(400, "templateId is required");

  const supabase = serviceSupabase();
  const { data: template, error } = await supabase
    .from("agenttender_bid_profile_templates")
    .select(
      "id, company_id, company_logo_url, company_signatory_url, company_logo_blob_name, company_signatory_blob_name",
    )
    .eq("id", templateId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!template) throw new HttpError(404, "Template not found.");
  if (String(template.company_id) !== user.companyId) {
    throw new HttpError(403, "You do not have permission to delete this template.");
  }

  console.info("[tender-automation-templates] delete started", {
    companyId: user.companyId,
    templateId,
  });

  const logoBlob =
    (template.company_logo_blob_name as string | null) ||
    blobNameFromUrl(azure, template.company_logo_url as string | null);
  const signatoryBlob =
    (template.company_signatory_blob_name as string | null) ||
    blobNameFromUrl(azure, template.company_signatory_url as string | null);

  await deleteAzureBlob(azure, logoBlob);
  if (logoBlob) {
    console.info("[tender-automation-templates] logo deleted", { templateId });
  }
  await deleteAzureBlob(azure, signatoryBlob);
  if (signatoryBlob) {
    console.info("[tender-automation-templates] signatory deleted", { templateId });
  }

  const { error: archiveError } = await supabase
    .from("agenttender_bid_profile_templates")
    .update({
      status: "archived",
      is_default: false,
      company_logo_url: null,
      company_signatory_url: null,
      company_logo_blob_name: null,
      company_signatory_blob_name: null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId)
    .eq("company_id", user.companyId);

  if (archiveError) throw new Error(archiveError.message);

  console.info("[tender-automation-templates] delete complete", { templateId });
  return json({ success: true, templateId });
}

function buildExperiencePrefix(
  companyName: string,
  companyId: string,
  projectName: string,
  experienceId: string,
) {
  return (
    `${slugify(companyName)}_${companyId}/` +
    `experience/` +
    `${slugify(projectName)}_${experienceId}`
  );
}

function experiencePrefixFromBlobName(blobName: string | null) {
  if (!blobName) return null;
  const parts = blobName.split("/").filter(Boolean);
  const experienceIdx = parts.indexOf("experience");
  if (experienceIdx >= 1 && parts.length >= experienceIdx + 2) {
    return parts.slice(0, experienceIdx + 2).join("/");
  }
  return null;
}

function validateExperiencePdf(file: File, label: string) {
  if (file.size <= 0) {
    throw new HttpError(400, `${label} file is empty.`);
  }
  if (file.size > MAX_BYTES) {
    throw new HttpError(400, `${label} exceeds the 25 MB limit.`);
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new HttpError(400, `${label} must be a PDF.`);
  }
  const mime = (file.type || "").toLowerCase();
  if (mime && mime !== "application/pdf") {
    throw new HttpError(400, `${label} must be a PDF.`);
  }
}

const EXPERIENCE_SELECT =
  "id, company_id, project_name, status, work_order_url, work_order_blob_name, work_order_file_name, completion_certificate_url, completion_certificate_blob_name, completion_certificate_file_name";

async function handleExperienceAssetsSave(req: Request, form: FormData) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!UPLOAD_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to manage company documents.");
  }

  const experienceId = String(form.get("experienceId") || "").trim();
  const projectName = String(form.get("projectName") || "").trim();
  const workOrderFile = getFormFile(form, "workOrder");
  const completionFile = getFormFile(form, "completionCertificate");
  const clearCompletionCertificate =
    String(form.get("clearCompletionCertificate") || "") === "true";

  if (!experienceId) throw new HttpError(400, "experienceId is required");
  if (!projectName) throw new HttpError(400, "projectName is required");
  if (!workOrderFile && !completionFile && !clearCompletionCertificate) {
    throw new HttpError(400, "No experience files were provided.");
  }
  if (workOrderFile) validateExperiencePdf(workOrderFile, "Work Order");
  if (completionFile) validateExperiencePdf(completionFile, "Completion Certificate");

  const supabase = serviceSupabase();
  const { data: experience, error } = await supabase
    .from("agenttender_company_experience")
    .select(EXPERIENCE_SELECT)
    .eq("id", experienceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!experience) throw new HttpError(404, "Experience record not found.");
  if (String(experience.company_id) !== user.companyId) {
    throw new HttpError(403, "You do not have permission to update this record.");
  }
  if (experience.status !== "active") {
    throw new HttpError(404, "Experience record not found.");
  }

  const previousWorkOrderBlob =
    (experience.work_order_blob_name as string | null) ||
    blobNameFromUrl(azure, experience.work_order_url as string | null);
  const previousCertificateBlob =
    (experience.completion_certificate_blob_name as string | null) ||
    blobNameFromUrl(azure, experience.completion_certificate_url as string | null);

  const prefix =
    experiencePrefixFromBlobName(previousWorkOrderBlob) ||
    experiencePrefixFromBlobName(previousCertificateBlob) ||
    buildExperiencePrefix(
      user.companyName,
      user.companyId,
      projectName,
      experienceId,
    );

  console.info("[tender-automation-experience] asset upload started", {
    companyId: user.companyId,
    experienceId,
  });

  let workOrderUpload: AzureUploadResult | null = null;
  let certificateUpload: AzureUploadResult | null = null;

  try {
    if (workOrderFile) {
      const versionId = crypto.randomUUID();
      workOrderUpload = await uploadAzureBlob(
        azure,
        `${prefix}/work-order/work-order-${versionId}.pdf`,
        workOrderFile,
      );
      console.info("[tender-automation-experience] work order uploaded", {
        experienceId,
      });
    }
    if (completionFile && !clearCompletionCertificate) {
      const versionId = crypto.randomUUID();
      certificateUpload = await uploadAzureBlob(
        azure,
        `${prefix}/completion-certificate/completion-certificate-${versionId}.pdf`,
        completionFile,
      );
      console.info("[tender-automation-experience] completion certificate uploaded", {
        experienceId,
      });
    }
  } catch (uploadError) {
    await deleteAzureBlob(azure, workOrderUpload?.blobName ?? null).catch(() => null);
    await deleteAzureBlob(azure, certificateUpload?.blobName ?? null).catch(() => null);
    throw uploadError;
  }

  const patch: Record<string, unknown> = {
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  if (workOrderUpload) {
    patch.work_order_url = workOrderUpload.storageUrl;
    patch.work_order_blob_name = workOrderUpload.blobName;
    patch.work_order_file_name = workOrderFile?.name ?? null;
  }
  if (certificateUpload) {
    patch.completion_certificate_url = certificateUpload.storageUrl;
    patch.completion_certificate_blob_name = certificateUpload.blobName;
    patch.completion_certificate_file_name = completionFile?.name ?? null;
  }
  if (clearCompletionCertificate) {
    patch.completion_certificate_url = null;
    patch.completion_certificate_blob_name = null;
    patch.completion_certificate_file_name = null;
  }

  const { error: updateError } = await supabase
    .from("agenttender_company_experience")
    .update(patch)
    .eq("id", experienceId)
    .eq("company_id", user.companyId);

  if (updateError) {
    console.error("[tender-automation-experience] supabase update failed", {
      message: updateError.message,
      experienceId,
    });
    await deleteAzureBlob(azure, workOrderUpload?.blobName ?? null).catch(() => null);
    await deleteAzureBlob(azure, certificateUpload?.blobName ?? null).catch(() => null);
    throw new HttpError(500, "Unable to save experience file records. Please try again.");
  }

  if (
    workOrderUpload &&
    previousWorkOrderBlob &&
    previousWorkOrderBlob !== workOrderUpload.blobName
  ) {
    await deleteAzureBlob(azure, previousWorkOrderBlob);
    console.info("[tender-automation-experience] previous work order deleted", {
      experienceId,
    });
  }
  if (
    certificateUpload &&
    previousCertificateBlob &&
    previousCertificateBlob !== certificateUpload.blobName
  ) {
    await deleteAzureBlob(azure, previousCertificateBlob);
    console.info("[tender-automation-experience] previous certificate deleted", {
      experienceId,
    });
  }
  if (clearCompletionCertificate && previousCertificateBlob) {
    await deleteAzureBlob(azure, previousCertificateBlob);
    console.info("[tender-automation-experience] completion certificate cleared", {
      experienceId,
    });
  }

  console.info("[tender-automation-experience] asset save complete", { experienceId });
  return json({
    success: true,
    experienceId,
    workOrderUrl: workOrderUpload?.storageUrl ?? experience.work_order_url,
    completionCertificateUrl: clearCompletionCertificate
      ? null
      : certificateUpload?.storageUrl ?? experience.completion_certificate_url,
  });
}

async function handleExperienceAssetRead(
  req: Request,
  body: { experienceId?: string; assetType?: string },
) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);

  const experienceId = String(body.experienceId || "").trim();
  const assetType = String(body.assetType || "").trim();
  if (!experienceId) throw new HttpError(400, "experienceId is required");
  if (assetType !== "work-order" && assetType !== "completion-certificate") {
    throw new HttpError(400, "assetType must be work-order or completion-certificate");
  }

  const supabase = serviceSupabase();
  const { data: experience, error } = await supabase
    .from("agenttender_company_experience")
    .select(EXPERIENCE_SELECT)
    .eq("id", experienceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!experience) throw new HttpError(404, "Experience record not found.");
  if (String(experience.company_id) !== user.companyId) {
    throw new HttpError(403, "You do not have permission to view this record.");
  }
  if (experience.status !== "active") {
    throw new HttpError(404, "Experience record not found.");
  }

  const blobName =
    assetType === "work-order"
      ? (experience.work_order_blob_name as string | null) ||
        blobNameFromUrl(azure, experience.work_order_url as string | null)
      : (experience.completion_certificate_blob_name as string | null) ||
        blobNameFromUrl(azure, experience.completion_certificate_url as string | null);

  if (!blobName) {
    return json({ success: false, error: "Experience file not found." }, 404);
  }

  const fileName =
    assetType === "work-order"
      ? (experience.work_order_file_name as string | null) || "work-order.pdf"
      : (experience.completion_certificate_file_name as string | null) ||
        "completion-certificate.pdf";

  const azureResponse = await readAzureBlob(azure, blobName);
  const headers = new Headers({
    ...corsHeaders,
    "Content-Type":
      azureResponse.headers.get("content-type") || "application/pdf",
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `inline; filename="${String(fileName).replace(/"/g, "")}"`,
  });
  const contentLength = azureResponse.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(azureResponse.body, { status: 200, headers });
}

async function handleExperienceAssetsDelete(
  req: Request,
  body: { experienceId?: string },
) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!UPLOAD_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to manage company documents.");
  }

  const experienceId = String(body.experienceId || "").trim();
  if (!experienceId) throw new HttpError(400, "experienceId is required");

  const supabase = serviceSupabase();
  const { data: experience, error } = await supabase
    .from("agenttender_company_experience")
    .select(EXPERIENCE_SELECT)
    .eq("id", experienceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!experience) throw new HttpError(404, "Experience record not found.");
  if (String(experience.company_id) !== user.companyId) {
    throw new HttpError(403, "You do not have permission to delete this record.");
  }

  console.info("[tender-automation-experience] delete started", {
    companyId: user.companyId,
    experienceId,
  });

  const workOrderBlob =
    (experience.work_order_blob_name as string | null) ||
    blobNameFromUrl(azure, experience.work_order_url as string | null);
  const certificateBlob =
    (experience.completion_certificate_blob_name as string | null) ||
    blobNameFromUrl(azure, experience.completion_certificate_url as string | null);

  await deleteAzureBlob(azure, workOrderBlob);
  await deleteAzureBlob(azure, certificateBlob);

  const { error: archiveError } = await supabase
    .from("agenttender_company_experience")
    .update({
      status: "archived",
      work_order_url: null,
      work_order_blob_name: null,
      work_order_file_name: null,
      completion_certificate_url: null,
      completion_certificate_blob_name: null,
      completion_certificate_file_name: null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", experienceId)
    .eq("company_id", user.companyId);

  if (archiveError) throw new Error(archiveError.message);

  console.info("[tender-automation-experience] delete complete", { experienceId });
  return json({ success: true, experienceId });
}

function assertSafeId(value: string, label: string) {
  if (!value || value.includes("/") || value.includes("..") || value.includes("\\")) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
}

function buildWorkspaceDocumentPrefix(
  companyName: string,
  companyId: string,
  tenderReference: string,
  tenderId: string,
) {
  return (
    `${slugify(companyName)}_${companyId}/` +
    `bids/` +
    `${slugify(tenderReference)}_${tenderId}/` +
    `workspace`
  );
}

function validateWorkspaceFile(file: File) {
  if (file.size <= 0) throw new HttpError(400, "File is empty.");
  if (file.size > MAX_BYTES) throw new HttpError(400, "File exceeds the 25 MB limit.");
  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXT.some((ext) => lower.endsWith(ext))) {
    throw new HttpError(400, "Unsupported file type.");
  }
}

function nextWorkspaceVersion(current: string | null) {
  const match = /^v(\d+)/i.exec((current || "").trim());
  if (!match) return "v1";
  return `v${Number(match[1] || "1") + 1}`;
}

async function handleWorkspaceDocumentSave(req: Request, form: FormData) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!BID_WORKSPACE_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to manage bid workspace documents.");
  }

  const workspaceId = String(form.get("workspaceId") || "").trim();
  const tenderId = String(form.get("tenderId") || "").trim();
  const tenderReference = String(form.get("tenderReference") || "").trim() || tenderId;
  const documentType = String(form.get("documentType") || "Other").trim() || "Other";
  const title = String(form.get("title") || "").trim();
  const existingId = String(form.get("documentId") || "").trim();
  const file = getFormFile(form, "file");

  if (!workspaceId) throw new HttpError(400, "workspaceId is required");
  if (!tenderId) throw new HttpError(400, "tenderId is required");
  if (!title) throw new HttpError(400, "title is required");
  if (!file) throw new HttpError(400, "A file is required.");
  assertSafeId(workspaceId, "workspaceId");
  assertSafeId(tenderId, "tenderId");
  if (existingId) assertSafeId(existingId, "documentId");
  validateWorkspaceFile(file);

  const supabase = serviceSupabase();
  const { data: workspace, error: workspaceError } = await supabase
    .from("agenttender_bid_workspaces")
    .select("id, company_id, tender_id, submission_status")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError) throw new Error(workspaceError.message);
  if (!workspace) throw new HttpError(404, "Bid workspace not found.");
  if (String(workspace.company_id) !== user.companyId) {
    throw new HttpError(403, "You cannot access another company's workspace.");
  }
  if (String(workspace.tender_id) !== tenderId) {
    throw new HttpError(400, "Workspace does not belong to this tender.");
  }
  if (workspace.submission_status === "submitted") {
    throw new HttpError(400, "This bid has been marked submitted. Editing is disabled.");
  }

  let previousBlob: string | null = null;
  let previousVersion: string | null = null;
  if (existingId) {
    const { data: existing, error: existingError } = await supabase
      .from("agenttender_bid_workspace_documents")
      .select("id, company_id, workspace_id, blob_name, storage_url, version_label")
      .eq("id", existingId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new HttpError(404, "Workspace document not found.");
    if (String(existing.company_id) !== user.companyId) {
      throw new HttpError(403, "You cannot access another company's document.");
    }
    if (String(existing.workspace_id) !== workspaceId) {
      throw new HttpError(400, "Document does not belong to this workspace.");
    }
    previousBlob =
      (existing.blob_name as string | null) ||
      blobNameFromUrl(azure, existing.storage_url as string | null);
    previousVersion = (existing.version_label as string | null) || null;
  }

  const documentId = existingId || crypto.randomUUID();
  const prefix = buildWorkspaceDocumentPrefix(
    user.companyName,
    user.companyId,
    tenderReference,
    tenderId,
  );
  const blobName =
    `${prefix}/${slugify(documentType)}/${documentId}/${sanitizeFileName(file.name)}`;

  console.info("[tender-automation-workspace] upload started", {
    companyId: user.companyId,
    workspaceId,
    documentId,
  });

  const uploaded = await uploadAzureBlob(azure, blobName, file);
  const versionLabel = existingId ? nextWorkspaceVersion(previousVersion) : "v1";

  if (existingId) {
    const { error: updateError } = await supabase
      .from("agenttender_bid_workspace_documents")
      .update({
        document_type: documentType,
        title,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type || "application/octet-stream",
        storage_url: uploaded.storageUrl,
        blob_name: uploaded.blobName,
        status: "ready",
        version_label: versionLabel,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("company_id", user.companyId);
    if (updateError) {
      await deleteAzureBlob(azure, uploaded.blobName).catch(() => null);
      throw new HttpError(500, "Unable to save workspace document. Please try again.");
    }
    if (previousBlob && previousBlob !== uploaded.blobName) {
      await deleteAzureBlob(azure, previousBlob);
    }
  } else {
    const { error: insertError } = await supabase
      .from("agenttender_bid_workspace_documents")
      .insert({
        id: documentId,
        workspace_id: workspaceId,
        company_id: user.companyId,
        tender_id: tenderId,
        document_type: documentType,
        title,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type || "application/octet-stream",
        storage_url: uploaded.storageUrl,
        blob_name: uploaded.blobName,
        status: "ready",
        is_required: false,
        version_label: versionLabel,
        created_by: user.id,
        updated_by: user.id,
      });
    if (insertError) {
      await deleteAzureBlob(azure, uploaded.blobName).catch(() => null);
      throw new HttpError(500, "Unable to save workspace document. Please try again.");
    }
  }

  console.info("[tender-automation-workspace] upload complete", { documentId });
  return json({ success: true, workspaceDocumentId: documentId, documentId });
}

async function handleWorkspaceDocumentRead(
  req: Request,
  body: { documentId?: string },
) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!BID_WORKSPACE_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to view bid workspace documents.");
  }

  const documentId = String(body.documentId || "").trim();
  if (!documentId) throw new HttpError(400, "documentId is required");
  assertSafeId(documentId, "documentId");

  const supabase = serviceSupabase();
  const { data: document, error } = await supabase
    .from("agenttender_bid_workspace_documents")
    .select("id, company_id, blob_name, storage_url, file_name, mime_type")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!document) throw new HttpError(404, "Workspace document not found.");
  if (String(document.company_id) !== user.companyId) {
    throw new HttpError(403, "You cannot access another company's document.");
  }

  const blobName =
    (document.blob_name as string | null) ||
    blobNameFromUrl(azure, document.storage_url as string | null);
  if (!blobName) throw new HttpError(404, "File not found.");

  const azureResponse = await readAzureBlob(azure, blobName);
  const headers = new Headers({
    ...corsHeaders,
    "Content-Type":
      azureResponse.headers.get("content-type") ||
      String(document.mime_type || "application/octet-stream"),
    "Cache-Control": "private, max-age=300",
  });
  const contentLength = azureResponse.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);
  const fileName = String(document.file_name || "document");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${fileName.replace(/"/g, "")}"`,
  );

  return new Response(azureResponse.body, { status: 200, headers });
}

async function handleWorkspaceDocumentDelete(
  req: Request,
  body: { documentId?: string },
) {
  const azure = requireAzureConfig();
  const user = await authenticate(req);
  if (!BID_WORKSPACE_ROLES.has(user.role) && !DELETE_ROLES.has(user.role)) {
    throw new HttpError(403, "You do not have permission to delete bid workspace documents.");
  }

  const documentId = String(body.documentId || "").trim();
  if (!documentId) throw new HttpError(400, "documentId is required");
  assertSafeId(documentId, "documentId");

  const supabase = serviceSupabase();
  const { data: document, error } = await supabase
    .from("agenttender_bid_workspace_documents")
    .select("id, company_id, blob_name, storage_url, is_required, title")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!document) throw new HttpError(404, "Workspace document not found.");
  if (String(document.company_id) !== user.companyId) {
    throw new HttpError(403, "You cannot access another company's document.");
  }

  const blobName =
    (document.blob_name as string | null) ||
    blobNameFromUrl(azure, document.storage_url as string | null);

  if (document.is_required) {
    const { error: clearError } = await supabase
      .from("agenttender_bid_workspace_documents")
      .update({
        file_name: null,
        file_size_bytes: null,
        mime_type: null,
        storage_url: null,
        blob_name: null,
        status: "pending",
        version_label: null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("company_id", user.companyId);
    if (clearError) throw new Error(clearError.message);
  } else {
    const { error: deleteError } = await supabase
      .from("agenttender_bid_workspace_documents")
      .delete()
      .eq("id", documentId)
      .eq("company_id", user.companyId);
    if (deleteError) throw new Error(deleteError.message);
  }

  await deleteAzureBlob(azure, blobName);
  console.info("[tender-automation-workspace] delete complete", { documentId });
  return json({ success: true, documentId });
}

function requireServiceRole(req: Request) {
  const auth = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  const key =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SECRET_KEY")?.trim();
  if (!auth || !key || auth !== key) {
    throw new HttpError(401, "Service role authentication required.");
  }
}

function sanitizeTenderArtifactFileName(fileName: string) {
  const trimmed = fileName.trim().replace(/[/\\]/g, "");
  const lastDot = trimmed.lastIndexOf(".");
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext = lastDot > 0 ? trimmed.slice(lastDot) : "";
  const safeBase =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "file";
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${safeBase}${safeExt}`;
}

function buildTenderArtifactBlobName(options: {
  sourcePortal: string;
  sourceTenderId: string;
  runDate: string;
  fileName: string;
  companyKey?: string | null;
}) {
  const portal = options.sourcePortal.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const id = options.sourceTenderId.replace(/[^a-zA-Z0-9_-]/g, "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(options.runDate)
    ? options.runDate
    : "undated";
  const company =
    String(options.companyKey || "siyana")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "siyana";
  // Company-scoped; never include Tender247 account. metadata.json is not uploaded.
  // MANUAL → companies/{key}/tender-artifacts/manual/{date}/{tenderId}/…
  return `companies/${company}/tender-artifacts/${portal}/${date}/${id}/${sanitizeTenderArtifactFileName(options.fileName)}`;
}

/** Short company key matching Azure layout: companies/siyana/tender-artifacts/… */
function resolveCompanyArtifactKey(companyName: string): string {
  const fromEnv = (Deno.env.get("COMPANY_BLOB_KEY") || "").trim();
  if (fromEnv) {
    return (
      fromEnv
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "siyana"
    );
  }
  const slug = slugify(companyName);
  const first = slug.split("-").filter(Boolean)[0];
  return first || "siyana";
}

/** Pipeline upload for Tender_All_Documents.zip / AI_Summary.pdf (metadata stays in DB). */
async function handleUploadTenderArtifact(req: Request, formData: FormData) {
  requireServiceRole(req);
  const azure = requireAzureConfig();

  const sourcePortal = String(formData.get("sourcePortal") ?? "").trim().toUpperCase();
  const sourceTenderId = String(formData.get("sourceTenderId") ?? "").trim();
  const runDate = String(formData.get("runDate") ?? "").trim();
  const artifactKind = String(formData.get("artifactKind") ?? "").trim();
  const providedBlobName = String(formData.get("blobName") ?? "").trim();
  const file = formData.get("file");

  if (
    sourcePortal !== "TENDER247" &&
    sourcePortal !== "BIDASSIST" &&
    sourcePortal !== "MANUAL"
  ) {
    throw new HttpError(400, "Invalid sourcePortal.");
  }
  if (!sourceTenderId) throw new HttpError(400, "sourceTenderId is required.");
  if (!(file instanceof File) || file.size <= 0) {
    throw new HttpError(400, "A non-empty file is required.");
  }
  if (file.size > MAX_COMPANY_DOCUMENT_BYTES) {
    throw new HttpError(400, "File exceeds the maximum allowed size.");
  }

  const allowedKinds = new Set(["documents_zip", "ai_summary", "manual_document"]);
  if (!allowedKinds.has(artifactKind)) {
    throw new HttpError(400, "Invalid artifactKind.");
  }

  const companyKey = String(formData.get("companyKey") ?? "").trim() || "siyana";
  const blobName =
    providedBlobName &&
    (providedBlobName.startsWith("companies/") ||
      providedBlobName.startsWith("tender-artifacts/")) &&
    !providedBlobName.includes("..")
      ? providedBlobName
      : buildTenderArtifactBlobName({
          sourcePortal,
          sourceTenderId,
          runDate,
          fileName: file.name || `${artifactKind}.bin`,
          companyKey,
        });

  const uploaded = await uploadAzureBlob(azure, blobName, file, {
    contentType: file.type || "application/octet-stream",
    contentDisposition: "attachment",
  });

  console.info("[tender-automation-tender-artifacts] upload complete", {
    sourcePortal,
    sourceTenderId,
    artifactKind,
    blobName: uploaded.blobName,
  });

  return json({
    success: true,
    storageUrl: uploaded.storageUrl,
    blobName: uploaded.blobName,
    artifactKind,
  });
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class ConfigError extends Error {
  constructor() {
    super("Document storage is not configured correctly.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    const uploadAction = req.headers.get("x-upload-action") ?? "";

    if (uploadAction === "upload-chunk" || contentType.includes("application/octet-stream")) {
      return await handleUploadChunk(req);
    }

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const action = String(formData.get("action") ?? "");
      if (action === "upload") return await handleUpload(req, formData);
      if (action === "upload-tender-artifact") {
        return await handleUploadTenderArtifact(req, formData);
      }
      if (action === "template-assets-save") {
        return await handleTemplateAssetsSave(req, formData);
      }
      if (action === "experience-assets-save") {
        return await handleExperienceAssetsSave(req, formData);
      }
      if (action === "workspace-document-save") {
        return await handleWorkspaceDocumentSave(req, formData);
      }
      return json({ success: false, error: "Unsupported action" }, 400);
    }

    const body = await req.json().catch(() => ({}));
    if (body?.action === "create-upload-session") {
      return await handleCreateUploadSession(req, body);
    }
    if (body?.action === "complete-upload") {
      return await handleCompleteUpload(req, body);
    }
    if (body?.action === "abort-upload") {
      return await handleAbortUpload(req, body);
    }
    if (body?.action === "document-read") {
      return await handleDocumentRead(req, body);
    }
    if (body?.action === "blob-read") {
      return await handleBlobRead(req, body);
    }
    if (body?.action === "delete") return await handleDelete(req, body);
    if (body?.action === "template-assets-delete") {
      return await handleTemplateAssetsDelete(req, body);
    }
    if (body?.action === "template-asset-read") {
      return await handleTemplateAssetRead(req, body);
    }
    if (body?.action === "experience-assets-delete") {
      return await handleExperienceAssetsDelete(req, body);
    }
    if (body?.action === "experience-asset-read") {
      return await handleExperienceAssetRead(req, body);
    }
    if (body?.action === "workspace-document-delete") {
      return await handleWorkspaceDocumentDelete(req, body);
    }
    if (body?.action === "workspace-document-read") {
      return await handleWorkspaceDocumentRead(req, body);
    }
    return json({ success: false, error: "Unsupported action" }, 400);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("[tender-automation-documents] missing azure config");
      return json({ success: false, error: error.message }, 503);
    }
    if (error instanceof HttpError) {
      return json({ success: false, error: error.message }, error.status);
    }
    console.error(
      "[tender-automation-documents] failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Request failed",
      },
      500,
    );
  }
});

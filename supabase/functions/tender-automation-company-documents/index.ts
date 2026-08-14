import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-agenttender-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_TEMPLATE_ASSET_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg"];
const TEMPLATE_ASSET_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const TEMPLATE_ASSET_MIME = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
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

async function uploadAzureBlob(
  azure: AzureConfig,
  blobName: string,
  file: File,
): Promise<AzureUploadResult> {
  const encoded = encodeBlobPath(blobName);
  const storageUrl = `${azureBaseUrl(azure)}/${encoded}`;
  const azureRequestUrl = `${storageUrl}${normalizeSas(azure.sasToken)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const put = await fetch(azureRequestUrl, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": file.type || "application/octet-stream",
      "x-ms-blob-content-disposition":
        `attachment; filename="${file.name.replace(/"/g, "")}"`,
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
  if (file.size > MAX_TEMPLATE_ASSET_BYTES) {
    throw new HttpError(400, `${label} exceeds the 5 MB limit.`);
  }
  const lowerName = file.name.toLowerCase();
  const ext = TEMPLATE_ASSET_EXT.find((item) => lowerName.endsWith(item));
  if (!ext) {
    throw new HttpError(400, `${label} type not allowed. Use PNG, JPG, JPEG, or WEBP.`);
  }
  const mime = (file.type || "").toLowerCase();
  if (mime && !TEMPLATE_ASSET_MIME.includes(mime)) {
    throw new HttpError(400, `${label} type not allowed. Use PNG, JPG, JPEG, or WEBP.`);
  }
  return ext;
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
  const blobName =
    `${slugify(user.companyName)}_${user.companyId}/` +
    `${slugify(documentName)}_${documentId}/` +
    `${category}/` +
    sanitizeFileName(file.name);

  console.info("[tender-automation-documents] upload started", {
    companyId: user.companyId,
    documentId,
    category,
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
  return json({ success: true, document: inserted });
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

  const { error: softDeleteError } = await supabase
    .from("agenttender_company_documents")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("company_id", user.companyId);

  if (softDeleteError) throw new Error(softDeleteError.message);

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
  const logoFile = getFormFile(form, "companyLogo");
  const signatoryFile = getFormFile(form, "companySignatory");

  if (!templateId) throw new HttpError(400, "templateId is required");
  if (!templateName) throw new HttpError(400, "templateName is required");
  if (!logoFile && !signatoryFile) {
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
    templatePrefixFromBlobName(previousLogoBlob) ||
    templatePrefixFromBlobName(previousSignatoryBlob) ||
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

  let logoUpload: AzureUploadResult | null = null;
  let signatoryUpload: AzureUploadResult | null = null;

  try {
    if (logoFile) {
      const ext = validateTemplateAsset(logoFile, "Company Logo");
      const logoVersionId = crypto.randomUUID();
      logoUpload = await uploadAzureBlob(
        azure,
        `${templatePrefix}/company-logo/company-logo-${logoVersionId}${ext}`,
        logoFile,
      );
      console.info("[tender-automation-templates] logo uploaded", { templateId });
    }
    if (signatoryFile) {
      const ext = validateTemplateAsset(signatoryFile, "Company Signatory");
      const signatoryVersionId = crypto.randomUUID();
      signatoryUpload = await uploadAzureBlob(
        azure,
        `${templatePrefix}/company-signatory/company-signatory-${signatoryVersionId}${ext}`,
        signatoryFile,
      );
      console.info("[tender-automation-templates] signatory uploaded", { templateId });
    }
  } catch (uploadError) {
    await deleteAzureBlob(azure, logoUpload?.blobName ?? null).catch(() => null);
    await deleteAzureBlob(azure, signatoryUpload?.blobName ?? null).catch(() => null);
    throw uploadError;
  }

  const patch: Record<string, unknown> = {
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  if (logoUpload) {
    patch.company_logo_url = logoUpload.storageUrl;
    patch.company_logo_blob_name = logoUpload.blobName;
  }
  if (signatoryUpload) {
    patch.company_signatory_url = signatoryUpload.storageUrl;
    patch.company_signatory_blob_name = signatoryUpload.blobName;
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
    await deleteAzureBlob(azure, logoUpload?.blobName ?? null).catch(() => null);
    await deleteAzureBlob(azure, signatoryUpload?.blobName ?? null).catch(() => null);
    throw new HttpError(500, "Unable to save template file records. Please try again.");
  }

  if (logoUpload && previousLogoBlob && previousLogoBlob !== logoUpload.blobName) {
    await deleteAzureBlob(azure, previousLogoBlob);
    console.info("[tender-automation-templates] previous logo deleted", { templateId });
  }
  if (
    signatoryUpload &&
    previousSignatoryBlob &&
    previousSignatoryBlob !== signatoryUpload.blobName
  ) {
    await deleteAzureBlob(azure, previousSignatoryBlob);
    console.info("[tender-automation-templates] previous signatory deleted", {
      templateId,
    });
  }

  console.info("[tender-automation-templates] asset save complete", { templateId });
  return json({
    success: true,
    templateId,
    companyLogoUrl: logoUpload?.storageUrl ?? template.company_logo_url,
    companySignatoryUrl: signatoryUpload?.storageUrl ?? template.company_signatory_url,
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
  const headers = new Headers({
    ...corsHeaders,
    "Content-Type":
      azureResponse.headers.get("content-type") || "application/octet-stream",
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

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const action = String(formData.get("action") ?? "");
      if (action === "upload") return await handleUpload(req, formData);
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

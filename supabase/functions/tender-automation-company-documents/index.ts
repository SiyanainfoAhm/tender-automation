import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-agenttender-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg"];
const UPLOAD_ROLES = new Set([
  "ADMIN",
  "BID_MANAGER",
  "TECHNICAL_LEAD",
  "FINANCIAL_ANALYST",
  "DOCUMENT_SPECIALIST",
]);
const DELETE_ROLES = new Set(["ADMIN", "DOCUMENT_SPECIALIST"]);

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

  return { accountName, containerName, sasToken };
}

function normalizeSas(token: string) {
  const trimmed = token.trim();
  return trimmed.startsWith("?") ? trimmed : `?${trimmed}`;
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

  const encoded = encodeBlobPath(blobName);
  const base =
    `https://${azure.accountName}.blob.core.windows.net/${azure.containerName}`;
  const storedFileUrl = `${base}/${encoded}`;
  const azureRequestUrl = `${storedFileUrl}${normalizeSas(azure.sasToken)}`;

  console.info("[tender-automation-documents] upload started", {
    companyId: user.companyId,
    documentId,
    category,
  });

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
    console.error("[tender-automation-documents] azure upload failed", {
      status: put.status,
      blobName,
    });
    throw new HttpError(500, "Unable to upload the file to document storage. Please try again.");
  }

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
    await fetch(azureRequestUrl, {
      method: "DELETE",
      headers: { "x-ms-version": "2020-10-02" },
    }).catch(() => null);
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
  if (!blobName && doc.storage_url) {
    const marker = `/${azure.containerName}/`;
    const url = String(doc.storage_url);
    const idx = url.indexOf(marker);
    if (idx >= 0) {
      blobName = decodeURIComponent(url.slice(idx + marker.length).split("?")[0] || "");
    }
  }

  if (doc.storage_provider === "azure" && blobName) {
    const encoded = encodeBlobPath(blobName);
    const base =
      `https://${azure.accountName}.blob.core.windows.net/${azure.containerName}`;
    const azureRequestUrl = `${base}/${encoded}${normalizeSas(azure.sasToken)}`;
    const del = await fetch(azureRequestUrl, {
      method: "DELETE",
      headers: { "x-ms-version": "2020-10-02" },
    });
    if (!del.ok && del.status !== 404) {
      console.error("[tender-automation-documents] azure delete failed", {
        status: del.status,
        blobName,
      });
      throw new HttpError(
        500,
        "Unable to delete the file from document storage. Please try again.",
      );
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
      return json({ success: false, error: "Unsupported action" }, 400);
    }

    const body = await req.json().catch(() => ({}));
    if (body?.action === "delete") return await handleDelete(req, body);
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

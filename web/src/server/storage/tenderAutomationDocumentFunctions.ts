import "server-only";

import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/server/auth/session";

const FUNCTION_NAME = "tender-automation-company-documents";

type EdgeJson = {
  success?: boolean;
  error?: string;
  documentId?: string;
  document?: unknown;
};

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

async function invokeCompanyDocuments(
  init: RequestInit,
): Promise<EdgeJson> {
  const base = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const key = resolveServiceKey();
  if (!base || !key) {
    return {
      success: false,
      error: "Document storage is not configured correctly.",
    };
  }

  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    return { success: false, error: "Authentication required." };
  }

  const response = await fetch(`${base}/functions/v1/${FUNCTION_NAME}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${key}`,
      apikey: key,
      "x-agenttender-session": sessionToken,
    },
  });

  return (await response.json().catch(() => ({
    success: false,
    error: "Invalid response from document storage function.",
  }))) as EdgeJson;
}

export async function invokeDocumentUpload(
  formData: FormData,
): Promise<EdgeJson> {
  if (!formData.get("action")) formData.set("action", "upload");
  return invokeCompanyDocuments({ method: "POST", body: formData });
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

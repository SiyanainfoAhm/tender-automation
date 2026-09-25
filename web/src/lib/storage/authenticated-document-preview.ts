"use client";

/**
 * Fetch an authenticated application document and return a browser-safe Blob
 * URL for iframe preview. Keeping this in one place ensures AI summaries and
 * checklist documents use identical session, error, cache and retry behavior.
 */
const objectUrlCache = new Map<string, string>();
const fetchInFlight = new Map<string, Promise<string>>();

export async function fetchAuthenticatedDocumentObjectUrl(
  url: string,
): Promise<string> {
  const cached = objectUrlCache.get(url);
  if (cached) return cached;

  const existing = fetchInFlight.get(url);
  if (existing) return existing;

  const request = (async () => {
    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
    });
    if (!response.ok) {
      let detail = "";
      if ((response.headers.get("content-type") || "").includes("application/json")) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        detail = body?.error || body?.code || "";
      }
      if (response.status === 401) {
        throw new Error("Sign in again to view this document.");
      }
      if (response.status === 404) {
        throw new Error(detail || "Document file was not found.");
      }
      throw new Error(detail || "Unable to load this document.");
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("This document is empty.");
    const objectUrl = URL.createObjectURL(blob);
    objectUrlCache.set(url, objectUrl);
    return objectUrl;
  })().finally(() => fetchInFlight.delete(url));

  fetchInFlight.set(url, request);
  return request;
}

export function preloadAuthenticatedDocument(url: string | null | undefined): void {
  if (url) void fetchAuthenticatedDocumentObjectUrl(url).catch(() => undefined);
}

export function clearAuthenticatedDocumentPreview(url: string | null | undefined): void {
  if (!url) return;
  const objectUrl = objectUrlCache.get(url);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrlCache.delete(url);
}

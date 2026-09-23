/**
 * Source URL safety — only pass through previously stored DB URLs.
 */
import type { AskAiSource } from "@/lib/ai/ask-ai-stream";

const ALLOWED_URL_PREFIXES = [
  "https://",
  "http://localhost",
  "http://127.0.0.1",
];

export function isTrustedSourceUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.length > 2_048) return false;
  // Reject javascript:/data: etc.
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return false;
  }
  return ALLOWED_URL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Sanitize sources so documentUrl only comes from trusted stored metadata. */
export function sanitizeAskAiSources(sources: AskAiSource[]): AskAiSource[] {
  return sources.map((source) => ({
    ...source,
    documentUrl: isTrustedSourceUrl(source.documentUrl)
      ? source.documentUrl.trim()
      : null,
  }));
}

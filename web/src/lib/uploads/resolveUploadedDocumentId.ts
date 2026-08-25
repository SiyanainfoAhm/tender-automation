/** Prefer top-level documentId; fall back to nested document.id from older edge responses. */
export function resolveUploadedDocumentId(uploaded: {
  documentId?: string | null;
  document?: unknown;
}): string | null {
  if (uploaded.documentId) return String(uploaded.documentId);
  const doc = uploaded.document;
  if (doc && typeof doc === "object" && "id" in doc) {
    const id = (doc as { id?: unknown }).id;
    if (id != null && String(id).trim()) return String(id);
  }
  return null;
}

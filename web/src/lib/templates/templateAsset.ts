import {
  TEMPLATE_ASSET_EXTENSIONS,
  TEMPLATE_ASSET_MIME_TYPES,
} from "@/lib/company/types";
import { formatUploadBytes } from "@/lib/uploads/progress";

export const TEMPLATE_ASSET_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

const GENERIC_MIME = new Set(["", "application/octet-stream"]);

export type TemplateAssetType = "image" | "pdf" | "file";

export function getTemplateAssetType(
  url: string | null,
  fileName?: string | null,
): TemplateAssetType {
  const value = (fileName || url || "").split("?")[0].toLowerCase();

  if (value.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    value.endsWith(".png") ||
    value.endsWith(".jpg") ||
    value.endsWith(".jpeg") ||
    value.endsWith(".webp")
  ) {
    return "image";
  }

  return "file";
}

export function templateSignStampReadUrl(templateId: string) {
  return `/api/templates/${encodeURIComponent(templateId)}/assets/signatory`;
}

export function templateLogoReadUrl(templateId: string) {
  return `/api/templates/${encodeURIComponent(templateId)}/assets/logo`;
}

export function fileNameFromStoragePath(value: string | null | undefined) {
  if (!value) return null;
  const path = value.split("?")[0];
  const name = path.split("/").filter(Boolean).pop();
  if (!name) return null;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function fileNameFromUrl(url: string) {
  return fileNameFromStoragePath(url) || "Company Sign + Stamp";
}

export function formatTemplateAssetSize(bytes: number) {
  return formatUploadBytes(bytes);
}

export function isAllowedTemplateAsset(file: File): boolean {
  const lower = file.name.toLowerCase();
  if (!TEMPLATE_ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return false;
  }
  const mime = (file.type || "").toLowerCase();
  if (GENERIC_MIME.has(mime)) return true;
  return (TEMPLATE_ASSET_MIME_TYPES as readonly string[]).includes(mime);
}

export function templateAssetValidationError(file: File): string | null {
  if (file.size <= 0) {
    return "Company Sign + Stamp file is empty.";
  }
  if (!isAllowedTemplateAsset(file)) {
    return "Unsupported file type. Upload PDF, PNG, JPG, JPEG, or WEBP.";
  }
  return null;
}

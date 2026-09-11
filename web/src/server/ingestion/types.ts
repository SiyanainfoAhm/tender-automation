import { z } from "zod";

export const ingestedFileKinds = [
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "csv",
  "pptx",
  "ppt",
  "html",
  "txt",
  "xml",
  "image",
  "zip",
  "other",
] as const;

export type IngestedFileKind = (typeof ingestedFileKinds)[number];

export type IngestedFile = {
  path: string;
  fileName: string;
  kind: IngestedFileKind;
  bytes: Buffer;
  text?: string;
  truncated?: boolean;
  error?: string;
  pageCount?: number | null;
  parser?: string;
};

export const structuredChecklistItemSchema = z.object({
  requirement_key: z.string().min(1),
  requirement_name: z.string().min(1),
  category: z.string().default("COMPLIANCE"),
  description: z.string().optional().nullable(),
  mandatory: z.boolean().default(true),
  document_type: z.string().optional().nullable(),
  generation_allowed: z.boolean().default(false),
  source_page: z.number().int().optional().nullable(),
  source_clause: z.string().optional().nullable(),
  source_text: z.string().optional().nullable(),
  source_document: z.string().optional().nullable(),
});

export const structuredAnnexureSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  format_hint: z.string().optional().nullable(),
  mandatory: z.boolean().default(true),
});

export const structuredCostItemSchema = z.object({
  description: z.string().min(1),
  detail: z.string().optional().nullable(),
  uom: z.preprocess(
    (v) => (v == null || v === "" ? "Nos" : v),
    z.string().default("Nos"),
  ),
  quantity: z.preprocess(
    (v) => (v == null || v === "" ? 1 : v),
    z.number().nonnegative().default(1),
  ),
  unit_rate: z.preprocess(
    (v) => (v == null || v === "" ? 0 : v),
    z.number().nonnegative().default(0),
  ),
  category: z.preprocess(
    (v) => (v == null || v === "" ? "Services" : v),
    z.string().default("Services"),
  ),
});

export const structuredAiResultSchema = z.object({
  checklist: z.array(structuredChecklistItemSchema).default([]),
  annexures: z.array(structuredAnnexureSchema).default([]),
  cost_items: z.array(structuredCostItemSchema).default([]),
  summary: z.string().optional().nullable(),
  analysis_status: z
    .enum(["OK", "NEEDS_AI_OR_OCR", "AI_FAILED", "PARTIAL"])
    .optional()
    .nullable(),
});

export type StructuredAiResult = z.infer<typeof structuredAiResultSchema>;

export type TenderIngestionResult = {
  sourceFiles: Array<{
    fileName: string;
    kind: IngestedFileKind;
    chars: number;
    path?: string;
    parser?: string;
    error?: string;
  }>;
  structured: StructuredAiResult;
  engine: "openai" | "heuristic" | "needs_ai";
  warning?: string;
};

export function classifyIngestedFile(fileName: string): IngestedFileKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".doc")) return "doc";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".pptx")) return "pptx";
  if (lower.endsWith(".ppt")) return "ppt";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".xml")) return "xml";
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(lower)) return "image";
  if (lower.endsWith(".zip")) return "zip";
  return "other";
}

/** Numeric/opaque portal filenames must never become checklist requirements. */
export function isOpaqueSourceFileName(fileName: string): boolean {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  if (!base) return true;
  if (/^\d{6,}$/.test(base)) return true;
  if (/^file[-_]?\d+$/i.test(base)) return true;
  return false;
}

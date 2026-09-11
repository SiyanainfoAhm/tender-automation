import OpenAI from "openai";
import { createHash } from "node:crypto";

import { BID_AI_PROMPT_CATALOG } from "@/lib/bid-ai-prompts";
import { REQUIREMENT_PATTERNS } from "@/lib/bid-checklist";
import {
  isOpaqueSourceFileName,
  structuredAiResultSchema,
  type IngestedFile,
  type StructuredAiResult,
} from "@/server/ingestion/types";

const DEFAULT_MODEL = "gpt-5-mini";
const MAX_PDF_FILES_FOR_OPENAI = 4;
const MAX_PDF_BYTES_EACH = 4_500_000;
const USEFUL_TEXT_THRESHOLD = 80;

function logIngest(...parts: unknown[]) {
  console.info("[ingestion]", ...parts);
}

function getOpenAiApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || null;
}

function getOpenAiClient(): OpenAI | null {
  const key = getOpenAiApiKey();
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function getIngestionModel(): string {
  return process.env.OPENAI_INGESTION_MODEL?.trim() || DEFAULT_MODEL;
}

function fileHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildCorpus(files: IngestedFile[]): string {
  const parts: string[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const file of files) {
    if (!file.text?.trim()) continue;
    const hash = fileHash(file.bytes);
    if (seen.has(hash)) continue;
    seen.add(hash);
    const block = `----- FILE: ${file.path || file.fileName} (${file.kind}) -----\n${file.text.trim()}`;
    if (total + block.length > 280_000) break;
    parts.push(block);
    total += block.length;
  }
  return parts.join("\n\n");
}

function selectPdfsForOpenAi(files: IngestedFile[]): IngestedFile[] {
  const out: IngestedFile[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (file.kind !== "pdf") continue;
    if (!file.bytes?.length) continue;
    if (file.bytes.length > MAX_PDF_BYTES_EACH) {
      logIngest("PDF_SKIP_TOO_LARGE", {
        fileName: file.fileName,
        bytes: file.bytes.length,
      });
      continue;
    }
    const hash = fileHash(file.bytes);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(file);
    if (out.length >= MAX_PDF_FILES_FOR_OPENAI) break;
  }
  return out;
}

/**
 * Heuristics may classify BOQ-like filenames, but MUST NOT invent
 * checklist requirements from opaque numeric portal filenames.
 */
function heuristicFromFiles(files: IngestedFile[]): StructuredAiResult {
  const checklist: StructuredAiResult["checklist"] = [];
  const seen = new Set<string>();
  const corpus = buildCorpus(files).toLowerCase();

  for (const pattern of REQUIREMENT_PATTERNS) {
    if (seen.has(pattern.key)) continue;
    const hit = pattern.aliases.some((alias) =>
      corpus.includes(alias.toLowerCase()),
    );
    if (!hit) continue;
    seen.add(pattern.key);
    checklist.push({
      requirement_key: pattern.key,
      requirement_name: pattern.key
        .split("_")
        .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
        .join(" "),
      category: pattern.category,
      description: null,
      mandatory: true,
      document_type: pattern.key,
      generation_allowed: pattern.generationAllowed,
      source_page: null,
      source_clause: null,
      source_text: null,
      source_document: null,
    });
  }

  const annexures = files
    .map((f) => f.fileName)
    .filter((n) => /annex|undertaking|declaration|format/i.test(n))
    .filter((n) => !isOpaqueSourceFileName(n))
    .slice(0, 12)
    .map((title) => ({
      title,
      description: "Detected annexure/format from tender package filename",
      format_hint: null,
      mandatory: true,
    }));

  const cost_items: StructuredAiResult["cost_items"] = [];
  for (const file of files) {
    if (file.kind !== "xlsx" && file.kind !== "xls" && file.kind !== "csv") {
      continue;
    }
    const lines = (file.text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 40);
    for (const line of lines) {
      if (/^sheet:/i.test(line)) continue;
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 2) continue;
      const description = cells[0] || line;
      if (
        /^(description|item(\s*name)?|s\.?\s*no\.?|particulars|qty|quantity|uom|unit)$/i.test(
          description,
        )
      ) {
        continue;
      }
      const qty = Number(cells.find((c) => /^\d+(\.\d+)?$/.test(c)) || 1);
      cost_items.push({
        description: description.slice(0, 200),
        detail: cells.slice(1, 3).join(" · ").slice(0, 160) || null,
        uom: "Nos",
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        unit_rate: 0,
        category: "Services",
      });
      if (cost_items.length >= 25) break;
    }
  }

  const hasUsefulText = files.some(
    (f) => (f.text?.trim().length || 0) >= USEFUL_TEXT_THRESHOLD,
  );

  return structuredAiResultSchema.parse({
    checklist,
    annexures,
    cost_items,
    summary: hasUsefulText
      ? `Deterministic extraction from ${files.length} tender file(s) (no OpenAI).`
      : `Some tender documents could not be fully analyzed (${files.length} file(s)).`,
    analysis_status: hasUsefulText
      ? checklist.length
        ? "PARTIAL"
        : "NEEDS_AI_OR_OCR"
      : "NEEDS_AI_OR_OCR",
  });
}

function emptyNeedsAiResult(reason: string): StructuredAiResult {
  return structuredAiResultSchema.parse({
    checklist: [],
    annexures: [],
    cost_items: [],
    summary: reason,
    analysis_status: "NEEDS_AI_OR_OCR",
  });
}

function aiFailedResult(reason: string): StructuredAiResult {
  return structuredAiResultSchema.parse({
    checklist: [],
    annexures: [],
    cost_items: [],
    summary: reason,
    analysis_status: "AI_FAILED",
  });
}

function buildChecklistIngestionSystemPrompt(options?: {
  checklistTemplate?: string | null;
  costTemplate?: string | null;
}): string {
  const checklist =
    options?.checklistTemplate?.trim() ||
    BID_AI_PROMPT_CATALOG.CHECKLIST_CREATION.defaultTemplate;
  const cost =
    options?.costTemplate?.trim() ||
    BID_AI_PROMPT_CATALOG.COST_ESTIMATOR.defaultTemplate;
  return `${checklist}

Additional cost-extraction guidance:
${cost}`;
}

async function callOpenAiStructured(options: {
  client: OpenAI;
  model: string;
  corpus: string;
  pdfs: IngestedFile[];
  systemPrompt: string;
}): Promise<StructuredAiResult> {
  const promptText =
    (options.corpus.trim()
      ? `Extracted text corpus from tender package:\n\n${options.corpus.slice(0, 220_000)}\n\n`
      : "Local text extraction was empty or weak for some files. Analyze the attached PDF file(s) directly.\n\n") +
    `Also attached: ${options.pdfs.length} PDF file(s) as binary inputs. Reconcile the complete package into one checklist.`;

  logIngest("OPENAI_REQUEST", {
    model: options.model,
    corpusChars: options.corpus.length,
    pdfCount: options.pdfs.length,
    pdfNames: options.pdfs.map((p) => p.fileName),
  });

  try {
    const response = await options.client.responses.create({
      model: options.model,
      text: { format: { type: "json_object" } },
      input: [
        { role: "system", content: options.systemPrompt },
        {
          role: "user",
          content: [
            { type: "input_text", text: promptText },
            ...options.pdfs.map((pdf) => ({
              type: "input_file" as const,
              filename: pdf.fileName,
              file_data: `data:application/pdf;base64,${pdf.bytes.toString("base64")}`,
            })),
          ],
        },
      ],
    });

    const raw =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response as any).output_text ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response as any).output?.[0]?.content?.[0]?.text ||
      "{}";
    const parsed = JSON.parse(String(raw));
    return structuredAiResultSchema.parse({
      ...parsed,
      analysis_status: parsed.analysis_status || "OK",
    });
  } catch (responsesError) {
    logIngest("OPENAI_RESPONSES_FALLBACK_CHAT", {
      message:
        responsesError instanceof Error
          ? responsesError.message
          : String(responsesError),
    });

    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "file"; file: { filename: string; file_data: string } }
    > = [
      { type: "text", text: promptText },
      ...options.pdfs.map((pdf) => ({
        type: "file" as const,
        file: {
          filename: pdf.fileName,
          file_data: `data:application/pdf;base64,${pdf.bytes.toString("base64")}`,
        },
      })),
    ];

    const response = await options.client.chat.completions.create({
      model: options.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: options.systemPrompt },
        {
          role: "user",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: userContent as any,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    return structuredAiResultSchema.parse({
      ...parsed,
      analysis_status: parsed.analysis_status || "OK",
    });
  }
}

function filterInventedFilenameRequirements(
  structured: StructuredAiResult,
  sourceNames: string[],
): StructuredAiResult {
  const opaque = new Set(
    sourceNames
      .map((n) => n.replace(/\.[^.]+$/, "").trim().toLowerCase())
      .filter((n) => isOpaqueSourceFileName(`${n}.pdf`) || /^\d{6,}$/.test(n)),
  );
  const checklist = structured.checklist.filter((item) => {
    const name = item.requirement_name.trim().toLowerCase();
    const key = item.requirement_key.trim().toLowerCase();
    if (opaque.has(name) || opaque.has(key)) return false;
    if (isOpaqueSourceFileName(item.requirement_name)) return false;
    if (/^\d{6,}$/.test(item.requirement_name.trim())) return false;
    if (
      sourceNames.some((n) => {
        const base = n.replace(/\.[^.]+$/, "").trim().toLowerCase();
        return (
          base === name &&
          (isOpaqueSourceFileName(n) || /^\d/.test(n) || /seed act/i.test(n))
        );
      })
    ) {
      return false;
    }
    return true;
  });
  return { ...structured, checklist };
}

export async function buildStructuredAiResult(
  files: IngestedFile[],
  options?: {
    checklistPromptTemplate?: string | null;
    costPromptTemplate?: string | null;
  },
): Promise<{
  structured: StructuredAiResult;
  engine: "openai" | "heuristic" | "needs_ai";
  warning?: string;
}> {
  const systemPrompt = buildChecklistIngestionSystemPrompt({
    checklistTemplate: options?.checklistPromptTemplate,
    costTemplate: options?.costPromptTemplate,
  });
  const client = getOpenAiClient();
  const model = getIngestionModel();
  const corpus = buildCorpus(files);
  const pdfs = selectPdfsForOpenAi(files);
  const sourceNames = files.map((f) => f.fileName);

  const usefulTextFiles = files.filter(
    (f) => (f.text?.trim().length || 0) >= USEFUL_TEXT_THRESHOLD,
  );
  const emptyTextPdfs = files.filter(
    (f) => f.kind === "pdf" && !(f.text?.trim().length),
  );

  logIngest("OPENAI CONFIGURED", {
    configured: Boolean(client),
    model,
    apiPath: "responses.create → chat.completions.create fallback",
    fileCount: files.length,
    usefulTextFiles: usefulTextFiles.length,
    emptyTextPdfs: emptyTextPdfs.length,
    pdfsForOpenAi: pdfs.length,
    corpusChars: corpus.length,
  });

  if (!client) {
    const structured = heuristicFromFiles(files);
    if (structured.analysis_status === "NEEDS_AI_OR_OCR") {
      return {
        structured,
        engine: "needs_ai",
        warning:
          "OPENAI_API_KEY is not configured. Some tender documents could not be fully analyzed. Add OPENAI_API_KEY in web/.env and retry.",
      };
    }
    return {
      structured: filterInventedFilenameRequirements(structured, sourceNames),
      engine: "heuristic",
      warning:
        "OPENAI_API_KEY is not configured. Used text heuristics only (never filename→requirement).",
    };
  }

  // CRITICAL: even when local PDF text is empty (scanned), still send PDF bytes.
  if (!corpus.trim() && pdfs.length === 0) {
    return {
      structured: emptyNeedsAiResult(
        "Some tender documents could not be fully analyzed (no readable text and no PDF bytes for AI).",
      ),
      engine: "needs_ai",
      warning:
        "Some tender documents could not be fully analyzed. Retry after confirming uploads.",
    };
  }

  try {
    const structured = filterInventedFilenameRequirements(
      await callOpenAiStructured({
        client,
        model,
        corpus,
        pdfs,
        systemPrompt,
      }),
      sourceNames,
    );
    if (!structured.checklist.length && !structured.cost_items.length) {
      return {
        structured: {
          ...structured,
          analysis_status: "PARTIAL",
          summary:
            structured.summary ||
            "AI returned no checklist items for this package.",
        },
        engine: "openai",
        warning: "AI analysis completed but produced no checklist requirements.",
      };
    }
    return { structured, engine: "openai" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logIngest("OPENAI_ERROR", { message });
    return {
      structured: aiFailedResult(`AI analysis failed: ${message}`),
      engine: "needs_ai",
      warning: `AI analysis failed. ${message}`,
    };
  }
}

/** Test helper */
export function __testOnly_heuristicFromFiles(files: IngestedFile[]) {
  return heuristicFromFiles(files);
}

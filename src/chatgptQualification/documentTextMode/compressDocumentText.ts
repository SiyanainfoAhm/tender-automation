/**
 * Compress extracted tender document text for DOCUMENT_TEXT_MODE prompts.
 * Never paste raw multi-hundred-k extracts into the ChatGPT composer.
 */
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../../logger.js";
import type { ExtractedDocumentText } from "./extractDocumentText.js";

export const DEFAULT_MAX_DOCUMENT_CONTEXT_CHARACTERS = 50_000;

export type DocumentTextSummaryEntry = {
  filename: string;
  summary: string;
  keyRequirements: string;
  eligibility: string;
  financialDetails: string;
  scope: string;
  importantClauses: string;
};

export type DocumentTextSummaryBundle = {
  tenderId: string;
  extractedFiles: number;
  totalCharacters: number;
  documents: DocumentTextSummaryEntry[];
};

export type CompressedDocumentContext = {
  summary: DocumentTextSummaryBundle;
  cleanedLength: number;
  finalContext: string;
  finalContextLength: number;
  compressionApplied: boolean;
  summaryPath: string;
};

function log(logger: Logger | undefined, message: string): void {
  console.log(message);
  logger?.info(message);
}

const BOILERPLATE_LINE_RE = [
  /^\s*page\s*\d+(\s*(of|\/)\s*\d+)?\s*$/i,
  /^\s*\d+\s*\/\s*\d+\s*$/,
  /^\s*confidential\s*$/i,
  /^\s*tender\s*247\b.*$/i,
  /^\s*www\.tender247\.com\b.*$/i,
  /^\s*powered by\b.*$/i,
  /^\s*all rights reserved\b.*$/i,
  /^\s*downloaded from\b.*$/i,
  /^\s*print(ed)?\s*on\b.*$/i,
  /^\s*generated on\b.*$/i,
  /^\s*-\s*\d+\s*-\s*$/,
];

const SECTION_PATTERNS: Array<{
  key: keyof Pick<
    DocumentTextSummaryEntry,
    | "scope"
    | "eligibility"
    | "financialDetails"
    | "keyRequirements"
    | "importantClauses"
  >;
  match: RegExp;
}> = [
  {
    key: "scope",
    match:
      /\b(scope\s+of\s+(work|services?)|work\s+description|nature\s+of\s+work|brief\s+description|objective|deliverables?)\b/i,
  },
  {
    key: "eligibility",
    match:
      /\b(eligibility|pre[- ]?qualification|pq\s+criteria|bidder\s+qualification|similar\s+work|experience\s+criteria|turnover\s+criteria)\b/i,
  },
  {
    key: "financialDetails",
    match:
      /\b(emd|earnest\s+money|tender\s+(value|fee|amount|cost)|estimated\s+(cost|value)|bid\s+security|performance\s+(security|guarantee)|bank\s+guarantee|bg\b)\b/i,
  },
  {
    key: "keyRequirements",
    match:
      /\b(technical\s+requirement|mandatory\s+(document|certificate|requirement)|iso\s*\d|gst|pan\b|msme|udyam|cmmi|experience\s+of|minimum\s+experience|manpower|resource)\b/i,
  },
  {
    key: "importantClauses",
    match:
      /\b(submission|due\s+date|closing\s+date|last\s+date|bid\s+submission|validity|liquidated\s+damages|ld\b|penalty|termination|force\s+majeure|payment\s+terms|sla\b|warranty|amc\b)\b/i,
  },
];

/** Strip repeated headers/footers/page numbers and collapse blank lines. */
export function cleanExtractedDocumentText(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const cleaned: string[] = [];
  const seen = new Map<string, number>();

  for (const line of lines) {
    const trimmed = line.replace(/[ \t]+$/g, "").trimEnd();
    const normalized = trimmed.replace(/\s+/g, " ").trim();
    if (!normalized) {
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== "") {
        cleaned.push("");
      }
      continue;
    }
    if (BOILERPLATE_LINE_RE.some((re) => re.test(normalized))) {
      continue;
    }
    // Drop near-duplicate header/footer lines that repeat.
    const key = normalized.toLowerCase();
    const count = seen.get(key) ?? 0;
    if (count >= 1 && normalized.length < 160) {
      continue;
    }
    seen.set(key, count + 1);
    cleaned.push(trimmed);
  }

  return cleaned
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectSectionSnippets(
  cleaned: string,
  maxPerSection: number,
): Pick<
  DocumentTextSummaryEntry,
  | "scope"
  | "eligibility"
  | "financialDetails"
  | "keyRequirements"
  | "importantClauses"
> {
  const lines = cleaned.split("\n");
  const buckets: Record<string, string[]> = {
    scope: [],
    eligibility: [],
    financialDetails: [],
    keyRequirements: [],
    importantClauses: [],
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;
    for (const pattern of SECTION_PATTERNS) {
      if (!pattern.match.test(line)) continue;
      const chunk = [line];
      for (let j = 1; j <= 4 && i + j < lines.length; j += 1) {
        const next = lines[i + j]!.trim();
        if (!next) break;
        chunk.push(next);
      }
      const text = chunk.join(" ").replace(/\s+/g, " ").trim();
      const bucket = buckets[pattern.key]!;
      if (!bucket.some((existing) => existing.includes(text.slice(0, 80)))) {
        bucket.push(text);
      }
    }
  }

  const joinCap = (items: string[]): string => {
    if (!items.length) return "";
    let out = "";
    for (const item of items) {
      const clipped =
        item.length > maxPerSection
          ? `${item.slice(0, Math.max(0, maxPerSection - 20))}…`
          : item;
      const next = out ? `${out}\n- ${clipped}` : `- ${clipped}`;
      if (next.length > maxPerSection) {
        if (!out) return `- ${clipped.slice(0, Math.max(0, maxPerSection - 4))}…`;
        break;
      }
      out = next;
    }
    return out;
  };

  return {
    scope: joinCap(buckets.scope!),
    eligibility: joinCap(buckets.eligibility!),
    financialDetails: joinCap(buckets.financialDetails!),
    keyRequirements: joinCap(buckets.keyRequirements!),
    importantClauses: joinCap(buckets.importantClauses!),
  };
}

function buildFileSummary(
  filename: string,
  cleaned: string,
  maxSummaryChars: number,
): DocumentTextSummaryEntry {
  const sections = collectSectionSnippets(cleaned, Math.floor(maxSummaryChars / 3));
  const fallback = cleaned.slice(0, Math.min(1_200, maxSummaryChars)).trim();
  const summaryParts = [
    sections.scope && `Scope: ${sections.scope.replace(/^- /, "")}`,
    sections.financialDetails &&
      `Financial: ${sections.financialDetails.replace(/^- /, "")}`,
    sections.eligibility &&
      `Eligibility: ${sections.eligibility.replace(/^- /, "")}`,
  ].filter(Boolean);
  let summary = summaryParts.join(" | ") || fallback;
  if (summary.length > maxSummaryChars) {
    summary = `${summary.slice(0, maxSummaryChars - 20)}\n[TRUNCATED]`;
  }
  return {
    filename,
    summary,
    keyRequirements: sections.keyRequirements,
    eligibility: sections.eligibility,
    financialDetails: sections.financialDetails,
    scope: sections.scope,
    importantClauses: sections.importantClauses,
  };
}

function renderCompressedContext(
  summary: DocumentTextSummaryBundle,
  maxChars: number,
): string {
  const blocks: string[] = [];
  for (const doc of summary.documents) {
    const parts = [
      `DOCUMENT: ${doc.filename}`,
      doc.summary ? `Summary:\n${doc.summary}` : null,
      doc.scope ? `Scope:\n${doc.scope}` : null,
      doc.eligibility ? `Eligibility:\n${doc.eligibility}` : null,
      doc.financialDetails ? `Financial details:\n${doc.financialDetails}` : null,
      doc.keyRequirements ? `Key requirements:\n${doc.keyRequirements}` : null,
      doc.importantClauses
        ? `Important clauses:\n${doc.importantClauses}`
        : null,
    ].filter(Boolean);
    blocks.push(parts.join("\n\n"));
  }
  let context = blocks.join("\n\n------------------\n\n").trim();
  if (context.length > maxChars) {
    context = `${context.slice(0, maxChars - 24)}\n\n[CONTEXT_TRUNCATED]`;
  }
  return context;
}

/**
 * Clean + compress extracted documents into a bounded ChatGPT context and
 * write document-text-summary.json. Originals are left untouched.
 */
export function compressDocumentTextForPrompt(options: {
  tenderId: string;
  tenderFolder: string;
  documents: ExtractedDocumentText[];
  maxContextCharacters?: number;
  logger?: Logger;
}): CompressedDocumentContext {
  const tenderId = options.tenderId.startsWith("T247-")
    ? options.tenderId
    : `T247-${options.tenderId.replace(/\D/g, "")}`;
  const maxChars = Math.max(
    5_000,
    options.maxContextCharacters ?? DEFAULT_MAX_DOCUMENT_CONTEXT_CHARACTERS,
  );

  const rawLength = options.documents.reduce(
    (sum, doc) => sum + (doc.text?.length ?? 0),
    0,
  );
  log(options.logger, `DOCUMENT_TEXT_RAW_LENGTH=${rawLength}`);

  const cleanedDocs = options.documents
    .filter((doc) => (doc.text ?? "").trim().length > 0)
    .map((doc) => ({
      filename: doc.filename,
      cleaned: cleanExtractedDocumentText(doc.text),
    }));
  const cleanedLength = cleanedDocs.reduce(
    (sum, doc) => sum + doc.cleaned.length,
    0,
  );
  log(options.logger, `DOCUMENT_TEXT_CLEAN_LENGTH=${cleanedLength}`);

  const compressionApplied = rawLength > maxChars || cleanedLength > maxChars;
  log(
    options.logger,
    `DOCUMENT_TEXT_COMPRESSION_APPLIED=${compressionApplied ? "true" : "false"}`,
  );

  const perFileBudget = Math.max(
    1_500,
    Math.floor(maxChars / Math.max(1, cleanedDocs.length)),
  );
  const documents: DocumentTextSummaryEntry[] = cleanedDocs.map((doc) =>
    buildFileSummary(doc.filename, doc.cleaned, perFileBudget),
  );

  const summary: DocumentTextSummaryBundle = {
    tenderId,
    extractedFiles: documents.length,
    totalCharacters: rawLength,
    documents,
  };

  const summaryPath = path.join(options.tenderFolder, "document-text-summary.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        tenderId: summary.tenderId,
        extractedFiles: String(summary.extractedFiles),
        totalCharacters: String(summary.totalCharacters),
        documents: summary.documents,
      },
      null,
      2,
    ),
    "utf8",
  );

  let finalContext: string;
  if (!compressionApplied && cleanedLength <= maxChars) {
    // Still prefer structured context under the cap — never paste huge raw text.
    finalContext = cleanedDocs
      .map((doc) => `DOCUMENT: ${doc.filename}\n\n${doc.cleaned}`)
      .join("\n\n------------------\n\n");
    if (finalContext.length > maxChars) {
      finalContext = renderCompressedContext(summary, maxChars);
    }
  } else {
    finalContext = renderCompressedContext(summary, maxChars);
  }

  if (finalContext.length > maxChars) {
    finalContext = `${finalContext.slice(0, maxChars - 24)}\n\n[CONTEXT_TRUNCATED]`;
  }

  log(
    options.logger,
    `DOCUMENT_TEXT_FINAL_CONTEXT_LENGTH=${finalContext.length}`,
  );

  return {
    summary,
    cleanedLength,
    finalContext,
    finalContextLength: finalContext.length,
    compressionApplied: compressionApplied || finalContext.length < rawLength,
    summaryPath,
  };
}

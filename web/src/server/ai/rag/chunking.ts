import "server-only";

import { getEncoding } from "js-tiktoken";

const encoding = getEncoding("cl100k_base");

const TARGET_MIN_TOKENS = 500;
const TARGET_MAX_TOKENS = 900;
const OVERLAP_TOKENS = 120;

export function countTokens(text: string): number {
  if (!text) return 0;
  return encoding.encode(text).length;
}

export type TextChunk = {
  chunkIndex: number;
  content: string;
  section: string | null;
  /** Not fabricated — only set when caller supplies page info. */
  pageNumber: number | null;
};

/**
 * Semantic-leaning chunker for tender/company text.
 * Prefers headings, numbered clauses, and paragraphs over blind token cuts.
 *
 * Limitation: PDF extraction currently yields flat text + whole-doc pageCount,
 * so pageNumber is usually null unless the caller sets it.
 */
export function chunkText(options: {
  text: string;
  pageNumber?: number | null;
  defaultSection?: string | null;
}): TextChunk[] {
  const normalized = normalizeText(options.text);
  if (!normalized) return [];

  const blocks = splitIntoSemanticBlocks(normalized);
  const chunks: TextChunk[] = [];
  let buffer = "";
  let bufferSection: string | null = options.defaultSection ?? null;

  const flush = () => {
    const content = buffer.trim();
    if (!content) {
      buffer = "";
      return;
    }
    chunks.push({
      chunkIndex: chunks.length,
      content,
      section: bufferSection,
      pageNumber: options.pageNumber ?? null,
    });
    buffer = overlapTail(content);
  };

  for (const block of blocks) {
    if (block.kind === "heading") {
      if (countTokens(buffer) >= TARGET_MIN_TOKENS) flush();
      bufferSection = block.text.slice(0, 200);
    }

    const candidate = buffer ? `${buffer}\n\n${block.text}` : block.text;
    if (countTokens(candidate) <= TARGET_MAX_TOKENS) {
      buffer = candidate;
      continue;
    }

    if (buffer.trim()) flush();

    if (countTokens(block.text) <= TARGET_MAX_TOKENS) {
      buffer = block.text;
      continue;
    }

    for (const piece of splitOversizedBlock(block.text)) {
      const next = buffer ? `${buffer}\n\n${piece}` : piece;
      if (countTokens(next) > TARGET_MAX_TOKENS && buffer.trim()) {
        flush();
        buffer = piece;
      } else {
        buffer = next;
      }
    }
  }

  if (buffer.trim()) flush();

  // Drop tiny trailing overlap-only leftovers that duplicate previous content.
  return chunks.filter((chunk, index) => {
    if (index === 0) return true;
    return countTokens(chunk.content) >= 40;
  });
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

type SemanticBlock = {
  kind: "heading" | "clause" | "paragraph" | "table";
  text: string;
};

function splitIntoSemanticBlocks(text: string): SemanticBlock[] {
  const raw = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const blocks: SemanticBlock[] = [];
  for (const part of raw) {
    if (isHeading(part)) blocks.push({ kind: "heading", text: part });
    else if (isTableLike(part)) blocks.push({ kind: "table", text: part });
    else if (isNumberedClause(part)) blocks.push({ kind: "clause", text: part });
    else blocks.push({ kind: "paragraph", text: part });
  }
  return blocks;
}

function isHeading(text: string): boolean {
  const first = text.split("\n")[0] || text;
  if (first.length > 120) return false;
  if (/^#{1,6}\s+\S/.test(first)) return true;
  if (/^(section|clause|chapter|annexure|schedule|part)\b/i.test(first)) {
    return true;
  }
  if (/^[A-Z0-9][A-Z0-9\s\-_/()]{2,80}$/.test(first) && first === first.toUpperCase()) {
    return true;
  }
  return false;
}

function isNumberedClause(text: string): boolean {
  return /^(\d+(\.\d+)+|[a-z]\)|\([a-z0-9]+\)|\d+\))\s+\S/i.test(text.trim());
}

function isTableLike(text: string): boolean {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length < 2) return false;
  const pipeLines = lines.filter((line) => line.includes("|")).length;
  return pipeLines / lines.length >= 0.6;
}

function splitOversizedBlock(text: string): string[] {
  const sentences = text.split(/(?<=[.:;])\s+(?=[A-Z0-9(])/);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (countTokens(next) > TARGET_MAX_TOKENS && current) {
      parts.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);

  // Absolute fallback: hard token windows with overlap.
  const out: string[] = [];
  for (const part of parts) {
    if (countTokens(part) <= TARGET_MAX_TOKENS) {
      out.push(part);
      continue;
    }
    const tokens = encoding.encode(part);
    let start = 0;
    while (start < tokens.length) {
      const end = Math.min(start + TARGET_MAX_TOKENS, tokens.length);
      out.push(encoding.decode(tokens.slice(start, end)));
      if (end >= tokens.length) break;
      start = Math.max(end - OVERLAP_TOKENS, start + 1);
    }
  }
  return out;
}

function overlapTail(content: string): string {
  const tokens = encoding.encode(content);
  if (tokens.length <= OVERLAP_TOKENS) return content;
  return encoding.decode(tokens.slice(tokens.length - OVERLAP_TOKENS));
}

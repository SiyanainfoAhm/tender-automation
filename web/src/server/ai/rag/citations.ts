import "server-only";

import { countTokens } from "@/server/ai/rag/chunking";
import {
  EXCERPT_CHARS,
  MAX_CONTEXT_TOKENS,
  type AskAiSource,
  type EvidenceItem,
  type RetrievedChunk,
} from "@/server/ai/rag/retrieval-types";
import { sanitizeAskAiSources } from "@/server/ai/rag/source-url-safety";
import { getAskAiInputLimits } from "@/server/ai/rag/config";

export function makeExcerpt(content: string, maxChars = EXCERPT_CHARS): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

export function assignEvidenceIds(options: {
  tenderChunks: RetrievedChunk[];
  companyChunks: RetrievedChunk[];
}): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  options.tenderChunks.forEach((chunk, index) => {
    items.push({
      evidenceId: `T${index + 1}`,
      chunk,
      excerpt: makeExcerpt(chunk.content),
    });
  });
  options.companyChunks.forEach((chunk, index) => {
    items.push({
      evidenceId: `C${index + 1}`,
      chunk,
      excerpt: makeExcerpt(chunk.content),
    });
  });
  return items;
}

/** Drop lowest-ranked evidence until under token budget. */
export function trimEvidenceToBudget(
  evidence: EvidenceItem[],
  maxTokens?: number,
): EvidenceItem[] {
  const budget =
    maxTokens ??
    Math.min(MAX_CONTEXT_TOKENS, getAskAiInputLimits().maxContextTokens);
  const ranked = [...evidence].sort(
    (a, b) => b.chunk.score - a.chunk.score,
  );
  const kept: EvidenceItem[] = [];
  let used = 0;
  for (const item of ranked) {
    const cost = countTokens(formatEvidenceBlock(item));
    if (kept.length > 0 && used + cost > budget) continue;
    kept.push(item);
    used += cost;
  }
  // Restore T# then C# order for stable prompt IDs
  const tender = kept
    .filter((item) => item.evidenceId.startsWith("T"))
    .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId, undefined, { numeric: true }));
  const company = kept
    .filter((item) => item.evidenceId.startsWith("C"))
    .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId, undefined, { numeric: true }));
  return [...tender, ...company];
}

export function formatEvidenceBlock(item: EvidenceItem): string {
  const { chunk, evidenceId, excerpt } = item;
  const kind = evidenceId.startsWith("C") ? "COMPANY" : "TENDER";
  const page =
    chunk.pageNumber != null ? `Page: ${chunk.pageNumber}` : "Page: unknown";
  return `[${kind} EVIDENCE ${evidenceId}]
Document: ${chunk.documentName || "Unknown"}
Section: ${chunk.section || "n/a"}
${page}
Content:
${excerpt}`;
}

export function buildGroundedContext(evidence: EvidenceItem[]): {
  contextText: string;
  contextTokensApprox: number;
} {
  if (evidence.length === 0) {
    return {
      contextText: "(No relevant indexed evidence retrieved.)",
      contextTokensApprox: 8,
    };
  }
  const contextText = evidence.map(formatEvidenceBlock).join("\n\n");
  return {
    contextText,
    contextTokensApprox: countTokens(contextText),
  };
}

const CITATION_RE = /\[(T|C)(\d+)\]/g;

/** Map model citations to sources; ignore unknown IDs. */
export function parseCitations(options: {
  answer: string;
  evidence: EvidenceItem[];
}): { sources: AskAiSource[]; unknownIds: string[]; warnings: string[] } {
  const byId = new Map(options.evidence.map((item) => [item.evidenceId, item]));
  const cited = new Set<string>();
  const unknownIds: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(CITATION_RE.source, "g");
  while ((match = re.exec(options.answer)) !== null) {
    const id = `${match[1]}${match[2]}`;
    if (byId.has(id)) cited.add(id);
    else unknownIds.push(id);
  }

  const warnings: string[] = [];
  if (unknownIds.length) {
    warnings.push(
      `Ignored unknown citation id(s): ${Array.from(new Set(unknownIds)).join(", ")}.`,
    );
  }

  const orderedIds =
    cited.size > 0
      ? Array.from(cited)
      : options.evidence.slice(0, 6).map((item) => item.evidenceId);

  const sources: AskAiSource[] = orderedIds
    .map((id) => byId.get(id))
    .filter((item): item is EvidenceItem => Boolean(item))
    .map((item) => ({
      id: item.evidenceId,
      fileName: item.chunk.documentName || "Document",
      pageCount: null,
      sourceType: item.chunk.sourceType,
      sourceId: item.chunk.sourceId,
      documentName: item.chunk.documentName,
      documentUrl: item.chunk.documentUrl,
      pageNumber: item.chunk.pageNumber,
      section: item.chunk.section,
      excerpt: item.excerpt,
      tenderId: item.chunk.tenderId,
      companyId: item.chunk.companyId,
    }));

  return { sources: sanitizeAskAiSources(sources), unknownIds, warnings };
}

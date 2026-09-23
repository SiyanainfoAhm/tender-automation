import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  encodeSseEvent,
  parseSseChunk,
  type AskAiStreamEvent,
} from "@/lib/ai/ask-ai-stream";
import { parseCitations, assignEvidenceIds } from "@/server/ai/rag/citations";
import type { RetrievedChunk } from "@/server/ai/rag/retrieval-types";

function chunk(partial: Partial<RetrievedChunk> & { id: string }): RetrievedChunk {
  return {
    companyId: partial.companyId ?? null,
    tenderId: partial.tenderId ?? "tender-a",
    sourceType: partial.sourceType ?? "TENDER_DOCUMENT",
    sourceId: partial.sourceId ?? "src-1",
    documentName: partial.documentName ?? "RFP.pdf",
    documentUrl: null,
    documentType: "pdf",
    pageNumber: null,
    section: partial.section ?? "Eligibility",
    chunkIndex: partial.chunkIndex ?? 0,
    content: partial.content ?? "eligibility requirement",
    contentHash: "hash",
    metadata: {},
    score: partial.score ?? 0.5,
    vectorSimilarity: 0.5,
    ftsRank: null,
    ...partial,
  };
}

describe("Ask AI SSE protocol", () => {
  it("encodes and parses status before deltas", () => {
    const frames = [
      encodeSseEvent({
        type: "status",
        stage: "retrieving",
        message: "Checking financial eligibility...",
      }),
      encodeSseEvent({ type: "delta", text: "Hello" }),
      encodeSseEvent({ type: "delta", text: " world" }),
      encodeSseEvent({
        type: "sources",
        sources: [{ fileName: "RFP.pdf", pageCount: null, id: "T1" }],
        warnings: [],
      }),
      encodeSseEvent({ type: "done" }),
    ].join("");

    const { events } = parseSseChunk(frames);
    expect(events[0]?.type).toBe("status");
    expect(
      (events[0] as Extract<AskAiStreamEvent, { type: "status" }>).message,
    ).toMatch(/financial eligibility/i);
    expect(
      events
        .filter((e) => e.type === "delta")
        .map((e) => (e as Extract<AskAiStreamEvent, { type: "delta" }>).text),
    ).toEqual(["Hello", " world"]);
    expect(events.some((e) => e.type === "sources")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("buffers incomplete SSE frames", () => {
    const first = parseSseChunk('event: delta\ndata: {"type":"delta","text":"Hi');
    expect(first.events).toHaveLength(0);
    const second = parseSseChunk(`${first.rest}"}\n\n`);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toEqual({ type: "delta", text: "Hi" });
  });
});

describe("streaming citation completion", () => {
  it("maps citations after full answer and ignores unknown ids", () => {
    const evidence = assignEvidenceIds({
      tenderChunks: [chunk({ id: "1", content: "Turnover five crore." })],
      companyChunks: [],
    });
    const parsed = parseCitations({
      answer: "Required is five crore [T1]. Bad [T9].",
      evidence,
    });
    expect(parsed.sources.map((s) => s.id)).toEqual(["T1"]);
    expect(parsed.unknownIds).toContain("T9");
  });
});

describe("stream module isolation", () => {
  it("does not call SharePoint/extraction helpers", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const streamFile = await fs.readFile(
      path.resolve("src/server/ai/rag/stream-ask-ai.ts"),
      "utf8",
    );
    const prepareFile = await fs.readFile(
      path.resolve("src/server/ai/rag/ask-ai-rag.ts"),
      "utf8",
    );
    for (const file of [streamFile, prepareFile]) {
      expect(file).not.toMatch(
        /invokeBlobRead|invokeDocumentRead|ingestDocumentBytes|buildTenderAiContext/,
      );
    }
  });
});

describe("partial markdown safety", () => {
  it("AnswerContent-like split does not throw on incomplete tokens", () => {
    const content = "**Turn\n| Col\n[T";
    expect(() => {
      content.split("\n").forEach((line) => {
        if (line.startsWith("### ")) return line.slice(4);
        if (line.startsWith("## ")) return line.slice(3);
        if (line.startsWith("# ")) return line.slice(2);
        if (/^[-*] /.test(line)) return line.slice(2);
        return line;
      });
    }).not.toThrow();
  });
});

describe("history filtering helpers", () => {
  it("only completed assistant messages should be reused", () => {
    const messages = [
      { role: "user" as const, content: "Q1" },
      {
        role: "assistant" as const,
        content: "A1",
        incomplete: false,
        error: false,
      },
      { role: "user" as const, content: "Q2" },
      {
        role: "assistant" as const,
        content: "partial",
        incomplete: true,
        error: false,
      },
    ];
    const conversation = messages
      .filter(
        (item) =>
          item.role === "user" ||
          (item.role === "assistant" &&
            !item.incomplete &&
            !item.error &&
            item.content.trim()),
      )
      .map(({ role, content }) => ({ role, content }));
    expect(conversation).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
    ]);
  });
});

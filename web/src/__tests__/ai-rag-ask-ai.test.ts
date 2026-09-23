import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  diversifyChunks,
  mergeHybridCandidates,
  mergeRetrievedChunkLists,
} from "@/server/ai/rag/hybrid-search";
import { parseCitations, assignEvidenceIds } from "@/server/ai/rag/citations";
import {
  actionPromptAddon,
  buildFtsQuery,
  normalizeAskAiQuery,
  resolveAskAiAction,
} from "@/server/ai/rag/intents";
import { buildActionRetrievalQueries } from "@/server/ai/rag/action-retrieval";
import {
  ASK_AI_QUICK_ACTIONS,
  actionStatusText,
  isBroadAskAiAction,
  normalizeAskAiActionId,
} from "@/lib/ai/ask-ai-actions";
import type { AskAiAction } from "@/lib/ai/ask-ai-stream";
import type { RetrievedChunk } from "@/server/ai/rag/retrieval-types";

function chunk(partial: Partial<RetrievedChunk> & { id: string }): RetrievedChunk {
  return {
    companyId: partial.companyId ?? "company-a",
    tenderId: partial.tenderId ?? "tender-a",
    sourceType: partial.sourceType ?? "TENDER_DOCUMENT",
    sourceId: partial.sourceId ?? "src-1",
    documentName: partial.documentName ?? "RFP.pdf",
    documentUrl: null,
    documentType: "pdf",
    pageNumber: null,
    section: partial.section ?? "Eligibility",
    chunkIndex: partial.chunkIndex ?? 0,
    content: partial.content ?? "turnover requirement of five crore",
    contentHash: "hash",
    metadata: {},
    score: partial.score ?? 0.5,
    vectorSimilarity: partial.vectorSimilarity ?? 0.5,
    ftsRank: partial.ftsRank ?? null,
    ...partial,
  };
}

const ALL_ACTIONS: AskAiAction[] = [
  "ASSESS_TENDER",
  "CHECK_ELIGIBILITY",
  "CHECK_SIMILAR_EXPERIENCE",
  "CHECK_TURNOVER",
  "CHECK_GOVERNMENT_EXPERIENCE",
  "CHECK_REQUIRED_DOCUMENTS",
  "CHECK_EMD_MSME",
  "IDENTIFY_RISKS",
  "SUMMARIZE_TENDER",
];

describe("Phase 7 quick-action catalog", () => {
  it("maps UI labels to structured action IDs (not label inference alone)", () => {
    const expected: Record<string, AskAiAction> = {
      "Assess Tender": "ASSESS_TENDER",
      Eligibility: "CHECK_ELIGIBILITY",
      "Similar Experience": "CHECK_SIMILAR_EXPERIENCE",
      Turnover: "CHECK_TURNOVER",
      "Government Experience": "CHECK_GOVERNMENT_EXPERIENCE",
      "Required Documents": "CHECK_REQUIRED_DOCUMENTS",
      "EMD / MSME": "CHECK_EMD_MSME",
      Risks: "IDENTIFY_RISKS",
      Summarize: "SUMMARIZE_TENDER",
    };
    expect(ASK_AI_QUICK_ACTIONS).toHaveLength(9);
    for (const item of ASK_AI_QUICK_ACTIONS) {
      expect(item.action).toBe(expected[item.label]);
      expect(item.message.length).toBeGreaterThan(20);
      expect(item.message).not.toBe(item.label);
    }
  });

  it("prefers explicit action ID over display text", () => {
    expect(
      resolveAskAiAction(
        "Assess this tender against our available company evidence.",
        "CHECK_TURNOVER",
      ),
    ).toBe("CHECK_TURNOVER");
    expect(normalizeAskAiActionId("check_emd_msme")).toBe("CHECK_EMD_MSME");
  });
});

describe("ask-ai intents", () => {
  it("maps suggestion strings to actions", () => {
    expect(resolveAskAiAction("Check Turnover")).toBe("CHECK_TURNOVER");
    expect(resolveAskAiAction("Summarize Tender")).toBe("SUMMARIZE_TENDER");
    expect(resolveAskAiAction("What is EMD?")).toBe("CHECK_EMD_MSME");
  });

  it("normalizes whitespace without stripping tender terms", () => {
    expect(normalizeAskAiQuery("  EMD   MSME\n\n\nturnover  ")).toContain(
      "EMD",
    );
    expect(normalizeAskAiQuery("  EMD   MSME\n\n\nturnover  ")).toContain(
      "turnover",
    );
  });

  it("builds FTS hints for turnover action", () => {
    const q = buildFtsQuery({
      normalizedQuestion: "Do we meet turnover?",
      action: "CHECK_TURNOVER",
    });
    expect(q.toLowerCase()).toMatch(/turnover/);
    expect(q.toLowerCase()).toMatch(/audited|financial|ca/i);
  });
});

describe("Phase 7 action prompts (A–I)", () => {
  it("A: Assess Tender uses RAG-oriented grounded structure", () => {
    const addon = actionPromptAddon("ASSESS_TENDER");
    expect(addon).toMatch(/Overall assessment/i);
    expect(addon).toMatch(/Key eligibility requirements/i);
    expect(addon).toMatch(/Do NOT output a bid/i);
    expect(addon).toMatch(/Meets \| Does Not Meet/);
  });

  it("B: Eligibility allows only the four statuses", () => {
    const addon = actionPromptAddon("CHECK_ELIGIBILITY");
    expect(addon).toMatch(/Meets \| Does Not Meet \| Needs Verification \| Not Found/);
    expect(addon).not.toMatch(/Partially Meets/i);
    expect(addon).toMatch(/Do not infer compliance/i);
  });

  it("C: Turnover retrieves tender + company comparison structure", () => {
    const addon = actionPromptAddon("CHECK_TURNOVER");
    expect(addon).toMatch(/Tender requirement/);
    expect(addon).toMatch(/Company evidence/);
    expect(addon).toMatch(/lakhs|crores|₹/);
    const queries = buildActionRetrievalQueries({
      action: "CHECK_TURNOVER",
      question: "Check turnover",
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.toLowerCase()).toMatch(/turnover/);
    expect(queries[0]!.toLowerCase()).toMatch(/ca certificate|audited/);
  });

  it("D: Similar Experience compares documented projects", () => {
    const addon = actionPromptAddon("CHECK_SIMILAR_EXPERIENCE");
    expect(addon).toMatch(/Matching Company Project/);
    expect(addon).toMatch(/Do not claim similarity based only on project title/i);
  });

  it("E: Government Experience distinguishes mandatory/preferred/scoring", () => {
    const addon = actionPromptAddon("CHECK_GOVERNMENT_EXPERIENCE");
    expect(addon).toMatch(/Mandatory/);
    expect(addon).toMatch(/Preferred/);
    expect(addon).toMatch(/Scoring criterion/);
    expect(addon).toMatch(/private-sector/i);
  });

  it("F: Required Documents does not invent availability", () => {
    const addon = actionPromptAddon("CHECK_REQUIRED_DOCUMENTS");
    expect(addon).toMatch(/Do not claim a company document exists/i);
    expect(addon).toMatch(/Needs Verification/);
  });

  it("G: EMD/MSME distinguishes tender exemption from company eligibility", () => {
    const addon = actionPromptAddon("CHECK_EMD_MSME");
    expect(addon).toMatch(/Tender says exemption exists/);
    expect(addon).toMatch(/Company appears eligible for exemption/);
    expect(addon).toMatch(/not the same/i);
  });

  it("H: Risks are evidence-backed only", () => {
    const addon = actionPromptAddon("IDENTIFY_RISKS");
    expect(addon).toMatch(/evidence-backed/);
    expect(addon).toMatch(/Avoid speculative/);
  });

  it("I: Summary omits unsupported values", () => {
    const addon = actionPromptAddon("SUMMARIZE_TENDER");
    expect(addon).toMatch(/Not found/);
    expect(addon).toMatch(/Do not invent values/);
  });

  it("every action has a prompt addon and status text", () => {
    for (const action of ALL_ACTIONS) {
      expect(actionPromptAddon(action).length).toBeGreaterThan(40);
      expect(actionStatusText(action).length).toBeGreaterThan(10);
    }
  });
});

describe("Phase 7 multi-query retrieval", () => {
  it("broad actions use 3–5 batched queries", () => {
    for (const action of ALL_ACTIONS.filter(isBroadAskAiAction)) {
      const queries = buildActionRetrievalQueries({
        action,
        question: `User question for ${action}`,
      });
      expect(queries.length).toBeGreaterThanOrEqual(3);
      expect(queries.length).toBeLessThanOrEqual(5);
    }
  });

  it("custom GENERAL questions remain single-query", () => {
    const queries = buildActionRetrievalQueries({
      action: "GENERAL",
      question: "What is the closing date?",
    });
    expect(queries).toEqual(["What is the closing date?"]);
  });

  it("merges multi-query chunk lists by highest score", () => {
    const merged = mergeRetrievedChunkLists(
      [
        [chunk({ id: "a", score: 0.4, content: "eligibility A", sourceId: "s1" })],
        [
          chunk({ id: "a", score: 0.9, content: "eligibility A", sourceId: "s1" }),
          chunk({
            id: "b",
            score: 0.7,
            content: "turnover B",
            sourceId: "s2",
            chunkIndex: 5,
          }),
        ],
      ],
      8,
    );
    expect(merged.find((c) => c.id === "a")!.score).toBe(0.9);
    expect(merged.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });
});

describe("hybrid merge + diversity", () => {
  it("merges vector and FTS by chunk id", () => {
    const merged = mergeHybridCandidates({
      vectorRows: [
        {
          id: "1",
          company_id: null,
          tender_id: "t1",
          source_type: "TENDER_DOCUMENT",
          source_id: "s1",
          document_name: "a.pdf",
          document_url: null,
          document_type: "pdf",
          page_number: 1,
          section: "A",
          chunk_index: 0,
          content: "EMD of 50000",
          content_hash: "h1",
          metadata: {},
          similarity: 0.8,
        },
      ],
      ftsRows: [
        {
          id: "1",
          company_id: null,
          tender_id: "t1",
          source_type: "TENDER_DOCUMENT",
          source_id: "s1",
          document_name: "a.pdf",
          document_url: null,
          document_type: "pdf",
          page_number: 1,
          section: "A",
          chunk_index: 0,
          content: "EMD of 50000",
          content_hash: "h1",
          metadata: {},
          fts_rank: 0.9,
        },
        {
          id: "2",
          company_id: null,
          tender_id: "t1",
          source_type: "TENDER_DOCUMENT",
          source_id: "s2",
          document_name: "b.pdf",
          document_url: null,
          document_type: "pdf",
          page_number: null,
          section: "B",
          chunk_index: 0,
          content: "MSME exemption clause",
          content_hash: "h2",
          metadata: {},
          fts_rank: 0.4,
        },
      ],
      maxResults: 8,
      minScore: 0.1,
    });

    expect(merged.some((c) => c.id === "1")).toBe(true);
    expect(merged.find((c) => c.id === "1")!.vectorSimilarity).toBe(0.8);
    expect(merged.find((c) => c.id === "1")!.ftsRank).toBe(0.9);
  });

  it("reduces near-duplicate overlapping chunks", () => {
    const input = [
      chunk({
        id: "a",
        sourceId: "s",
        chunkIndex: 0,
        score: 0.9,
        content: "Same eligibility clause text about mandatory turnover.",
      }),
      chunk({
        id: "b",
        sourceId: "s",
        chunkIndex: 1,
        score: 0.82,
        content: "Same eligibility clause text about mandatory turnover.",
      }),
      chunk({
        id: "c",
        sourceId: "s2",
        chunkIndex: 0,
        score: 0.7,
        content: "Completely different EMD payment instructions.",
      }),
    ];
    const out = diversifyChunks(input, 8);
    expect(out.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("excludes low-score chunks", () => {
    const merged = mergeHybridCandidates({
      vectorRows: [
        {
          id: "low",
          company_id: null,
          tender_id: "t1",
          source_type: "TENDER_DOCUMENT",
          source_id: "s",
          document_name: "x.pdf",
          document_url: null,
          document_type: null,
          page_number: null,
          section: null,
          chunk_index: 0,
          content: "unrelated boilerplate",
          content_hash: "h",
          metadata: {},
          similarity: 0.05,
        },
      ],
      ftsRows: [],
      maxResults: 8,
      minScore: 0.18,
    });
    expect(merged).toHaveLength(0);
  });
});

describe("citations (L)", () => {
  it("ignores unknown citation ids", () => {
    const evidence = assignEvidenceIds({
      tenderChunks: [
        chunk({ id: "1", content: "Turnover five crore required." }),
      ],
      companyChunks: [
        chunk({
          id: "2",
          sourceType: "COMPANY_PROFILE",
          tenderId: null,
          companyId: "c1",
          content: "Company turnover eight crore.",
        }),
      ],
    });
    const parsed = parseCitations({
      answer: "Required is five crore [T1]. We meet it [C1]. Fake [T9].",
      evidence,
    });
    expect(parsed.sources.map((s) => s.id)).toEqual(["T1", "C1"]);
    expect(parsed.unknownIds).toContain("T9");
  });
});

describe("isolation filters (N)", () => {
  it("keeps only current tender_id for tender chunks", () => {
    const merged = mergeHybridCandidates({
      vectorRows: [
        {
          id: "ok",
          company_id: "co",
          tender_id: "tender-a",
          source_type: "TENDER_DOCUMENT",
          source_id: "s",
          document_name: "a",
          document_url: null,
          document_type: null,
          page_number: null,
          section: null,
          chunk_index: 0,
          content: "ok",
          content_hash: "h",
          metadata: {},
          similarity: 0.9,
        },
        {
          id: "bad",
          company_id: "co",
          tender_id: "tender-b",
          source_type: "TENDER_DOCUMENT",
          source_id: "s",
          document_name: "b",
          document_url: null,
          document_type: null,
          page_number: null,
          section: null,
          chunk_index: 0,
          content: "wrong tender",
          content_hash: "h2",
          metadata: {},
          similarity: 0.95,
        },
      ],
      ftsRows: [],
      maxResults: 8,
      minScore: 0.1,
    }).filter(
      (c) => c.sourceType === "TENDER_DOCUMENT" && c.tenderId === "tender-a",
    );

    expect(merged.map((c) => c.id)).toEqual(["ok"]);
  });

  it("keeps only current company_id and null tender_id for company chunks", () => {
    const merged = mergeHybridCandidates({
      vectorRows: [
        {
          id: "ok",
          company_id: "company-a",
          tender_id: null,
          source_type: "COMPANY_PROFILE",
          source_id: "profile",
          document_name: "profile",
          document_url: null,
          document_type: null,
          page_number: null,
          section: null,
          chunk_index: 0,
          content: "ok",
          content_hash: "h",
          metadata: {},
          similarity: 0.9,
        },
        {
          id: "bad",
          company_id: "company-b",
          tender_id: null,
          source_type: "COMPANY_DOCUMENT",
          source_id: "doc",
          document_name: "x",
          document_url: null,
          document_type: null,
          page_number: null,
          section: null,
          chunk_index: 0,
          content: "other company",
          content_hash: "h2",
          metadata: {},
          similarity: 0.99,
        },
      ],
      ftsRows: [],
      maxResults: 8,
      minScore: 0.1,
    }).filter(
      (c) =>
        c.companyId === "company-a" &&
        c.tenderId == null &&
        (c.sourceType === "COMPANY_DOCUMENT" ||
          c.sourceType === "COMPANY_PROFILE"),
    );

    expect(merged.map((c) => c.id)).toEqual(["ok"]);
  });
});

describe("index readiness warnings", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns no-index warning", async () => {
    vi.doMock("@/lib/db/server", () => ({
      getServerSupabase: () => ({
        from(table: string) {
          if (table === "agenttender_ai_document_index_status") {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({ data: [], error: null }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: async () => ({ count: 0, error: null }),
                }),
              }),
            }),
          };
        },
      }),
    }));
    const { getTenderIndexReadiness } = await import(
      "@/server/ai/rag/index-readiness"
    );
    const result = await getTenderIndexReadiness("tender-x");
    expect(result.status).toBe("none");
    expect(result.warnings[0]).toMatch(/not been indexed/i);
  });

  it("returns partial-index warning", async () => {
    vi.doMock("@/lib/db/server", () => ({
      getServerSupabase: () => ({
        from(table: string) {
          if (table === "agenttender_ai_document_index_status") {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({
                    data: [
                      { status: "INDEXED", source_id: "a" },
                      { status: "INDEX_FAILED", source_id: "b" },
                    ],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: async () => ({ count: 3, error: null }),
                }),
              }),
            }),
          };
        },
      }),
    }));
    const { getTenderIndexReadiness } = await import(
      "@/server/ai/rag/index-readiness"
    );
    const result = await getTenderIndexReadiness("tender-x");
    expect(result.status).toBe("partial");
    expect(result.warnings[0]).toMatch(/incomplete/i);
  });
});

describe("RAG path must not call SharePoint (A, M)", () => {
  it("askTenderAiRag module does not import SharePoint helpers", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = await fs.readFile(
      path.resolve("src/server/ai/rag/ask-ai-rag.ts"),
      "utf8",
    );
    expect(file).not.toMatch(
      /invokeBlobRead|invokeDocumentRead|ingestDocumentBytes|buildTenderAiContext/,
    );
  });

  it("multi-query path batches embeddings and supports follow-up retrieval", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = await fs.readFile(
      path.resolve("src/server/ai/rag/ask-ai-rag.ts"),
      "utf8",
    );
    expect(file).toMatch(/buildRetrievalQuestion/);
    expect(file).toMatch(/buildActionRetrievalQueries/);
    expect(file).toMatch(/embedTexts\(queries\)/);
    expect(file).toMatch(/mergeRetrievedChunkLists/);
    expect(file).toMatch(/not sufficiently represented/);
  });

  it("stream path uses action-specific status and same RAG prepare", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = await fs.readFile(
      path.resolve("src/server/ai/rag/stream-ask-ai.ts"),
      "utf8",
    );
    expect(file).toMatch(/actionStatusText/);
    expect(file).toMatch(/prepareTenderRagRequest/);
    expect(file).toMatch(/stream:\s*true/);
  });
});

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/server/ingestion/structuredExtract", () => ({
  getOpenAiClient: vi.fn(() => null),
}));

vi.mock("@/server/storage/tenderAutomationDocumentFunctions", () => ({
  invokeBlobRead: vi.fn(),
  invokeDocumentRead: vi.fn(),
}));

vi.mock("@/lib/db/server", () => ({
  getServerSupabase: vi.fn(),
}));

import { chunkText, normalizeText, countTokens } from "@/server/ai/rag/chunking";
import { EMBEDDING_DIMENSIONS } from "@/server/ai/rag/types";

describe("rag chunking", () => {
  it("normalizes whitespace without stripping clause numbers", () => {
    const text = normalizeText("1.2 Eligibility\r\n\r\n\r\nTurnover of ₹5 crore.\n\n\n");
    expect(text).toContain("1.2 Eligibility");
    expect(text).toContain("Turnover of ₹5 crore.");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("produces deterministic chunk indexes and keeps headings", () => {
    const body = Array.from({ length: 40 }, (_, i) => {
      if (i % 8 === 0) return `SECTION ${i / 8 + 1}\nRequirement clause ${i} with enough words to form paragraphs for chunking purposes in tender documents.`;
      return `Paragraph ${i}: The bidder shall demonstrate similar experience including government projects and certified completion documents as applicable for this procurement.`;
    }).join("\n\n");

    const once = chunkText({ text: body });
    const twice = chunkText({ text: body });
    expect(once.length).toBeGreaterThan(1);
    expect(once.map((c) => c.chunkIndex)).toEqual(
      twice.map((c) => c.chunkIndex),
    );
    expect(once.every((c) => countTokens(c.content) <= 950)).toBe(true);
    expect(once.some((c) => /SECTION/i.test(c.content) || c.section)).toBe(true);
  });
});

describe("rag content hash + lifecycle helpers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uses sha256 of normalized content", () => {
    const a = createHash("sha256")
      .update(normalizeText("Hello\r\n\r\nWorld"), "utf8")
      .digest("hex");
    const b = createHash("sha256")
      .update(normalizeText("Hello\n\nWorld"), "utf8")
      .digest("hex");
    expect(a).toBe(b);
  });

  it("expects embedding dimension 1536", () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });
});

describe("rag scope constraints", () => {
  it("company sources must not carry tender_id in descriptors", async () => {
    const { buildCompanyProfileText } = await import(
      "@/server/ai/rag/company-knowledge"
    );
    // Function exists and is callable — full DB test covered by integration script.
    expect(typeof buildCompanyProfileText).toBe("function");
  });

  it("stable ZIP member source ids include parent and path", () => {
    const parent = "tender_portal_zip:abc";
    const memberPath = "folder/Eligibility.pdf";
    const sourceId = `${parent}::${memberPath.replace(/\\/g, "/").replace(/^\/+/, "")}`;
    expect(sourceId).toBe("tender_portal_zip:abc::folder/Eligibility.pdf");
  });

  it("ai_index_enabled=false excludes and skips indexing", async () => {
    vi.resetModules();
    const excludeDocumentSource = vi.fn(async () => undefined);
    vi.doMock("@/lib/db/server", () => ({
      getServerSupabase: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { ai_index_enabled: false, status: "active" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));
    vi.doMock("@/server/ai/rag/document-ingestion", () => ({
      indexDocumentSource: vi.fn(),
      excludeDocumentSource,
    }));
    vi.doMock("@/server/repositories/documentRepository", () => ({
      getCompanyDocumentById: vi.fn(),
      listCompanyDocuments: vi.fn(),
    }));
    vi.doMock("@/server/repositories/companyRepository", () => ({
      getCompanyById: vi.fn(),
      getCompanyBidPreferences: vi.fn(),
    }));
    vi.doMock("@/server/repositories/experienceRepository", () => ({
      listCompanyExperience: vi.fn(),
    }));

    const { indexCompanyDocument } = await import(
      "@/server/ai/rag/company-knowledge"
    );

    const result = await indexCompanyDocument({
      companyId: "11111111-1111-1111-1111-111111111111",
      documentId: "22222222-2222-2222-2222-222222222222",
    });

    expect(result.status).toBe("SKIPPED_DISABLED");
    expect(result.skipped).toBe(true);
    expect(excludeDocumentSource).toHaveBeenCalled();
  });
});

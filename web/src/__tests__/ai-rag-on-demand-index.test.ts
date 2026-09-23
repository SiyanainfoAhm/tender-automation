import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const readinessState = {
  status: "none" as "none" | "ready" | "partial",
  activeChunkCount: 0,
  indexedSources: 0,
  failedSources: 0,
  pendingSources: 0,
  warnings: [] as string[],
};

vi.mock("@/server/ai/rag/index-readiness", () => ({
  getTenderIndexReadiness: vi.fn(async () => ({ ...readinessState })),
}));

vi.mock("@/server/ai/rag/tender-knowledge", () => ({
  buildTenderSourceDescriptors: vi.fn(async () => [
    { sourceId: "doc-1", sourceType: "TENDER_DOCUMENT" },
  ]),
  indexTenderKnowledge: vi.fn(async () => [
    { status: "INDEXED", chunkCount: 3, sourceId: "doc-1" },
  ]),
}));

vi.mock("@/server/ai/rag/schedule-index", () => ({
  scheduleAiIndexing: vi.fn((_task: () => Promise<unknown>) => {
    // Leave the task pending so inflight dedupe can be asserted.
  }),
}));

vi.mock("@/lib/db/server", () => ({
  getServerSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

describe("on-demand tender indexing", () => {
  beforeEach(async () => {
    readinessState.status = "none";
    readinessState.activeChunkCount = 0;
    readinessState.indexedSources = 0;
    readinessState.failedSources = 0;
    readinessState.pendingSources = 0;
    const mod = await import("@/server/ai/rag/on-demand-tender-index");
    mod.__resetOnDemandTenderIndexForTests();
    vi.clearAllMocks();
  });

  it("starts indexing once and dedupes concurrent starts", async () => {
    const {
      ensureOnDemandTenderIndexing,
      __getOnDemandInflightForTests,
    } = await import("@/server/ai/rag/on-demand-tender-index");
    const { scheduleAiIndexing } = await import(
      "@/server/ai/rag/schedule-index"
    );

    const first = await ensureOnDemandTenderIndexing({
      tenderId: "t1",
      companyId: "c1",
    });
    const second = await ensureOnDemandTenderIndexing({
      tenderId: "t1",
      companyId: "c1",
    });

    expect(first.outcome).toBe("started");
    expect(second.outcome).toBe("already_running");
    expect(scheduleAiIndexing).toHaveBeenCalledTimes(1);
    expect(__getOnDemandInflightForTests("t1")).toBe(true);
  });

  it("returns ready when chunks already exist", async () => {
    readinessState.status = "ready";
    readinessState.activeChunkCount = 4;
    readinessState.indexedSources = 1;
    const { ensureOnDemandTenderIndexing } = await import(
      "@/server/ai/rag/on-demand-tender-index"
    );
    const result = await ensureOnDemandTenderIndexing({
      tenderId: "t2",
      companyId: "c1",
    });
    expect(result.outcome).toBe("ready");
  });

  it("returns no_sources when tender has nothing to index", async () => {
    const tenderKnowledge = await import("@/server/ai/rag/tender-knowledge");
    vi.mocked(tenderKnowledge.buildTenderSourceDescriptors).mockResolvedValueOnce(
      [],
    );
    const { ensureOnDemandTenderIndexing } = await import(
      "@/server/ai/rag/on-demand-tender-index"
    );
    const result = await ensureOnDemandTenderIndexing({
      tenderId: "t3",
      companyId: "c1",
    });
    expect(result.outcome).toBe("no_sources");
  });
});

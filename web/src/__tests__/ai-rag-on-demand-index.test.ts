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

const jobStore = new Map<string, Record<string, unknown>>();
const statusRows: Array<Record<string, unknown>> = [];

vi.mock("@/server/ai/rag/index-readiness", () => ({
  getTenderIndexReadiness: vi.fn(async () => ({ ...readinessState })),
}));

vi.mock("@/server/ai/rag/tender-knowledge", () => ({
  buildTenderSourceDescriptors: vi.fn(async () => [
    {
      sourceId: "doc-1",
      sourceType: "TENDER_DOCUMENT",
      companyId: "c1",
      tenderId: "t1",
      documentName: "RFP.pdf",
      documentUrl: "https://example.sharepoint.com/rfp.pdf",
    },
  ]),
  indexTenderKnowledge: vi.fn(async () => [
    { status: "INDEXED", chunkCount: 3, sourceId: "doc-1" },
  ]),
}));

vi.mock("@/server/ai/rag/schedule-index", () => ({
  scheduleAiIndexing: vi.fn((_task: () => Promise<unknown>) => {
    // Leave pending — durable DB state must already be visible to poll.
  }),
}));

vi.mock("@/server/ai/rag/index-status-repository", () => ({
  upsertIndexStatus: vi.fn(async (row: Record<string, unknown>) => {
    statusRows.push(row);
  }),
  getIndexStatus: vi.fn(async () => null),
}));

vi.mock("@/lib/db/server", () => ({
  getServerSupabase: () => ({
    from(table: string) {
      if (table === "agenttender_ai_tender_index_jobs") {
        return {
          select: () => ({
            eq: (_col: string, tenderId: string) => ({
              maybeSingle: async () => ({
                data: jobStore.get(String(tenderId)) || null,
                error: null,
              }),
            }),
          }),
          upsert: async (payload: Record<string, unknown>) => {
            const id = String(payload.tender_id);
            jobStore.set(id, {
              ...(jobStore.get(id) || {}),
              ...payload,
              updated_at: new Date().toISOString(),
              requested_at:
                payload.requested_at ||
                jobStore.get(id)?.requested_at ||
                new Date().toISOString(),
            });
            return { error: null };
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

describe("on-demand tender indexing (durable jobs)", () => {
  beforeEach(() => {
    readinessState.status = "none";
    readinessState.activeChunkCount = 0;
    readinessState.indexedSources = 0;
    readinessState.failedSources = 0;
    readinessState.pendingSources = 0;
    jobStore.clear();
    statusRows.length = 0;
    vi.clearAllMocks();
  });

  it("persists INDEXING job before schedule and poll reads Postgres", async () => {
    const {
      ensureOnDemandTenderIndexing,
      pollOnDemandTenderIndex,
    } = await import("@/server/ai/rag/on-demand-tender-index");
    const { scheduleAiIndexing } = await import(
      "@/server/ai/rag/schedule-index"
    );

    const first = await ensureOnDemandTenderIndexing({
      tenderId: "t1",
      companyId: "c1",
    });
    expect(first.outcome).toBe("started");
    expect(scheduleAiIndexing).toHaveBeenCalledTimes(1);
    expect(jobStore.get("t1")?.status).toBe("INDEXING");
    expect(statusRows.some((r) => r.status === "INDEXING")).toBe(true);

    const poll = await pollOnDemandTenderIndex("t1");
    expect(poll.state).toBe("indexing");
    expect(poll.inflight).toBe(true);
    expect(poll.jobStatus).toBe("INDEXING");

    const second = await ensureOnDemandTenderIndexing({
      tenderId: "t1",
      companyId: "c1",
    });
    expect(second.outcome).toBe("already_running");
    expect(scheduleAiIndexing).toHaveBeenCalledTimes(1);
  });

  it("returns ready when chunks already exist", async () => {
    readinessState.status = "ready";
    readinessState.activeChunkCount = 4;
    readinessState.indexedSources = 1;
    const { ensureOnDemandTenderIndexing, pollOnDemandTenderIndex } =
      await import("@/server/ai/rag/on-demand-tender-index");
    const result = await ensureOnDemandTenderIndexing({
      tenderId: "t2",
      companyId: "c1",
    });
    expect(result.outcome).toBe("ready");
    const poll = await pollOnDemandTenderIndex("t2");
    expect(poll.state).toBe("ready");
  });

  it("returns no_documents when tender has nothing to index", async () => {
    const tenderKnowledge = await import("@/server/ai/rag/tender-knowledge");
    vi.mocked(tenderKnowledge.buildTenderSourceDescriptors).mockResolvedValueOnce(
      [],
    );
    const { ensureOnDemandTenderIndexing, pollOnDemandTenderIndex } =
      await import("@/server/ai/rag/on-demand-tender-index");
    const result = await ensureOnDemandTenderIndexing({
      tenderId: "t3",
      companyId: "c1",
    });
    expect(result.outcome).toBe("no_sources");
    expect(jobStore.get("t3")?.status).toBe("NO_DOCUMENTS");
    const poll = await pollOnDemandTenderIndex("t3");
    expect(poll.state).toBe("no_documents");
  });
});

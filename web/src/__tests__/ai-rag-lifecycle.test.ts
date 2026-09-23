import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const statusStore = new Map<string, Record<string, unknown>>();
const chunkStore: Array<Record<string, unknown>> = [];

function statusKey(sourceType: string, sourceId: string) {
  return `${sourceType}::${sourceId}`;
}

function createStatusQuery() {
  const filters: Record<string, unknown> = {};
  const api: {
    eq: (col: string, value: unknown) => typeof api;
    maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: null }>;
  } = {
    eq(col: string, value: unknown) {
      filters[col] = value;
      return api;
    },
    async maybeSingle() {
      const key = statusKey(
        String(filters.source_type || ""),
        String(filters.source_id || ""),
      );
      return { data: statusStore.get(key) || null, error: null };
    },
  };
  return api;
}

vi.mock("@/lib/db/server", () => ({
  getServerSupabase: () => ({
    from(table: string) {
      if (table === "agenttender_ai_document_index_status") {
        return {
          select: () => createStatusQuery(),
          async insert(payload: Record<string, unknown>) {
            const id = `status-${statusStore.size + 1}`;
            const key = statusKey(
              String(payload.source_type),
              String(payload.source_id),
            );
            statusStore.set(key, { id, ...payload });
            return { error: null };
          },
          update(payload: Record<string, unknown>) {
            return {
              async eq(_col: string, id: string) {
                for (const [k, row] of statusStore) {
                  if (row.id === id) statusStore.set(k, { ...row, ...payload });
                }
                return { error: null };
              },
            };
          },
        };
      }

      if (table === "agenttender_ai_document_chunks") {
        return {
          async insert(
            rows: Record<string, unknown>[] | Record<string, unknown>,
          ) {
            const list = Array.isArray(rows) ? rows : [rows];
            for (const row of list) {
              chunkStore.push({ ...row, id: `c-${chunkStore.length + 1}` });
            }
            return { error: null };
          },
          update(payload: Record<string, unknown>) {
            const filters: Record<string, unknown> = {};
            const apply = () => {
              let matched = 0;
              for (const row of chunkStore) {
                if (
                  filters.source_type &&
                  row.source_type !== filters.source_type
                ) {
                  continue;
                }
                if (
                  filters.source_id &&
                  row.source_id !== filters.source_id
                ) {
                  continue;
                }
                if (
                  filters.is_active != null &&
                  row.is_active !== filters.is_active
                ) {
                  continue;
                }
                if (
                  filters["neq:content_hash"] != null &&
                  row.content_hash === filters["neq:content_hash"]
                ) {
                  continue;
                }
                Object.assign(row, payload);
                matched += 1;
              }
              return {
                data: Array.from({ length: matched }, (_, i) => ({
                  id: String(i),
                })),
                error: null,
              };
            };
            const api: {
              eq: (col: string, value: unknown) => typeof api;
              neq: (col: string, value: unknown) => typeof api;
              select: () => Promise<ReturnType<typeof apply>>;
              then: (
                onFulfilled?: (value: ReturnType<typeof apply>) => unknown,
                onRejected?: (reason: unknown) => unknown,
              ) => Promise<unknown>;
            } = {
              eq(col: string, value: unknown) {
                filters[col] = value;
                return api;
              },
              neq(col: string, value: unknown) {
                filters[`neq:${col}`] = value;
                return api;
              },
              async select() {
                return apply();
              },
              then(onFulfilled, onRejected) {
                return Promise.resolve(apply()).then(onFulfilled, onRejected);
              },
            };
            return api;
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/server/ai/rag/embeddings", () => ({
  embedTexts: vi.fn(async (texts: string[]) => ({
    embeddings: texts.map(() =>
      Array.from({ length: 1536 }, (_, i) => i / 1536),
    ),
    model: "text-embedding-3-small",
  })),
}));

import { indexDocumentSource } from "@/server/ai/rag/document-ingestion";

describe("indexDocumentSource lifecycle", () => {
  beforeEach(() => {
    statusStore.clear();
    chunkStore.length = 0;
  });

  it("indexes profile text and skips unchanged second run", async () => {
    const descriptor = {
      sourceType: "COMPANY_PROFILE" as const,
      sourceId: "company_profile:test",
      companyId: "11111111-1111-1111-1111-111111111111",
      tenderId: null,
      documentName: "Company Profile",
      documentUrl: null,
      documentType: "profile",
      section: "company_profile",
      fetch: {
        kind: "profile_text" as const,
        text: "Company Profile: Acme\nTurnover evidence and government experience summary for eligibility.",
      },
    };

    const first = await indexDocumentSource(descriptor);
    expect(first.status).toBe("INDEXED");
    expect(first.chunkCount).toBeGreaterThan(0);
    expect(first.skipped).toBe(false);

    const activeAfterFirst = chunkStore.filter((row) => row.is_active);
    expect(activeAfterFirst.length).toBe(first.chunkCount);

    const second = await indexDocumentSource(descriptor);
    expect(second.status).toBe("SKIPPED_UNCHANGED");
    expect(second.skipped).toBe(true);
    expect(chunkStore.filter((row) => row.is_active).length).toBe(
      activeAfterFirst.length,
    );
  });

  it("replaces active chunks only after successful reindex of changed content", async () => {
    const companyId = "11111111-1111-1111-1111-111111111111";
    const base = {
      sourceType: "COMPANY_PROFILE" as const,
      sourceId: "company_profile:change",
      companyId,
      tenderId: null,
      documentName: "Company Profile",
      documentUrl: null,
      documentType: "profile",
      section: "company_profile",
    };

    const first = await indexDocumentSource({
      ...base,
      fetch: {
        kind: "profile_text",
        text: "Version one of the company profile with certifications and manpower details.",
      },
    });
    const firstHash = first.contentHash;
    expect(firstHash).toBeTruthy();

    const second = await indexDocumentSource({
      ...base,
      fetch: {
        kind: "profile_text",
        text: "Version two of the company profile with updated turnover and government experience evidence.",
      },
    });
    expect(second.status).toBe("INDEXED");
    expect(second.contentHash).not.toBe(firstHash);

    const active = chunkStore.filter(
      (row) => row.is_active && row.source_id === base.sourceId,
    );
    expect(active.every((row) => row.content_hash === second.contentHash)).toBe(
      true,
    );
    expect(
      chunkStore.some(
        (row) =>
          row.source_id === base.sourceId &&
          row.content_hash === firstHash &&
          row.is_active === false,
      ),
    ).toBe(true);
  });

  it("forced reindex with unchanged content restores INDEXED without duplicate errors", async () => {
    const descriptor = {
      sourceType: "COMPANY_PROFILE" as const,
      sourceId: "company_profile:force-reindex",
      companyId: "11111111-1111-1111-1111-111111111111",
      tenderId: null,
      documentName: "Company Profile",
      documentUrl: null,
      documentType: "profile",
      section: "company_profile",
      fetch: {
        kind: "profile_text" as const,
        text: "Stable company profile text used for forced reindex acceptance.",
      },
    };

    const first = await indexDocumentSource(descriptor);
    expect(first.status).toBe("INDEXED");

    // Simulate operator marking NEEDS_REINDEX while content is unchanged.
    const key = `COMPANY_PROFILE::${descriptor.sourceId}`;
    const row = statusStore.get(key);
    expect(row).toBeTruthy();
    statusStore.set(key, { ...row!, status: "NEEDS_REINDEX" });

    const second = await indexDocumentSource(descriptor);
    expect(second.status).toBe("SKIPPED_UNCHANGED");
    expect(second.skipped).toBe(true);
    expect(statusStore.get(key)?.status).toBe("INDEXED");
    expect(
      chunkStore.filter((c) => c.source_id === descriptor.sourceId && c.is_active)
        .length,
    ).toBe(first.chunkCount);
  });

  it("keeps previous active chunks when embedding fails", async () => {
    const { embedTexts } = await import("@/server/ai/rag/embeddings");
    const mocked = vi.mocked(embedTexts);

    const descriptor = {
      sourceType: "COMPANY_PROFILE" as const,
      sourceId: "company_profile:fail",
      companyId: "11111111-1111-1111-1111-111111111111",
      tenderId: null,
      documentName: "Company Profile",
      documentUrl: null,
      documentType: "profile",
      section: "company_profile",
      fetch: {
        kind: "profile_text" as const,
        text: "Stable company profile content used before a simulated embedding failure.",
      },
    };

    const first = await indexDocumentSource(descriptor);
    expect(first.status).toBe("INDEXED");
    const activeBefore = chunkStore.filter(
      (row) => row.is_active && row.source_id === descriptor.sourceId,
    ).length;

    mocked.mockRejectedValueOnce(new Error("rate limit"));
    const failed = await indexDocumentSource({
      ...descriptor,
      fetch: {
        kind: "profile_text",
        text: "Changed company profile content that should fail during embedding.",
      },
    });
    expect(failed.status).toBe("INDEX_FAILED");
    expect(
      chunkStore.filter(
        (row) => row.is_active && row.source_id === descriptor.sourceId,
      ).length,
    ).toBe(activeBefore);
  });
});

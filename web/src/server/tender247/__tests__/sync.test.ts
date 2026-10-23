import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/adminClient", () => ({ createAdminSupabaseClient: vi.fn(), createTender247MirrorSupabaseClient: vi.fn() }));

import { createAdminSupabaseClient, createTender247MirrorSupabaseClient } from "@/lib/db/adminClient";
import { indiaYesterdayIsoDate, mapTender, mirrorTenderPayload, processSavedTender247Response, responseTenders, tender247CanonicalIdentity, tender247Manifest, TENDER_TARGET_TABLE, TENDER247_TENDER_MIRROR_TABLE, upstreamResponseCanBeProcessed, uploadTender247Document } from "../sync";

describe("Tender247 explicit sync", () => {
  it("uses calendar yesterday in IST across UTC, month, and year boundaries", () => {
    // Oct 11 00:01 IST is still Oct 10 UTC; yesterday must be Oct 10, not Friday Oct 9.
    expect(indiaYesterdayIsoDate(new Date("2026-10-10T18:31:00.000Z"))).toBe("2026-10-10");
    expect(indiaYesterdayIsoDate(new Date("2026-03-01T00:01:00.000Z"))).toBe("2026-02-28");
    expect(indiaYesterdayIsoDate(new Date("2027-01-01T00:01:00.000Z"))).toBe("2026-12-31");
    // Just before IST midnight the India date has not changed, even when UTC has.
    expect(indiaYesterdayIsoDate(new Date("2026-10-10T18:29:59.000Z"))).toBe("2026-10-09");
  });

  it("maps Tender247 tenderid/sourceTenderId into the canonical source identifier", () => {
    expect(TENDER_TARGET_TABLE).toBe("agenttender_tenders");
    expect(mapTender({ tenderid: "T247-101", sourceTenderId: "T247-202" }, "2026-10-08"))
      .toMatchObject({ source_portal: "TENDER247", source_tender_id: "T247-101", raw_metadata: { tender247_source_tender_id: "T247-202" } });
  });

  it("uses tenderid exclusively as canonical identity and keeps sourcetenderid as optional mirror metadata", () => {
    const source = { tenderid: 101074816, sourcetenderid: "2026_NTPC_108948_1" };
    expect(mapTender(source, "2026-10-08")).toMatchObject({ source_tender_id: "101074816", raw_metadata: { tender247_source_tender_id: "2026_NTPC_108948_1" } });
    expect(mirrorTenderPayload(source, "canonical-uuid", "2026-10-08")).toMatchObject({ canonical_tender_id: "canonical-uuid", tender247_tender_id: "101074816", source_tender_id: "2026_NTPC_108948_1" });
    expect(mirrorTenderPayload({ tenderid: 123456, sourcetenderid: "" }, "canonical-uuid", "2026-10-08")).toMatchObject({ tender247_tender_id: "123456", source_tender_id: null });
    expect(mapTender({ sourcetenderid: "ABC" }, "2026-10-08")).toBeNull();
    expect(mirrorTenderPayload({ sourcetenderid: "ABC" }, "canonical-uuid", "2026-10-08")).toBeNull();
  });

  it("maps production lower-case API fields and defaults new rows to VERIFY", () => {
    expect(mapTender({
      tenderid: 105068326, value: 51860, emd: 1037, currency: "INR",
      tenderdescription: "Shifting of EA set", biddeadline: "2026-10-22",
      datecreated: "2026-10-08", sourceurl: "https://example.test/tender",
      location: [{ city: "Thanjavur", state: "Tamil Nadu", country: "India" }],
    }, "2026-10-08")).toMatchObject({
      source_tender_id: "105068326", title: "Shifting of EA set",
      description: "Shifting of EA set", city: "Thanjavur", state: "Tamil Nadu",
      location_text: "Thanjavur, Tamil Nadu, India", tender_value: 51860,
      emd_amount: 1037, bid_submission_date: "2026-10-22",
      published_date: "2026-10-08", source_url: "https://example.test/tender",
      qualification_status: "VERIFY",
    });
  });

  it("normalizes a gateway document manifest and rejects malformed non-empty responses", async () => {
    const previousEndpoint = process.env.TENDER247_SYNC_ENDPOINT; const previousSecret = process.env.TENDER247_SYNC_UPSTREAM_SECRET;
    process.env.TENDER247_SYNC_ENDPOINT = "https://gateway.example/api/tender247/tenders"; process.env.TENDER247_SYNC_UPSTREAM_SECRET = "test";
    const tender = { zipdocumentdownload: "https://partnersdataapi.tender247.com/T247Data/api/partner-document-download-links/abcdefgh" };
    const goodFetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ documentid: "111", filename: "Tender.pdf", contentType: "application/pdf", token: "abcdefgh", size: 10 }] }), { status: 200 })) as typeof fetch;
    await expect(tender247Manifest(tender, goodFetch)).resolves.toEqual([{ documentid: "111", filename: "Tender.pdf", contentType: "application/pdf", token: "abcdefgh", size: 10 }]);
    const malformed = vi.fn(async () => new Response(JSON.stringify({ data: { documentid: "111" } }), { status: 200 })) as typeof fetch;
    await expect(tender247Manifest(tender, malformed)).rejects.toThrow("invalid manifest");
    const empty = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch;
    await expect(tender247Manifest(tender, empty)).resolves.toEqual([]);
    const reportedButUnusable = vi.fn(async () => new Response(JSON.stringify({ status: "success", count: 2, data: [{ documentid: "111" }, { filename: "Tender.pdf" }] }), { status: 200 })) as typeof fetch;
    await expect(tender247Manifest(tender, reportedButUnusable)).rejects.toThrow("MANIFEST_NORMALIZATION_FAILED reportedCount=2 normalizedCount=0");
    process.env.TENDER247_SYNC_ENDPOINT = previousEndpoint; process.env.TENDER247_SYNC_UPSTREAM_SECRET = previousSecret;
  });

  it("consumes the production gateway data envelope and preserves two upload-ready documents", async () => {
    const previousEndpoint = process.env.TENDER247_SYNC_ENDPOINT; const previousSecret = process.env.TENDER247_SYNC_UPSTREAM_SECRET;
    process.env.TENDER247_SYNC_ENDPOINT = "https://gateway.example/api/tender247/tenders"; process.env.TENDER247_SYNC_UPSTREAM_SECRET = "test";
    const tender = { tenderid: 101074816, sourcetenderid: "2026_NTPC_108948_1", zipdocumentdownload: "https://partnersdataapi.tender247.com/T247Data/api/partner-document-download-links/ABC12345" };
    const gateway = vi.fn(async () => new Response(JSON.stringify({ status: "success", count: 2, data: [
      { documentid: "DOC_TOKEN_1", filename: "EOI Dt 23 09 2026.pdf", contentType: "application/pdf", token: "DOC_TOKEN_1", size: null },
      { documentid: "DOC_TOKEN_2", filename: "APEPDCL Tender Document.pdf", contentType: "application/pdf", token: "DOC_TOKEN_2", size: null },
    ] }), { status: 200 })) as typeof fetch;
    await expect(tender247Manifest(tender, gateway)).resolves.toEqual([
      { documentid: "DOC_TOKEN_1", filename: "EOI Dt 23 09 2026.pdf", contentType: "application/pdf", token: "DOC_TOKEN_1", size: null },
      { documentid: "DOC_TOKEN_2", filename: "APEPDCL Tender Document.pdf", contentType: "application/pdf", token: "DOC_TOKEN_2", size: null },
    ]);
    process.env.TENDER247_SYNC_ENDPOINT = previousEndpoint; process.env.TENDER247_SYNC_UPSTREAM_SECRET = previousSecret;
  });

  it("normalizes production PascalCase Data and legacy lowercase data arrays", () => {
    const production = { Data: [{ tenderid: "T247-1" }, { tenderid: "T247-2" }], Message: "Success", Success: true, StatusCode: 200, TotalRecord: 2 };
    expect(responseTenders(production)).toHaveLength(2);
    expect(responseTenders({ data: [{ tenderid: "legacy-1" }] })).toHaveLength(1);
    expect(upstreamResponseCanBeProcessed(production)).toBe(true);
    expect(upstreamResponseCanBeProcessed({ Data: [] })).toBe(true);
  });

  it("updates one stable Tender247 canonical identity across scrape dates", () => {
    const runOne = tender247CanonicalIdentity({ tenderid: "105006964" });
    const runTwo = tender247CanonicalIdentity({ tenderid: "105006964" });
    expect(runOne).toEqual(runTwo);
    // The DB lookup deliberately excludes scraped_date; the existing row is
    // updated, including its latest scraped_date, instead of inserted again.
    expect(runTwo).toEqual({ sourcePortal: "TENDER247", sourceRegion: "INDIAN", sourceTenderId: "105006964" });
  });

  it("repairs one proven legacy sourcetenderid row in place without changing workflow fields", async () => {
    const legacyId = "7b6e29c5-348e-48e2-9b28-bdb8202e5b55";
    const legacySourceId = "2026_NTPC_108948_1";
    const legacy = {
      id: legacyId, source_portal: "TENDER247", source_region: "INDIA", source_tender_id: legacySourceId,
      raw_metadata: { tender247_sync: { tenderid: 101074816, sourcetenderid: legacySourceId }, notes: "retain operator notes" }, document_urls: [],
      // These columns are on agenttender_tenders. Assignment/submission and
      // result stage are intentionally separate related tables in the schema.
      qualification_status: "VERIFY", prescreen_status: "MAY_BID", decision_source: "manual",
    } as Record<string, unknown>;
    const canonicalRows = new Map([[legacySourceId, legacy]]);
    const bidWorkspace = { tender_id: legacyId, submission_status: "submitted", submitted_by: "user-1", submission_notes: "retain submitted state" };
    const tenderResult = { tender_id: legacyId, result_stage: "AWAITING_RESULT", source: "BIDASSIST" };
    const mirrorRows = new Map<string, Record<string, unknown>>();
    const canonicalDb = {
      from(table: string) {
        expect(table).toBe(TENDER_TARGET_TABLE);
        const filters: Record<string, unknown> = {};
        let limitCount = 0;
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => { filters[key] = value; return query; },
          order: () => query,
          limit: (count: number) => { limitCount = count; return query; },
          then: (resolve: (value: unknown) => unknown) => resolve({ data: limitCount === 2 && filters.source_tender_id === legacySourceId ? [legacy] : [], error: null }),
          maybeSingle: async () => {
            const id = String(filters.source_tender_id || "");
            if (id === legacySourceId && limitCount === 2) return { data: [legacy], error: null };
            return { data: canonicalRows.get(id) || null, error: null };
          },
          insert: vi.fn((payload: Record<string, unknown>) => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) })),
          update: (patch: Record<string, unknown>) => ({ eq: (_key: string, id: string) => ({ select: () => ({ maybeSingle: async () => {
            expect(id).toBe(legacyId); Object.assign(legacy, patch); canonicalRows.delete(legacySourceId); canonicalRows.set(String(legacy.source_tender_id), legacy);
            return { data: legacy, error: null };
          } }) }) }),
        };
        return query;
      },
    };
    const mirrorDb = {
      from(table: string) {
        expect(table).toBe(TENDER247_TENDER_MIRROR_TABLE);
        const filters: Record<string, unknown> = {};
        const query = {
          select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
          maybeSingle: async () => ({ data: mirrorRows.get(`${filters.source_region}|${filters.tender247_tender_id}`) || null, error: null }),
          insert: (payload: Record<string, unknown>) => ({ select: () => ({ single: async () => { const row = { id: "mirror-legacy", ...payload }; mirrorRows.set(`${payload.source_region}|${payload.tender247_tender_id}`, row); return { data: row, error: null }; } }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
        };
        return query;
      },
    };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(canonicalDb as never);
    vi.mocked(createTender247MirrorSupabaseClient).mockReturnValue(mirrorDb as never);

    const result = await processSavedTender247Response({ Data: [{ tenderid: 101074816, sourcetenderid: legacySourceId, region: "INDIA" }], Success: true }, "2026-10-08");

    expect(result.summary.canonical).toMatchObject({ inserted: 0, updated: 0, repaired: 1, identityConflicts: 0, failed: 0 });
    expect(canonicalRows).toHaveLength(1);
    expect(canonicalRows.get("101074816")).toMatchObject({
      id: legacyId, source_tender_id: "101074816", qualification_status: "VERIFY", prescreen_status: "MAY_BID", decision_source: "manual",
    });
    expect(canonicalRows.get("101074816")?.raw_metadata).toMatchObject({ tender247_sync: { tenderid: 101074816, sourcetenderid: legacySourceId }, notes: "retain operator notes" });
    expect([...mirrorRows.values()][0]).toMatchObject({ canonical_tender_id: legacyId, tender247_tender_id: "101074816" });
    expect(bidWorkspace).toEqual({ tender_id: legacyId, submission_status: "submitted", submitted_by: "user-1", submission_notes: "retain submitted state" });
    expect(tenderResult).toEqual({ tender_id: legacyId, result_stage: "AWAITING_RESULT", source: "BIDASSIST" });
    expect(canonicalDb.from(TENDER_TARGET_TABLE).insert).not.toHaveBeenCalled();
  });

  it("reports a stable-plus-legacy identity conflict without linking a mirror, and continues other tenders", async () => {
    const legacyId = "3d3eaed1-738f-44c0-8d85-a96f72b14d9b";
    const stableId = "e8027f6d-8ad9-4d7f-a3c8-b9ef2b8c1e0a";
    const legacySourceId = "2026_NTPC_108948_1";
    const stableSourceId = "101074816";
    const legacy = { id: legacyId, source_portal: "TENDER247", source_region: "INDIA", source_tender_id: legacySourceId, qualification_status: "NO_GO", raw_metadata: { tender247_sync: { tenderid: 101074816, sourcetenderid: legacySourceId } }, document_urls: [] } as Record<string, unknown>;
    const stable = { id: stableId, source_portal: "TENDER247", source_region: "INDIA", source_tender_id: stableSourceId, qualification_status: "GO", raw_metadata: { manual: "do not touch" }, document_urls: [] } as Record<string, unknown>;
    const inserted: Record<string, unknown>[] = [];
    const canonicalDb = {
      from(table: string) {
        expect(table).toBe(TENDER_TARGET_TABLE);
        const filters: Record<string, unknown> = {}; let limitCount = 0;
        const query = {
          select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; }, order: () => query,
          limit: (count: number) => { limitCount = count; return query; },
          then: (resolve: (value: unknown) => unknown) => resolve({ data: limitCount === 2 && filters.source_tender_id === legacySourceId ? [legacy] : [], error: null }),
          maybeSingle: async () => ({ data: filters.source_tender_id === stableSourceId ? stable : null, error: null }),
          insert: (payload: Record<string, unknown>) => ({ select: () => ({ single: async () => { const row = { id: "other-tender", ...payload, document_urls: [] }; inserted.push(row); return { data: row, error: null }; } }) }),
        };
        return query;
      },
    };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(canonicalDb as never);
    vi.mocked(createTender247MirrorSupabaseClient).mockClear();
    const result = await processSavedTender247Response({ Data: [
      { tenderid: 101074816, sourcetenderid: legacySourceId, region: "INDIA" },
      { tenderid: 101074817, sourcetenderid: "OTHER", region: "INDIA" },
    ], Success: true }, "2026-10-08");
    expect(result.summary.canonical).toMatchObject({ inserted: 1, updated: 0, repaired: 0, identityConflicts: 1, failed: 0 });
    expect(result.status).toBe("PARTIAL_SUCCESS");
    expect(stable).toMatchObject({ id: stableId, qualification_status: "GO", raw_metadata: { manual: "do not touch" } });
    expect(legacy).toMatchObject({ id: legacyId, qualification_status: "NO_GO" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ source_tender_id: "101074817" });
    expect(createTender247MirrorSupabaseClient).toHaveBeenCalledTimes(1);
  });

  it("reconciles a safe identity conflict through the canonical client with its rpc receiver bound", async () => {
    const legacyId = "3d3eaed1-738f-44c0-8d85-a96f72b14d9b";
    const stableId = "e8027f6d-8ad9-4d7f-a3c8-b9ef2b8c1e0a";
    const legacySourceId = "2026_NTPC_108948_1";
    const stableSourceId = "101074816";
    const legacy = { id: legacyId, raw_metadata: { tender247_sync: { tenderid: 101074816, sourcetenderid: legacySourceId } }, document_urls: [] };
    const stable = { id: stableId, raw_metadata: { manual: "preserve" }, document_urls: [] };
    const canonicalDb = {
      rest: "canonical-rest-client",
      rpc: vi.fn(function (this: { rest: string }, name: string, args: Record<string, unknown>) {
        // This deliberately has the same receiver requirement as Supabase's rpc.
        if (this.rest !== "canonical-rest-client") throw new Error("Cannot read properties of undefined (reading 'rest')");
        expect(name).toBe("reconcile_tender247_identity_conflict");
        expect(args).toEqual({ p_legacy_id: legacyId, p_stable_id: stableId, p_stable_source_tender_id: stableSourceId });
        return Promise.resolve({ data: { status: "RECONCILED", survivor_id: stableId }, error: null });
      }),
      from(table: string) {
        expect(table).toBe(TENDER_TARGET_TABLE);
        const filters: Record<string, unknown> = {}; let limitCount = 0;
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => { filters[key] = value; return query; },
          order: () => query,
          limit: (count: number) => { limitCount = count; return query; },
          then: (resolve: (value: unknown) => unknown) => resolve({ data: limitCount === 2 && filters.source_tender_id === legacySourceId ? [legacy] : [], error: null }),
          maybeSingle: async () => ({ data: filters.source_tender_id === stableSourceId || filters.id === stableId ? stable : null, error: null }),
          update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: stable, error: null }) }) }) }),
        };
        return query;
      },
    };
    const mirrorDb = {
      rpc: vi.fn(() => { throw new Error("reconciliation must not use mirror rpc"); }),
      from(table: string) {
        expect(table).toBe(TENDER247_TENDER_MIRROR_TABLE);
        const query = {
          select: () => query, eq: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "mirror-row" }, error: null }) }) }),
        };
        return query;
      },
    };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(canonicalDb as never);
    vi.mocked(createTender247MirrorSupabaseClient).mockReturnValue(mirrorDb as never);

    const result = await processSavedTender247Response({ Data: [{ tenderid: 101074816, sourcetenderid: legacySourceId, region: "INDIA" }], Success: true }, "2026-10-08");

    expect(result.summary.canonical).toMatchObject({ repaired: 1, identityConflicts: 0, failed: 0 });
    expect(canonicalDb.rpc).toHaveBeenCalledTimes(1);
    expect(mirrorDb.rpc).not.toHaveBeenCalled();
  });

  it("keeps a mirror write failure out of the canonical failure counter", async () => {
    const canonicalDb = {
      from: () => {
        const query = {
          select: () => query, eq: () => query, order: () => query, limit: () => query,
          then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          insert: (payload: Record<string, unknown>) => ({ select: () => ({ single: async () => ({ data: { id: "canonical-only", ...payload, document_urls: [] }, error: null }) }) }),
        };
        return query;
      },
    };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(canonicalDb as never);
    vi.mocked(createTender247MirrorSupabaseClient).mockReturnValue({ from: () => { throw new Error("mirror unavailable"); } } as never);
    const result = await processSavedTender247Response({ Data: [{ tenderid: 101074818, region: "INDIA" }], Success: true }, "2026-10-08");
    expect(result.status).toBe("PARTIAL_SUCCESS");
    expect(result.summary.canonical).toMatchObject({ inserted: 1, failed: 0, identityConflicts: 0 });
    expect(result.summary.mirror).toMatchObject({ tendersFailed: 1 });
  });

  it("Run 1 then Run 2 updates one row, refreshes scraped_date, and preserves workflow state", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const mirrorRows = new Map<string, Record<string, unknown>>();
    const keyOf = (value: Record<string, unknown>) => `${value.source_portal}|${value.source_region}|${value.source_tender_id}`;
    const fakeDb = {
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const isMirror = table === TENDER247_TENDER_MIRROR_TABLE;
        expect([TENDER_TARGET_TABLE, TENDER247_TENDER_MIRROR_TABLE]).toContain(table);
        const mirrorKey = () => `${filters.source_region}|${filters.tender247_tender_id}`;
        const finder = {
          select: () => finder,
          eq: (key: string, value: unknown) => { filters[key] = value; return finder; },
          order: () => finder,
          limit: () => finder,
          maybeSingle: async () => ({ data: isMirror ? mirrorRows.get(mirrorKey()) ?? null : rows.get(keyOf(filters)) ?? null, error: null }),
          insert: (payload: Record<string, unknown>) => {
            if (isMirror) {
              const row = { id: "mirror-1", ...payload };
              mirrorRows.set(`${payload.source_region}|${payload.tender247_tender_id}`, row);
              return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
            }
            const row = { id: "row-1", ...payload, qualification_status: null, raw_metadata: payload.raw_metadata, document_urls: [] };
            rows.set(keyOf(row), row);
            return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_key: string, id: string) => ({
              select: () => ({ maybeSingle: async () => {
                const row = [...(isMirror ? mirrorRows : rows).values()].find((candidate) => candidate.id === id)!;
                Object.assign(row, patch);
                return { data: row, error: null };
              }, single: async () => {
                const row = [...(isMirror ? mirrorRows : rows).values()].find((candidate) => candidate.id === id)!;
                Object.assign(row, patch); return { data: row, error: null };
              } }),
            }),
          }),
        };
        return finder;
      },
    };
    const canonicalDb = {
      from(table: string) {
        expect(table).toBe(TENDER_TARGET_TABLE);
        return fakeDb.from(table);
      },
    };
    const mirrorDb = {
      from(table: string) {
        expect(table).toBe(TENDER247_TENDER_MIRROR_TABLE);
        return fakeDb.from(table);
      },
    };
    vi.mocked(createAdminSupabaseClient).mockReturnValue(canonicalDb as never);
    vi.mocked(createTender247MirrorSupabaseClient).mockReturnValue(mirrorDb as never);
    const first = await processSavedTender247Response({ Data: [{ tenderid: "105006964", title: "Original" }], Message: "Success", Success: true, StatusCode: 200, TotalRecord: 1 }, "2026-10-07");
    const row = rows.get("TENDER247|INDIAN|105006964")!;
    row.qualification_status = "SUBMITTED";
    row.raw_metadata = { ...row.raw_metadata as Record<string, unknown>, notes: "do not overwrite" };
    const second = await processSavedTender247Response({ data: [{ tenderid: "105006964", title: "Updated" }], message: "Success", success: true, statusCode: 200, totalRecord: 1 }, "2026-10-08");
    expect(rows.size).toBe(1);
    expect(mirrorRows.size).toBe(1);
    expect([...mirrorRows.values()][0]).toMatchObject({ canonical_tender_id: "row-1", tender247_tender_id: "105006964", title: "Updated" });
    expect(first.summary.tenderCount).toBe(1);
    expect(first.status).toBe("COMPLETED");
    expect(second.status).toBe("COMPLETED");
    expect(first.summary.mirror).toMatchObject({ tendersInserted: 1, tendersUpdated: 0, tendersFailed: 0 });
    expect(second.summary.mirror).toMatchObject({ tendersInserted: 0, tendersUpdated: 1, tendersFailed: 0 });
    expect(createTender247MirrorSupabaseClient).toHaveBeenCalled();
    expect(row).toMatchObject({ title: "Updated", scraped_date: "2026-10-08", qualification_status: "SUBMITTED" });
    expect(row.raw_metadata).toMatchObject({ notes: "do not overwrite" });
  });

  it("does not process unsuccessful or rate-limited upstream responses", () => {
    expect(upstreamResponseCanBeProcessed({ Success: false })).toBe(false);
    expect(upstreamResponseCanBeProcessed({ limitExceeded: true })).toBe(false);
    expect(upstreamResponseCanBeProcessed({ success: true, tenders: [] })).toBe(true);
    expect(upstreamResponseCanBeProcessed({ tenders: [] })).toBe(true);
    expect(upstreamResponseCanBeProcessed({ Data: [], Message: "API limit exceeded.", Success: false, StatusCode: 200, TotalRecord: 0 })).toBe(false);
  });

  it("does zero writes for an unsuccessful production-cased saved response", async () => {
    vi.mocked(createAdminSupabaseClient).mockClear();
    vi.mocked(createTender247MirrorSupabaseClient).mockClear();
    const result = await processSavedTender247Response({ Data: [], Message: "API limit exceeded.", Success: false, StatusCode: 200, TotalRecord: 0 }, "2026-10-08");
    expect(result.status).toBe("FAILED");
    expect(result.summary.tenderCount).toBe(0);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
    expect(createTender247MirrorSupabaseClient).not.toHaveBeenCalled();
  });

  it("uploads a Tender247 document through create, bounded chunks, and finalize without exposing the Graph URL", async () => {
    const priorUrl = process.env.SUPABASE_URL;
    const priorKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const priorGateway = process.env.TENDER247_SYNC_ENDPOINT;
    const priorGatewayKey = process.env.TENDER247_SYNC_UPSTREAM_SECRET;
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
    process.env.TENDER247_SYNC_ENDPOINT = "https://gateway.example/api/tender247/tenders";
    process.env.TENDER247_SYNC_UPSTREAM_SECRET = "gateway-test-key";
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mockedFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const action = new Headers(init?.headers).get("x-upload-action");
      if (action === "tender247-upload-chunk") {
        const start = new Headers(init?.headers).get("x-tender247-start-byte");
        return new Response(JSON.stringify(start === "0" ? { status: "CONTINUE", nextExpectedByte: 1 } : { status: "UPLOAD_COMPLETE" }), { status: 200 });
      }
      if (String(url).includes("/api/tender247/document/")) {
        return new Response(new Uint8Array([1]), { status: 200 });
      }
      const request = JSON.parse(String(init?.body));
      if (request.action === "createTender247UploadSession") {
        return new Response(JSON.stringify({ status: "UPLOAD_REQUIRED", documentId: "doc-uuid", sessionId: "session-uuid", chunkSize: 1, expectedBytes: 1, nextExpectedByte: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "COMPLETED", document: { id: "doc-uuid", storage_url: "https://sharepoint.example/document", sharepoint_drive_item_id: "drive-item-1", file_name: "a.pdf", mime_type: "application/pdf", file_size_bytes: 1, completed_at: "2026-10-08T00:00:00.000Z" } }), { status: 200 });
    });
    await expect(uploadTender247Document({ tenderId: "tender-uuid", document: { documentid: "external-1", filename: "a.pdf", contentType: "application/pdf", token: "abcdefgh", size: 1 }, fetchImpl: mockedFetch })).resolves.toMatchObject({ canonicalDocumentId: "doc-uuid", storageUrl: "https://sharepoint.example/document", sharepointDriveItemId: "drive-item-1" });
    expect(calls).toHaveLength(4);
    const chunks = calls.filter((call) => new Headers(call.init?.headers).get("x-upload-action") === "tender247-upload-chunk");
    expect(chunks).toHaveLength(1);
    expect(new Headers(chunks[0].init?.headers).get("x-tender247-start-byte")).toBe("0");
    expect(new Headers(chunks[0].init?.headers).has("x-graph-url")).toBe(false);
    expect(String(calls[0].init?.body)).not.toContain("service-test-key");
    process.env.SUPABASE_URL = priorUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = priorKey;
    process.env.TENDER247_SYNC_ENDPOINT = priorGateway;
    process.env.TENDER247_SYNC_UPSTREAM_SECRET = priorGatewayKey;
  });

  it("treats ALREADY_STORED as an idempotent document upload", async () => {
    const previousUrl = process.env.SUPABASE_URL; const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = "https://project.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
    const mockedFetch = vi.fn(async () => new Response(JSON.stringify({ status: "ALREADY_STORED", document: { storage_url: "https://sharepoint.example/existing", sharepoint_drive_item_id: "drive-item" } }), { status: 200 })) as typeof fetch;
    await expect(uploadTender247Document({ tenderId: "tender", document: { documentid: "external", filename: "a.pdf", contentType: "application/pdf", token: "abcdefgh", size: 1 }, fetchImpl: mockedFetch })).resolves.toMatchObject({ storageUrl: "https://sharepoint.example/existing", alreadyStored: true });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    process.env.SUPABASE_URL = previousUrl; process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  });

  it("passes an existing canonical id to every recovery upload-session request", async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, endpoint: process.env.TENDER247_SYNC_ENDPOINT, gatewayKey: process.env.TENDER247_SYNC_UPSTREAM_SECRET };
    Object.assign(process.env, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key", TENDER247_SYNC_ENDPOINT: "https://gateway.example/api/tender247/tenders", TENDER247_SYNC_UPSTREAM_SECRET: "gateway-key" });
    const requests: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/api/tender247/document/")) return new Response(new Uint8Array([1]), { status: 200 });
      if (new Headers(init?.headers).get("x-upload-action")) return new Response(JSON.stringify({ status: "UPLOAD_COMPLETE" }), { status: 200 });
      const body = JSON.parse(String(init?.body)); requests.push(body);
      if (body.action === "createTender247UploadSession") return new Response(JSON.stringify({ status: "UPLOAD_REQUIRED", documentId: "11111111-1111-4111-8111-111111111111", sessionId: "session", chunkSize: 1, expectedBytes: 1, nextExpectedByte: 0 }), { status: 200 });
      return new Response(JSON.stringify({ status: "COMPLETED", document: { id: "11111111-1111-4111-8111-111111111111", storage_url: "https://sharepoint.example/document", sharepoint_drive_item_id: "drive-item" } }), { status: 200 });
    });
    await uploadTender247Document({ tenderId: "tender", existingCanonicalDocumentId: "11111111-1111-4111-8111-111111111111", document: { documentid: "external", filename: "a.pdf", contentType: "application/pdf", token: "abcdefgh", size: 1 }, fetchImpl: fetchImpl as typeof fetch });
    expect(requests.filter((body) => body.action === "createTender247UploadSession")).toEqual([expect.objectContaining({ existingCanonicalDocumentId: "11111111-1111-4111-8111-111111111111" })]);
    Object.assign(process.env, { SUPABASE_URL: previous.url, SUPABASE_SERVICE_ROLE_KEY: previous.key, TENDER247_SYNC_ENDPOINT: previous.endpoint, TENDER247_SYNC_UPSTREAM_SECRET: previous.gatewayKey });
  });

  it("logs a correlated, credential-free Edge error body for a failed session request", async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    Object.assign(process.env, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "never-log-this-key" });
    const progress: string[] = [];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "Graph unavailable", detail: "diagnostic" }), { status: 500, headers: { "x-request-id": "request-123", traceparent: "trace-456" } }));
    await expect(uploadTender247Document({ tenderId: "tender-uuid", existingCanonicalDocumentId: "canonical-uuid", document: { documentid: "legacy-external-id", filename: "a.pdf", contentType: "application/pdf", token: "abcdefgh", size: 1 }, fetchImpl: fetchImpl as typeof fetch, onProgress: (message) => progress.push(message) })).rejects.toThrow("Graph unavailable");
    const diagnostic = progress.find((message) => message.startsWith("Edge-function non-2xx:")) || "";
    expect(diagnostic).toContain("createTender247UploadSession"); expect(diagnostic).toContain("request-123"); expect(diagnostic).toContain("canonical-uuid"); expect(diagnostic).toContain("legacy-external-id"); expect(diagnostic).toContain("Graph unavailable"); expect(diagnostic).not.toContain("never-log-this-key");
    Object.assign(process.env, { SUPABASE_URL: previous.url, SUPABASE_SERVICE_ROLE_KEY: previous.key });
  });

  it("resolves an unknown manifest size from Content-Length before starting the upload", async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, endpoint: process.env.TENDER247_SYNC_ENDPOINT, gatewayKey: process.env.TENDER247_SYNC_UPSTREAM_SECRET };
    Object.assign(process.env, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key", TENDER247_SYNC_ENDPOINT: "https://gateway.example/api/tender247/tenders", TENDER247_SYNC_UPSTREAM_SECRET: "gateway-key" });
    const requests: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/api/tender247/document-info/")) return new Response(JSON.stringify({ size: 12345, stagedId: "stage-1" }), { status: 200 });
      if (String(url).includes("/api/tender247/staged-document/") && init?.method !== "DELETE") return new Response(new Uint8Array(12345), { status: 200 });
      if (String(url).includes("/api/tender247/staged-document/") && init?.method === "DELETE") return new Response(null, { status: 204 });
      const action = new Headers(init?.headers).get("x-upload-action");
      if (action === "tender247-upload-chunk") return new Response(JSON.stringify({ status: "UPLOAD_COMPLETE" }), { status: 200 });
      const request = JSON.parse(String(init?.body)); requests.push(request);
      if (request.action === "createTender247UploadSession" && !("expectedBytes" in request)) return new Response(JSON.stringify({ status: "NEEDS_SIZE" }), { status: 200 });
      if (request.action === "createTender247UploadSession") return new Response(JSON.stringify({ status: "UPLOAD_REQUIRED", documentId: "doc", sessionId: "session", chunkSize: 12345, expectedBytes: 12345, nextExpectedByte: 0 }), { status: 200 });
      return new Response(JSON.stringify({ status: "COMPLETED", document: { id: "doc", storage_url: "https://sharepoint.example/document", sharepoint_drive_item_id: "drive-item" } }), { status: 200 });
    });
    await expect(uploadTender247Document({ tenderId: "tender", document: { documentid: "external", filename: "a.pdf", contentType: "application/pdf", token: "abcdefgh", size: null }, fetchImpl: fetchImpl as typeof fetch })).resolves.toMatchObject({ fileSize: 12345 });
    expect(requests.find((request) => request.expectedBytes === 12345)).toBeTruthy();
    Object.assign(process.env, { SUPABASE_URL: previous.url, SUPABASE_SERVICE_ROLE_KEY: previous.key, TENDER247_SYNC_ENDPOINT: previous.endpoint, TENDER247_SYNC_UPSTREAM_SECRET: previous.gatewayKey });
  });

  it("does not download an unknown-size document when its identity is already stored", async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    Object.assign(process.env, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key" });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/api/tender247/document/")) throw new Error("document must not be downloaded");
      return new Response(JSON.stringify({ status: "ALREADY_STORED", document: { id: "doc", storage_url: "https://sharepoint.example/existing", sharepoint_drive_item_id: "drive-item" } }), { status: 200 });
    });
    await expect(uploadTender247Document({ tenderId: "tender", document: { documentid: "external", filename: "a.pdf", contentType: "application/pdf", token: "abcdefgh", size: null }, fetchImpl: fetchImpl as typeof fetch })).resolves.toMatchObject({ alreadyStored: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    Object.assign(process.env, { SUPABASE_URL: previous.url, SUPABASE_SERVICE_ROLE_KEY: previous.key });
  });

  it("fails explicitly without Content-Length before creating an incomplete upload", async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, endpoint: process.env.TENDER247_SYNC_ENDPOINT, gatewayKey: process.env.TENDER247_SYNC_UPSTREAM_SECRET };
    Object.assign(process.env, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key", TENDER247_SYNC_ENDPOINT: "https://gateway.example/api/tender247/tenders", TENDER247_SYNC_UPSTREAM_SECRET: "gateway-key" });
    let sessionCalls = 0; let probes = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/api/tender247/document-info/")) return new Response(JSON.stringify({ stagedId: "stage-1" }), { status: 200 });
      if (String(url).includes("/api/tender247/document/")) { probes += 1; return new Response(null, { status: 200 }); }
      sessionCalls += 1; return new Response(JSON.stringify({ status: "NEEDS_SIZE" }), { status: 200 });
    });
    await expect(uploadTender247Document({ tenderId: "tender", document: { documentid: "external", filename: "a.pdf", contentType: "application/pdf", token: "abcdefgh", size: null }, fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow("DOCUMENT_SIZE_UNKNOWN");
    expect(sessionCalls).toBe(1); expect(probes).toBe(1);
    Object.assign(process.env, { SUPABASE_URL: previous.url, SUPABASE_SERVICE_ROLE_KEY: previous.key, TENDER247_SYNC_ENDPOINT: previous.endpoint, TENDER247_SYNC_UPSTREAM_SECRET: previous.gatewayKey });
  });

  it("performs exactly one physical SharePoint upload across two resumed document attempts", async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, endpoint: process.env.TENDER247_SYNC_ENDPOINT, gatewayKey: process.env.TENDER247_SYNC_UPSTREAM_SECRET };
    Object.assign(process.env, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key", TENDER247_SYNC_ENDPOINT: "https://gateway.example/api/tender247/tenders", TENDER247_SYNC_UPSTREAM_SECRET: "gateway-key" });
    let createCalls = 0;
    const physicalUploads: RequestInit[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const action = new Headers(init?.headers).get("x-upload-action");
      if (action === "tender247-upload-chunk") { physicalUploads.push(init || {}); return new Response(JSON.stringify({ status: "UPLOAD_COMPLETE" }), { status: 200 }); }
      if (String(url).includes("/api/tender247/document/")) return new Response(new Uint8Array([1]), { status: 200 });
      const actionName = JSON.parse(String(init?.body)).action;
      if (actionName === "createTender247UploadSession") {
        createCalls += 1;
        return new Response(JSON.stringify(createCalls === 1
          ? { status: "UPLOAD_REQUIRED", documentId: "canonical-document", sessionId: "session", chunkSize: 1, expectedBytes: 1, nextExpectedByte: 0 }
          : { status: "ALREADY_STORED", document: { id: "canonical-document", storage_url: "https://sharepoint.example/reused", sharepoint_drive_item_id: "drive-item" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "COMPLETED", document: { id: "canonical-document", storage_url: "https://sharepoint.example/reused", sharepoint_drive_item_id: "drive-item", file_name: "a.pdf", mime_type: "application/pdf", file_size_bytes: 1 } }), { status: 200 });
    });
    const document = { documentid: "external-1", filename: "a.pdf", contentType: "application/pdf", token: "abcdefgh", size: 1 };
    const first = await uploadTender247Document({ tenderId: "same-canonical-tender", document, fetchImpl: fetchImpl as typeof fetch });
    const second = await uploadTender247Document({ tenderId: "same-canonical-tender", document, fetchImpl: fetchImpl as typeof fetch });
    expect(first).toMatchObject({ canonicalDocumentId: "canonical-document", storageUrl: "https://sharepoint.example/reused", sharepointDriveItemId: "drive-item", alreadyStored: false });
    expect(second).toMatchObject({ canonicalDocumentId: "canonical-document", storageUrl: "https://sharepoint.example/reused", sharepointDriveItemId: "drive-item", alreadyStored: true });
    expect(physicalUploads).toHaveLength(1);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("/api/tender247/document/"))).toHaveLength(1);
    Object.assign(process.env, { SUPABASE_URL: previous.url, SUPABASE_SERVICE_ROLE_KEY: previous.key, TENDER247_SYNC_ENDPOINT: previous.endpoint, TENDER247_SYNC_UPSTREAM_SECRET: previous.gatewayKey });
  });

  it("resumes a bounded 6.5 MB source at the committed offset, then finalizes", async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, endpoint: process.env.TENDER247_SYNC_ENDPOINT, gatewayKey: process.env.TENDER247_SYNC_UPSTREAM_SECRET };
    Object.assign(process.env, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key", TENDER247_SYNC_ENDPOINT: "https://gateway.example/api/tender247/tenders", TENDER247_SYNC_UPSTREAM_SECRET: "gateway-key" });
    const size = 6_591_515, first = 5_242_880, ranges: string[] = [], chunks: string[] = []; let finalized = false, canonicalUpdateStarted = false;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url), headers = new Headers(init?.headers), action = headers.get("x-upload-action");
      if (action === "tender247-upload-chunk") { chunks.push(`${headers.get("x-tender247-start-byte")}-${headers.get("x-tender247-end-byte")}`); return new Response(JSON.stringify({ status: "CONTINUE", nextExpectedByte: Number(headers.get("x-tender247-end-byte")) + 1 }), { status: 200 }); }
      if (value.includes("/api/tender247/document/")) { const range = headers.get("range") || ""; ranges.push(range); const start = range ? Number(/\d+/.exec(range)?.[0]) : 0; const length = start ? size - start : first; return new Response(new Uint8Array(length), { status: start ? 206 : 200, headers: { "content-length": String(length) } }); }
      const body = JSON.parse(String(init?.body));
      if (body.action === "createTender247UploadSession") return new Response(JSON.stringify({ status: "UPLOAD_REQUIRED", documentId: "doc", sessionId: "session", chunkSize: first, expectedBytes: size, nextExpectedByte: 0 }), { status: 200 });
      finalized = true; return new Response(JSON.stringify({ status: "COMPLETED", document: { id: "doc", storage_url: "https://sharepoint.example/file", sharepoint_drive_item_id: "drive-item" } }), { status: 200 });
    });
    await uploadTender247Document({ tenderId: "tender", document: { documentid: "external", filename: "a.pdf", contentType: "application/pdf", token: "abcdefgh", size }, fetchImpl: fetchImpl as typeof fetch, onCanonicalUpdateStarting: () => { canonicalUpdateStarted = true; } });
    expect(chunks).toEqual(["0-5242879", "5242880-6591514"]);
    expect(ranges).toEqual(["", "bytes=5242880-"]); expect(finalized).toBe(true); expect(canonicalUpdateStarted).toBe(true);
    Object.assign(process.env, { SUPABASE_URL: previous.url, SUPABASE_SERVICE_ROLE_KEY: previous.key, TENDER247_SYNC_ENDPOINT: previous.endpoint, TENDER247_SYNC_UPSTREAM_SECRET: previous.gatewayKey });
  });

  it("uploads a >10 MB source in three committed chunks before finalizing", async () => {
    const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, endpoint: process.env.TENDER247_SYNC_ENDPOINT, gatewayKey: process.env.TENDER247_SYNC_UPSTREAM_SECRET };
    Object.assign(process.env, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "key", TENDER247_SYNC_ENDPOINT: "https://gateway.example/api/tender247/tenders", TENDER247_SYNC_UPSTREAM_SECRET: "gateway-key" });
    const size = 11_534_337, part = 5_242_880, chunks: string[] = []; let finalized = false;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url), headers = new Headers(init?.headers), action = headers.get("x-upload-action");
      if (action === "tender247-upload-chunk") { chunks.push(`${headers.get("x-tender247-start-byte")}-${headers.get("x-tender247-end-byte")}`); return new Response(JSON.stringify({ status: "CONTINUE", nextExpectedByte: Number(headers.get("x-tender247-end-byte")) + 1 }), { status: 200 }); }
      if (value.includes("/api/tender247/document/")) { const range = headers.get("range") || ""; const start = range ? Number(/\d+/.exec(range)?.[0]) : 0; return new Response(new Uint8Array(Math.min(part, size - start)), { status: start ? 206 : 200, headers: { "content-length": String(Math.min(part, size - start)) } }); }
      const body = JSON.parse(String(init?.body));
      if (body.action === "createTender247UploadSession") return new Response(JSON.stringify({ status: "UPLOAD_REQUIRED", documentId: "doc", sessionId: "session", chunkSize: part, expectedBytes: size, nextExpectedByte: 0 }), { status: 200 });
      finalized = true; return new Response(JSON.stringify({ status: "COMPLETED", document: { id: "doc", storage_url: "https://sharepoint.example/file", sharepoint_drive_item_id: "drive-item" } }), { status: 200 });
    });
    await uploadTender247Document({ tenderId: "tender", document: { documentid: "external", filename: "a.pdf", contentType: "application/pdf", token: "abcdefgh", size }, fetchImpl: fetchImpl as typeof fetch });
    expect(chunks).toEqual(["0-5242879", "5242880-10485759", "10485760-11534336"]); expect(finalized).toBe(true);
    Object.assign(process.env, { SUPABASE_URL: previous.url, SUPABASE_SERVICE_ROLE_KEY: previous.key, TENDER247_SYNC_ENDPOINT: previous.endpoint, TENDER247_SYNC_UPSTREAM_SECRET: previous.gatewayKey });
  });
});

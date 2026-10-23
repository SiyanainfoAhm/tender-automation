import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/server", () => ({ getServerSupabase: vi.fn() }));
vi.mock("@/server/tender247/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/tender247/sync")>();
  return { ...actual, requestTender247Once: vi.fn(), processSavedTender247Response: vi.fn() };
});

import { getServerSupabase } from "@/lib/db/server";
import { processSavedTender247Response, requestTender247Once } from "@/server/tender247/sync";
import { POST, resolveTender247SyncDate } from "../route";

const runId = "cf2f14d7-1e71-4d9a-a836-47bdc769aa4c";
const fixtureTender = {
  tenderid: 101074816,
  sourcetenderid: "2026_NTPC_108948_1",
  authority: "National Thermal Power Corporation Limited",
  zipdocumentdownload: "https://partnersdataapi.tender247.com/T247Data/api/partner-document-download-links/test-token",
};
const rawResponse = { Data: [fixtureTender], Success: true, Message: "Success", StatusCode: 200, TotalRecord: 1 };
const verifiedContractEnv = {
  TENDER247_UPSTREAM_CONTRACT_STATUS: "VERIFIED",
  TENDER247_UPSTREAM_CONTRACT_JSON: JSON.stringify({
    evidence: "Tender247 provider test contract v1",
    dateFilter: { field: "publication", timezone: "Asia/Kolkata", boundary: "INCLUSIVE_CALENDAR_DATE", startParam: "published_from", endParam: "published_to" },
    pagination: { mode: "PAGE_NUMBER", pageParam: "page", pageSizeParam: "page_size", pageSize: 100, firstPage: 1, totalCountField: "TotalRecord" },
  }),
};

describe("POST /api/tender247/sync resume", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("defaults to calendar yesterday in IST and accepts an explicit calendar date", () => {
    expect(resolveTender247SyncDate({}, new Date("2026-10-10T18:31:00.000Z"))).toEqual({
      requestedDate: null, resolvedDate: "2026-10-10", source: "default_ist_yesterday",
    });
    expect(resolveTender247SyncDate({ scrapedDate: "2026-10-10" }, new Date("2026-10-10T18:31:00.000Z"))).toEqual({
      requestedDate: "2026-10-10", resolvedDate: "2026-10-10", source: "explicit",
    });
    expect(() => resolveTender247SyncDate({ scrapedDate: "2026-02-30" })).toThrow("valid YYYY-MM-DD");
  });

  it("allows the established no-query feed when provider date filters are unverified", async () => {
    Object.assign(process.env, {
      SUPABASE_URL: "https://unit-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "unit-key",
      TENDER247_MIRROR_SUPABASE_URL: "https://mirror.unit-test.supabase.co", TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY: "mirror-key",
      TENDER247_SYNC_SECRET: "route-secret", TENDER247_SYNC_ENDPOINT: "https://gateway.invalid/api/tender247/tenders",
      TENDER247_SYNC_UPSTREAM_SECRET: "upstream-secret", TENDER247_SYNC_COMPANY_ID: "company-1",
      TENDER247_UPSTREAM_CONTRACT_STATUS: "COMPATIBILITY_UNVERIFIED", TENDER247_UPSTREAM_CONTRACT_JSON: "",
    });
    const db = { from: vi.fn(() => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: runId }, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    })) };
    vi.mocked(getServerSupabase).mockReturnValue(db as never);
    vi.mocked(requestTender247Once).mockResolvedValue({ Data: [], Success: true });
    vi.mocked(processSavedTender247Response).mockResolvedValue({ status: "COMPLETED", summary: { scrapedDate: "2026-10-10", sourceCompleteness: "UNVERIFIED", tenderCount: 0, tendersUpserted: 0, tenderFailures: 0, documentsUploaded: 0, documentFailures: 0, errors: [], canonical: { inserted: 0, updated: 0, repaired: 0, failed: 0, identityConflicts: 0 }, mirror: { tendersInserted: 0, tendersUpdated: 0, tendersFailed: 0, documentsInserted: 0, documentsUpdated: 0, documentsFailed: 0 }, documents: { tendersWithDocuments: 0, manifestsRequested: 0, manifestsFailed: 0, documentsDiscovered: 0, attempted: 0, alreadyStored: 0, downloaded: 0, sharepointUploaded: 0, failed: 0 } } });
    const response = await POST(new Request("http://localhost/api/tender247/sync", {
      method: "POST", headers: { authorization: "Bearer route-secret", "content-type": "application/json" },
      body: JSON.stringify({ scrapedDate: "2026-10-10" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, summary: { sourceCompleteness: "UNVERIFIED" } });
    expect(requestTender247Once).toHaveBeenCalledWith("2026-10-10");
  });

  it("returns the database failure when it cannot create the sync run", async () => {
    vi.clearAllMocks();
    Object.assign(process.env, {
      SUPABASE_URL: "https://unit-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "unit-key",
      TENDER247_MIRROR_SUPABASE_URL: "https://mirror.unit-test.supabase.co", TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY: "mirror-key",
      TENDER247_SYNC_SECRET: "route-secret", TENDER247_SYNC_ENDPOINT: "https://gateway.invalid/api/tender247/tenders",
      TENDER247_SYNC_UPSTREAM_SECRET: "upstream-secret", TENDER247_SYNC_COMPANY_ID: "company-1",
      TENDER247_UPSTREAM_CONTRACT_STATUS: "COMPATIBILITY_UNVERIFIED", TENDER247_UPSTREAM_CONTRACT_JSON: "",
    });
    const db = {
      from: vi.fn(() => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { code: "PGRST204", message: "Could not find the 'mode' column" } }),
          }),
        }),
      })),
    };
    vi.mocked(getServerSupabase).mockReturnValue(db as never);

    const response = await POST(new Request("http://localhost/api/tender247/sync", {
      method: "POST", headers: { authorization: "Bearer route-secret", "content-type": "application/json" }, body: "{}",
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false, error: "Unable to create sync run: Could not find the 'mode' column",
    });
    expect(requestTender247Once).not.toHaveBeenCalled();
  });

  it("keeps legacy UNVERIFIED disabled rather than silently enabling compatibility mode", async () => {
    vi.clearAllMocks();
    Object.assign(process.env, {
      SUPABASE_URL: "https://unit-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "unit-key",
      TENDER247_MIRROR_SUPABASE_URL: "https://mirror.unit-test.supabase.co", TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY: "mirror-key",
      TENDER247_SYNC_SECRET: "route-secret", TENDER247_SYNC_ENDPOINT: "https://gateway.invalid/api/tender247/tenders",
      TENDER247_SYNC_UPSTREAM_SECRET: "upstream-secret", TENDER247_SYNC_COMPANY_ID: "company-1",
      TENDER247_UPSTREAM_CONTRACT_STATUS: "UNVERIFIED", TENDER247_UPSTREAM_CONTRACT_JSON: "",
    });
    const response = await POST(new Request("http://localhost/api/tender247/sync", { method: "POST", headers: { authorization: "Bearer route-secret" } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("COMPATIBILITY_UNVERIFIED") });
    expect(getServerSupabase).not.toHaveBeenCalled();
  });

  it("uses the saved response and scraped date for two idempotent resumes without live feed calls", async () => {
    vi.clearAllMocks();
    Object.assign(process.env, {
      SUPABASE_URL: "https://unit-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "unit-key",
      TENDER247_MIRROR_SUPABASE_URL: "https://mirror.unit-test.supabase.co", TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY: "mirror-key",
      TENDER247_SYNC_SECRET: "route-secret", TENDER247_SYNC_ENDPOINT: "https://gateway.invalid/api/tender247/tenders",
      TENDER247_SYNC_UPSTREAM_SECRET: "upstream-secret", TENDER247_SYNC_COMPANY_ID: "company-1",
      ...verifiedContractEnv,
    });
    const savedRun = { id: runId, company_id: "company-1", run_date: "2026-10-08", summary: { rawResponse } };
    const updates: Record<string, unknown>[] = [];
    const db = {
      from: (table: string) => {
        expect(table).toBe("agenttender_pipeline_runs");
        const selectQuery = {
          eq: () => selectQuery,
          maybeSingle: async () => ({ data: savedRun, error: null }),
        };
        return {
          select: () => selectQuery,
          update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null }; } }),
        };
      },
    };
    vi.mocked(getServerSupabase).mockReturnValue(db as never);
    const firstSummary = {
      scrapedDate: "2026-10-08", sourceCompleteness: "UNVERIFIED" as const, tenderCount: 1, tendersUpserted: 1, tenderFailures: 0, documentsUploaded: 1, documentFailures: 0, errors: [],
      canonical: { inserted: 1, updated: 0, repaired: 0, identityConflicts: 0, failed: 0 },
      mirror: { tendersInserted: 1, tendersUpdated: 0, tendersFailed: 0, documentsInserted: 1, documentsUpdated: 0, documentsFailed: 0 },
      documents: { tendersWithDocuments: 1, manifestsRequested: 1, manifestsFailed: 0, documentsDiscovered: 1, attempted: 1, alreadyStored: 0, downloaded: 1, sharepointUploaded: 1, failed: 0 },
    };
    const secondSummary = { ...firstSummary, canonical: { ...firstSummary.canonical, inserted: 0, updated: 1 }, mirror: { ...firstSummary.mirror, tendersInserted: 0, tendersUpdated: 1, documentsInserted: 0, documentsUpdated: 1 }, documents: { ...firstSummary.documents, attempted: 0, alreadyStored: 1, downloaded: 0, sharepointUploaded: 0 } };
    vi.mocked(processSavedTender247Response).mockResolvedValueOnce({ status: "COMPLETED", summary: firstSummary }).mockResolvedValueOnce({ status: "COMPLETED", summary: secondSummary });
    const noLiveFetch = vi.fn();
    vi.stubGlobal("fetch", noLiveFetch);
    const request = () => new Request("http://localhost/api/tender247/sync", { method: "POST", headers: { authorization: "Bearer route-secret", "content-type": "application/json" }, body: JSON.stringify({ resumeRunId: runId }) });

    const first = await POST(request());
    const second = await POST(request());

    expect(await first.json()).toMatchObject({ ok: true, runId, resumed: true, summary: { scrapedDate: "2026-10-08", canonical: { inserted: 1 }, mirror: { tendersInserted: 1 } } });
    expect(await second.json()).toMatchObject({ ok: true, runId, resumed: true, summary: { scrapedDate: "2026-10-08", documents: { alreadyStored: 1, sharepointUploaded: 0 } } });
    expect(processSavedTender247Response).toHaveBeenNthCalledWith(1, rawResponse, "2026-10-08");
    expect(processSavedTender247Response).toHaveBeenNthCalledWith(2, rawResponse, "2026-10-08");
    expect(requestTender247Once).not.toHaveBeenCalled();
    expect(noLiveFetch).not.toHaveBeenCalled();
    expect(updates).toHaveLength(4);
  });

  it("refuses an explicit date that conflicts with a saved run date", async () => {
    vi.clearAllMocks();
    Object.assign(process.env, {
      SUPABASE_URL: "https://unit-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "unit-key",
      TENDER247_MIRROR_SUPABASE_URL: "https://mirror.unit-test.supabase.co", TENDER247_MIRROR_SUPABASE_SERVICE_ROLE_KEY: "mirror-key",
      TENDER247_SYNC_SECRET: "route-secret", TENDER247_SYNC_ENDPOINT: "https://gateway.invalid/api/tender247/tenders",
      TENDER247_SYNC_UPSTREAM_SECRET: "upstream-secret", TENDER247_SYNC_COMPANY_ID: "company-1",
      ...verifiedContractEnv,
    });
    const savedRun = { id: runId, company_id: "company-1", run_date: "2026-10-10", summary: { rawResponse } };
    const db = { from: () => ({ select: () => { const query = { eq: () => query, maybeSingle: async () => ({ data: savedRun, error: null }) }; return query; } }) };
    vi.mocked(getServerSupabase).mockReturnValue(db as never);
    const response = await POST(new Request("http://localhost/api/tender247/sync", {
      method: "POST", headers: { authorization: "Bearer route-secret", "content-type": "application/json" },
      body: JSON.stringify({ resumeRunId: runId, scrapedDate: "2026-10-09" }),
    }));
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("Saved run date is 2026-10-10");
    expect(processSavedTender247Response).not.toHaveBeenCalled();
    expect(requestTender247Once).not.toHaveBeenCalled();
  });
});

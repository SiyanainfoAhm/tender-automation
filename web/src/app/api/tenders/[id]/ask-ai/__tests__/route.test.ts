import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  cookie: vi.fn(), permission: vi.fn(), tender: vi.fn(), release: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("@/server/auth/company-access", () => ({ CompanyAccessError: class extends Error {} }));
vi.mock("@/server/auth/permissions", () => ({ requirePermissionStrict: mocks.permission }));
vi.mock("@/server/repositories/tenderRepository", () => ({ getTenderById: mocks.tender }));
vi.mock("@/server/ai/rag/input-limits", () => ({
  AskAiValidationError: class extends Error {},
  validateAskAiInput: ({ message }: { message: string }) => ({ message, conversation: [] }),
}));
vi.mock("@/server/ai/rag/rate-limit", () => ({
  acquireAskAiConcurrency: () => ({ ok: true }),
  checkAskAiRateLimits: async () => ({ ok: true }),
  releaseAskAiConcurrency: mocks.release,
}));
vi.mock("@/server/ai/rag/usage-log", () => ({
  createAskAiRequestId: () => "request-id", insertAiUsageLog: vi.fn(),
}));
import { POST } from "../route";

const fetchMock = vi.fn();
const context = { params: Promise.resolve({ id: "tender-id" }) };
function request(stream = false) {
  return new Request("https://app.example/api/tenders/tender-id/ask-ai", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json" },
    body: JSON.stringify({ message: "What is the EMD?", stream, user_id: "forged-user", company_id: "forged-company" }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("AGENTTENDER_SESSION_COOKIE", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "must-never-forward");
  vi.stubGlobal("fetch", fetchMock);
  mocks.cookie.mockReturnValue({ value: "authenticated-cookie-token" });
  mocks.permission.mockResolvedValue({ companyId: "company-id", user: { id: "user-id" } });
  mocks.tender.mockResolvedValue({ id: "tender-id" });
  fetchMock.mockResolvedValue(Response.json({ ok: true, status: "ANSWERED", answer: "Verified answer" }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Ask AI session forwarding", () => {
  for (const stream of [false, true]) {
    it(`forwards the validated cookie through the adapter (${stream ? "SSE" : "JSON"})`, async () => {
      const result = await POST(request(stream), context);
      const text = await result.text();
      expect(result.status).toBe(200);
      expect(text).toContain("Verified answer");
      expect(text).not.toContain("authenticated-cookie-token");
      expect(text).not.toContain("must-never-forward");
      expect(mocks.permission).toHaveBeenCalledWith("tenders.view");
      expect(mocks.tender).toHaveBeenCalledWith("tender-id");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://project.supabase.co/functions/v1/agenttender-db-chat");
      const headers = new Headers(init.headers);
      expect(headers.get("x-agenttender-session")).toBe("authenticated-cookie-token");
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.has("apikey")).toBe(false);
      expect(JSON.parse(init.body)).toEqual({ tender_id: "tender-id", company_id: "company-id", message: "What is the EMD?", conversation: [] });
      expect(mocks.release).toHaveBeenCalledTimes(1);
    });
  }
  it("does not call V2 when the cookie is missing", async () => {
    mocks.cookie.mockReturnValue(undefined);
    expect((await POST(request(), context)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("respects the configured auth cookie name", async () => {
    vi.stubEnv("AGENTTENDER_SESSION_COOKIE", "custom-session");
    await (await POST(request(), context)).text();
    expect(mocks.cookie).toHaveBeenCalledWith("custom-session");
  });
  it("does not call V2 after a permission failure", async () => {
    mocks.permission.mockRejectedValue(new Error("Permission denied"));
    await POST(request(), context);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

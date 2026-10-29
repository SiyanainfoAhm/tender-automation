import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: () => ({}) }));

import { middleware } from "@/middleware";
import { GET as sessionExpired } from "@/app/api/auth/session-expired/route";

function withCookie(path: string) {
  return new NextRequest(new URL(path, "https://app.example"), {
    headers: { cookie: "agenttender_session=stale-token" },
  });
}

describe("expired session redirect loop", () => {
  it("clears the stale cookie and sends the user to login", () => {
    const response = sessionExpired(new Request("https://app.example/api/auth/session-expired"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/login?expired=1");
    const cookie = response.headers.get("set-cookie") || "";
    expect(cookie).toContain("agenttender_session=;");
    expect(cookie.toLowerCase()).toContain("max-age=0");
  });

  it("shows the login page instead of bouncing back when the session expired", () => {
    const response = middleware(withCookie("/login?expired=1"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("still skips the login page for a normal signed-in visit", () => {
    const response = middleware(withCookie("/login"));
    expect(response.headers.get("location")).toContain("/tenders/indian");
  });
});

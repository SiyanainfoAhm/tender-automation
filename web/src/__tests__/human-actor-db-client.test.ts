import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { humanActorHeaders } from "@/lib/db/server";

describe("humanActorHeaders", () => {
  it("identifies a validated custom-auth session without using Supabase Auth", () => {
    expect(
      humanActorHeaders({
        sessionId: "a0ca55d8-5f5a-4e58-b356-8b7ee07bf9fe",
        user: { id: "2f5b1776-c2d9-4265-94bd-5e5d12f96784" },
      } as never),
    ).toMatchObject({
      "x-agenttender-actor": "human",
      "x-agenttender-actor-type": "human",
      "x-agenttender-authenticated": "true",
      "x-agenttender-user-id": "2f5b1776-c2d9-4265-94bd-5e5d12f96784",
      "x-agenttender-actor-user-id": "2f5b1776-c2d9-4265-94bd-5e5d12f96784",
      "x-agenttender-session-id": "a0ca55d8-5f5a-4e58-b356-8b7ee07bf9fe",
    });
  });
});

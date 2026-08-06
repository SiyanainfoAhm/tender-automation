import { describe, expect, it } from "vitest";

import { AppError, createCorrelationId } from "@/lib/errors/app-error";

describe("AppError", () => {
  it("creates correlation IDs in STI format", () => {
    const id = createCorrelationId();
    expect(id).toMatch(/^STI-[A-F0-9]{6}$/);
  });

  it("exposes safe public reference without internal details", () => {
    const error = new AppError({
      code: "DATABASE_QUERY_FAILED",
      publicMessage: "Unable to load tender data. Reference: STI-ABC123",
      internalMessage: "relation agenttender_web_tender_list does not exist",
    });
    expect(error.toPublicReference()).toContain("STI-");
    expect(error.toPublicReference()).not.toContain("relation");
  });
});

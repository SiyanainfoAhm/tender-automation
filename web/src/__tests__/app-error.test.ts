import { describe, expect, it } from "vitest";

import {
  AppError,
  createCorrelationId,
  extractCorrelationId,
  resolveDisplayReference,
} from "@/lib/errors/app-error";

describe("AppError", () => {
  it("creates correlation IDs in TF-YYYYMMDD-XXXXXX format", () => {
    const id = createCorrelationId(new Date("2026-09-03T12:00:00Z"));
    expect(id).toMatch(/^TF-20260903-[A-Z0-9]{6}$/);
  });

  it("exposes safe public reference without internal details", () => {
    const error = new AppError({
      code: "DATABASE_QUERY_FAILED",
      publicMessage: "Unable to load tender data.",
      internalMessage: "relation agenttender_web_tender_list does not exist",
      correlationId: "TF-20260903-A7K92D",
    });
    expect(error.toPublicReference()).toContain("TF-20260903-A7K92D");
    expect(error.toPublicReference()).not.toContain("relation");
    expect(error.digest).toBe("TF-20260903-A7K92D");
    expect(error.publicMessage).toContain("TF-20260903-A7K92D");
  });

  it("extracts correlation ids from redacted client errors via digest/message", () => {
    expect(
      extractCorrelationId({
        message: "An error occurred in the Server Components render.",
        digest: "TF-20260903-A7K92D",
      }),
    ).toBe("TF-20260903-A7K92D");

    expect(
      extractCorrelationId({
        message: "Unable to load tender data. Reference: TF-20260903-ZZZZZZ",
      }),
    ).toBe("TF-20260903-ZZZZZZ");

    const display = resolveDisplayReference({ message: "boom" });
    expect(display).toMatch(/^TF-\d{8}-[A-Z0-9]{6}$/);
    expect(display).not.toBe("unavailable");
  });
});

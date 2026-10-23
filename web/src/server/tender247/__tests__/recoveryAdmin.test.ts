import { describe, expect, it } from "vitest";
import { canAccessRecoveryCompany, canManuallyRetry, recoveryFilter, recoveryPage } from "@/server/tender247/recoveryAdmin";

describe("Tender247 recovery admin guards", () => {
  it("fails closed for missing/other-company scopes", () => {
    expect(canAccessRecoveryCompany(null, "company-a")).toBe(false);
    expect(canAccessRecoveryCompany("company-a", null)).toBe(false);
    expect(canAccessRecoveryCompany("company-a", "company-b")).toBe(false);
    expect(canAccessRecoveryCompany("company-a", "company-a")).toBe(true);
  });
  it("normalizes filters and pagination without gaps or unsafe page numbers", () => {
    expect(recoveryFilter("SOURCE_EMPTY")).toBe("SOURCE_EMPTY"); expect(recoveryFilter("bad")).toBe("");
    expect(recoveryPage("2")).toBe(2); expect(recoveryPage("0")).toBe(1); expect(recoveryPage("NaN")).toBe(1);
  });
  it("does not offer manual retry for completed/reconciled work", () => {
    expect(canManuallyRetry("SOURCE_EMPTY")).toBe(true); expect(canManuallyRetry("COMPLETED")).toBe(false); expect(canManuallyRetry("RECONCILED")).toBe(false);
  });
});

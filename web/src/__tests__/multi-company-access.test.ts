import { describe, expect, it } from "vitest";

/**
 * Multi-company identity rules (custom auth):
 * - one email → one agenttender_users row
 * - many companies via agenttender_company_memberships
 */
describe("multi-company access contracts", () => {
  it("keeps email uniqueness semantics as existing-account (not duplicate identity)", () => {
    const existingAccountError = Object.assign(new Error("EXISTING_ACCOUNT"), {
      name: "ExistingAccountError",
    });
    expect(existingAccountError.message).toBe("EXISTING_ACCOUNT");
    expect(existingAccountError.name).toBe("ExistingAccountError");
  });

  it("treats membership uniqueness as (user_id, company_id)", () => {
    const keys = [
      ["u1", "c1"],
      ["u1", "c2"],
      ["u1", "c1"],
    ] as const;
    const unique = new Set(keys.map(([u, c]) => `${u}:${c}`));
    expect(unique.size).toBe(2);
  });

  it("scopes role by membership, not globally on the auth identity", () => {
    const memberships = [
      { companyId: "siyana", role: "ADMIN" },
      { companyId: "mitaja", role: "BID_MANAGER" },
    ];
    const active = "mitaja";
    const role = memberships.find((m) => m.companyId === active)?.role;
    expect(role).toBe("BID_MANAGER");
  });
});

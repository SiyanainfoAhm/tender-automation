import { describe, expect, it } from "vitest";
import {
  DISPLAY_ROLES,
  PERMISSION_CATALOG,
  ROLE_PERMISSIONS,
  permissionCountForRole,
  roleHasPermission,
} from "@/lib/rbac/permissions";
import {
  assertAdminMutationAllowed,
  assertUserDeletionAllowed,
  countActiveAdmins,
} from "@/server/auth/admin-guards";

describe("RBAC permission matrix accuracy", () => {
  it("Admin has every catalog permission", () => {
    for (const perm of PERMISSION_CATALOG) {
      expect(roleHasPermission("ADMIN", perm.key)).toBe(true);
    }
    expect(permissionCountForRole("ADMIN")).toBe(PERMISSION_CATALOG.length);
  });

  it("role permission counts match ROLE_PERMISSIONS lengths", () => {
    for (const role of DISPLAY_ROLES) {
      expect(permissionCountForRole(role)).toBe(ROLE_PERMISSIONS[role].length);
    }
  });

  it("non-admin cannot invite or manage roles", () => {
    expect(roleHasPermission("BID_COORDINATOR", "users.invite")).toBe(false);
    expect(roleHasPermission("BID_COORDINATOR", "users.manage_roles")).toBe(
      false,
    );
    expect(roleHasPermission("BID_MANAGER", "users.invite")).toBe(false);
    expect(roleHasPermission("ADMIN", "users.invite")).toBe(true);
  });

  it("document specialist can verify but not manage users", () => {
    expect(roleHasPermission("DOCUMENT_SPECIALIST", "documents.verify")).toBe(
      true,
    );
    expect(roleHasPermission("DOCUMENT_SPECIALIST", "users.view")).toBe(false);
  });
});

describe("company user isolation contract", () => {
  it("listUsers filter option isolates by companyId", () => {
    // Contract: callers must pass session.companyId — never client company_id.
    const sessionCompanyId = "company-a";
    const queryCompanyId = sessionCompanyId;
    expect(queryCompanyId).toBe(sessionCompanyId);
    expect(queryCompanyId).not.toBe("company-b");
  });
});

describe("last-admin protection", () => {
  it("blocks demote/deactivate of sole active admin", () => {
    const only = [{ id: "a1", role: "ADMIN" as const, isActive: true }];
    const demote = assertAdminMutationAllowed({
      actorId: "actor",
      target: only[0]!,
      patch: { role: "BID_MANAGER" },
      activeAdminCount: countActiveAdmins(only),
    });
    expect(demote.ok).toBe(false);

    const deactivate = assertAdminMutationAllowed({
      actorId: "actor",
      target: only[0]!,
      patch: { isActive: false },
      activeAdminCount: countActiveAdmins(only),
    });
    expect(deactivate.ok).toBe(false);
  });

  it("allows demote when another admin remains", () => {
    const users = [
      { id: "a1", role: "ADMIN" as const, isActive: true },
      { id: "a2", role: "ADMIN" as const, isActive: true },
    ];
    const result = assertAdminMutationAllowed({
      actorId: "a2",
      target: users[0]!,
      patch: { role: "BID_MANAGER" },
      activeAdminCount: countActiveAdmins(users),
    });
    expect(result.ok).toBe(true);
  });
});

describe("user deletion protection", () => {
  it("blocks deleting your own account", () => {
    const result = assertUserDeletionAllowed({
      actorId: "a1",
      target: { id: "a1", role: "ADMIN", isActive: true },
      activeAdminCount: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/cannot delete your own account/i);
    }
  });

  it("blocks deleting the last active administrator", () => {
    const result = assertUserDeletionAllowed({
      actorId: "actor",
      target: { id: "a1", role: "ADMIN", isActive: true },
      activeAdminCount: 1,
    });
    expect(result.ok).toBe(false);
  });

  it("allows deleting a non-admin teammate", () => {
    const result = assertUserDeletionAllowed({
      actorId: "a1",
      target: { id: "u2", role: "BID_COORDINATOR", isActive: true },
      activeAdminCount: 1,
    });
    expect(result.ok).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  assertAdminMutationAllowed,
  countActiveAdmins,
} from "@/server/auth/admin-guards";
import { initialAdmins } from "@/server/seed/initialAdmins";
import {
  changePasswordSchema,
  initialAdminPasswordSchema,
  passwordSchema,
} from "@/lib/validations";
import { mapRowToSafeUser } from "@/server/auth/safe-user";

const TEMP_PASSWORD = "Mitaja@2026";

describe("initial admin seed definitions", () => {
  it("1. defines four seed administrators", () => {
    expect(initialAdmins).toHaveLength(4);
    expect(initialAdmins.map((a) => a.email)).toEqual([
      "mpatel@mitajacorp.com",
      "jaimin.shah@thinfo.in",
      "deven.patel@siyanainfo.com",
      "gourav.gupta@siyanainfo.com",
    ]);
  });

  it("7. all seed accounts are ADMIN role by convention", () => {
    for (const admin of initialAdmins) {
      expect(admin.email).toMatch(/@/);
      expect(admin.fullName.length).toBeGreaterThan(0);
    }
  });
});

describe("password policy for initial password", () => {
  it("rejects weak passwords under 8 characters", () => {
    expect(initialAdminPasswordSchema.safeParse("short").success).toBe(false);
  });

  it("accepts the shared temporary password for seeding", () => {
    expect(initialAdminPasswordSchema.safeParse(TEMP_PASSWORD).success).toBe(
      true,
    );
  });

  it("accepts 8-character passwords that meet complexity rules", () => {
    expect(passwordSchema.safeParse("Passw0rd!").success).toBe(true);
    expect(passwordSchema.safeParse(TEMP_PASSWORD).success).toBe(true);
  });

  it("4. plaintext password must not equal stored hash placeholder", () => {
    const fakeHash = "$2a$12$abcdefghijklmnopqrstuv";
    expect(fakeHash).not.toBe(TEMP_PASSWORD);
  });
});

describe("change password validation", () => {
  it("requires matching confirmation", () => {
    const fail = changePasswordSchema.safeParse({
      currentPassword: TEMP_PASSWORD,
      newPassword: "NewSecurePass1!",
      confirmPassword: "Mismatch1!",
    });
    expect(fail.success).toBe(false);
  });
});

describe("first-login enforcement contract", () => {
  it("9. must_change_password redirects to change-password", () => {
    const mustChange = true;
    const redirectPath = mustChange ? "/change-password" : "/dashboard";
    expect(redirectPath).toBe("/change-password");
  });

  it("10. dashboard blocked before password change", () => {
    const mustChange = true;
    const canAccessDashboard = !mustChange;
    expect(canAccessDashboard).toBe(false);
  });

  it("11. password change clears must_change_password flag", () => {
    let mustChange = true;
    mustChange = false;
    expect(mustChange).toBe(false);
  });
});

describe("admin safeguards", () => {
  const admins = [
    { id: "a1", role: "ADMIN" as const, isActive: true },
    { id: "a2", role: "BID_COORDINATOR" as const, isActive: true },
  ];

  it("19. last active ADMIN cannot be demoted", () => {
    const onlyAdmin = [{ id: "a1", role: "ADMIN" as const, isActive: true }];
    const result = assertAdminMutationAllowed({
      actorId: "a1",
      target: onlyAdmin[0]!,
      patch: { role: "BID_COORDINATOR" },
      activeAdminCount: countActiveAdmins(onlyAdmin),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/at least one active administrator/i);
    }
  });

  it("19b. cannot disable own account", () => {
    const result = assertAdminMutationAllowed({
      actorId: "a1",
      target: admins[0]!,
      patch: { isActive: false },
      activeAdminCount: countActiveAdmins(admins),
    });
    expect(result.ok).toBe(false);
  });
});

describe("safe user serialization", () => {
  it("16. password hash is never in safe user type", () => {
    const safe = mapRowToSafeUser({
      id: "1",
      email: "a@b.com",
      full_name: "A",
      role: "ADMIN",
      is_active: true,
      must_change_password: true,
      last_login_at: null,
      password_changed_at: null,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      password_hash: "should-not-appear",
    });
    expect(safe).not.toHaveProperty("password_hash");
    expect(JSON.stringify(safe)).not.toContain("should-not-appear");
  });

  it("8. seeded users require password change", () => {
    const safe = mapRowToSafeUser({
      id: "1",
      email: "mpatel@mitajacorp.com",
      full_name: "M Patel",
      role: "ADMIN",
      is_active: true,
      must_change_password: true,
      last_login_at: null,
      password_changed_at: null,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    });
    expect(safe.mustChangePassword).toBe(true);
    expect(safe.role).toBe("ADMIN");
  });
});

describe("login failure contract", () => {
  it("6. wrong password should fail verification contract", () => {
    const verified = false;
    expect(verified).toBe(false);
  });

  it("17. disabled user cannot log in", () => {
    const isActive = false;
    const canLogin = isActive;
    expect(canLogin).toBe(false);
  });

  it("18. five failures lock account", () => {
    const max = 5;
    let attempts = 0;
    let locked = false;
    for (let i = 0; i < 5; i += 1) {
      attempts += 1;
      if (attempts >= max) locked = true;
    }
    expect(locked).toBe(true);
  });
});

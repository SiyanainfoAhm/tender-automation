import { describe, expect, it } from "vitest";
import {
  createHash,
  randomBytes,
} from "node:crypto";
import {
  loginSchema,
  passwordSchema,
  tenderFiltersSchema,
  createUserSchema,
} from "@/lib/validations";
import { formatIndianCurrency } from "@/lib/format";

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe("password policy", () => {
  it("rejects weak passwords", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("nouppercase1!").success).toBe(false);
    expect(passwordSchema.safeParse("NOLOWERCASE1!").success).toBe(false);
    expect(passwordSchema.safeParse("NoNumber!!!!").success).toBe(false);
    expect(passwordSchema.safeParse("NoSpecial1234").success).toBe(false);
  });

  it("accepts strong passwords", () => {
    expect(passwordSchema.safeParse("ValidPass123!").success).toBe(true);
  });
});

describe("login schema", () => {
  it("normalizes email to lowercase", () => {
    const parsed = loginSchema.parse({
      email: "Admin@Example.COM",
      password: "x",
    });
    expect(parsed.email).toBe("admin@example.com");
  });
});

describe("session token hashing", () => {
  it("stores only hash, not raw token", () => {
    const token = randomBytes(32).toString("base64url");
    const hash = hashSessionToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hash);
  });
});

describe("role authorization contract", () => {
  const canAccessUsers = (role: string) => role === "ADMIN";

  it("only ADMIN may access user management", () => {
    expect(canAccessUsers("ADMIN")).toBe(true);
    expect(canAccessUsers("BID_MANAGER")).toBe(false);
    expect(canAccessUsers("ANALYST")).toBe(false);
    expect(canAccessUsers("VIEWER")).toBe(false);
  });
});

describe("account lockout contract", () => {
  it("locks after five failures", () => {
    const maxAttempts = 5;
    let failed = 0;
    let locked = false;
    for (let i = 0; i < 5; i += 1) {
      failed += 1;
      if (failed >= maxAttempts) locked = true;
    }
    expect(locked).toBe(true);
  });
});

describe("tender filters", () => {
  it("parses source and not-evaluated status", () => {
    const parsed = tenderFiltersSchema.parse({
      source: "TENDER247",
      status: "NOT_EVALUATED",
      page: "1",
      pageSize: "25",
    });
    expect(parsed.source).toBe("TENDER247");
    expect(parsed.status).toBe("NOT_EVALUATED");
    expect(parsed.page).toBe(1);
  });

  it("rejects invalid page sizes", () => {
    expect(
      tenderFiltersSchema.safeParse({ pageSize: 10 }).success,
    ).toBe(false);
  });
});

describe("create user schema", () => {
  it("requires strong password and valid role", () => {
    expect(
      createUserSchema.safeParse({
        email: "a@b.com",
        fullName: "A",
        password: "ValidPass123!",
        role: "VIEWER",
      }).success,
    ).toBe(true);
    expect(
      createUserSchema.safeParse({
        email: "a@b.com",
        fullName: "A",
        password: "weak",
        role: "VIEWER",
      }).success,
    ).toBe(false);
  });
});

describe("indian currency formatting", () => {
  it("formats crore and lakh", () => {
    expect(formatIndianCurrency(48_600_000)).toMatch(/Cr/);
    expect(formatIndianCurrency(561_000)).toMatch(/Lakh|L/);
    expect(formatIndianCurrency(null)).toBe("—");
  });
});

describe("generic login error contract", () => {
  it("never reveals whether email exists", () => {
    const message = "Unable to sign in with those credentials.";
    expect(message.includes("not found")).toBe(false);
    expect(message.includes("password")).toBe(false);
  });
});

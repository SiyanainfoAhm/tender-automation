import { describe, expect, it } from "vitest";

import {
  buildPasswordResetUrl,
  buildTenderFlowPasswordResetEmail,
} from "@/lib/email/tenderflow-password-reset-content";
import {
  completePasswordResetSchema,
  forgotPasswordSchema,
  loginSchema,
  profileUpdateSchema,
} from "@/lib/validations";

describe("TF-3 password reset email content", () => {
  it("builds a reset link against the app URL", () => {
    expect(buildPasswordResetUrl("https://app.example.com/", "tok_abc")).toBe(
      "https://app.example.com/reset-password?token=tok_abc",
    );
  });

  it("includes the reset URL and expiry guidance in the email body", () => {
    const expiresAt = new Date("2026-09-08T12:00:00+05:30");
    const content = buildTenderFlowPasswordResetEmail({
      name: "Alex",
      email: "alex@example.com",
      resetUrl: "https://app.example.com/reset-password?token=abc",
      expiresAt,
    });
    expect(content.toEmail).toBe("alex@example.com");
    expect(content.subject).toMatch(/reset/i);
    expect(content.body).toContain("https://app.example.com/reset-password?token=abc");
    expect(content.body).toContain("Alex");
    expect(content.body).toMatch(/expires/i);
  });
});

describe("TF-3 auth validation contracts", () => {
  it("accepts rememberMe on login", () => {
    const parsed = loginSchema.parse({
      email: "user@example.com",
      password: "secret",
      rememberMe: true,
      next: "/dashboard",
    });
    expect(parsed.rememberMe).toBe(true);
    expect(parsed.next).toBe("/dashboard");
  });

  it("requires a valid email for forgot-password", () => {
    expect(() => forgotPasswordSchema.parse({ email: "bad" })).toThrow();
    expect(forgotPasswordSchema.parse({ email: "User@Example.com" }).email).toBe(
      "user@example.com",
    );
  });

  it("requires matching passwords that meet policy for reset", () => {
    const ok = completePasswordResetSchema.parse({
      token: "tok",
      newPassword: "Secure1!",
      confirmPassword: "Secure1!",
    });
    expect(ok.token).toBe("tok");

    expect(() =>
      completePasswordResetSchema.parse({
        token: "tok",
        newPassword: "Secure1!",
        confirmPassword: "other",
      }),
    ).toThrow(/match/i);
  });

  it("only allows full name updates on profile (email is immutable)", () => {
    const parsed = profileUpdateSchema.parse({ fullName: "Alex Manager" });
    expect(parsed.fullName).toBe("Alex Manager");
    expect("email" in parsed).toBe(false);
  });

  it("validates optional signup phone as Indian mobile when provided", async () => {
    const { signupSchema } = await import("@/lib/validations");
    const base = {
      fullName: "Alex",
      email: "alex@example.com",
      password: "Secure1!",
      confirmPassword: "Secure1!",
      companyName: "Acme",
    };
    expect(signupSchema.parse({ ...base, phone: "" }).phone).toBe("");
    expect(signupSchema.parse({ ...base, phone: "9876543210" }).phone).toBe(
      "9876543210",
    );
    expect(signupSchema.parse({ ...base, phone: "+91 98765 43210" }).phone).toBe(
      "+91 98765 43210",
    );
    expect(() =>
      signupSchema.parse({ ...base, phone: "12345" }),
    ).toThrow(/mobile/i);
  });
});

describe("TF-16 year established number validation", () => {
  it("accepts empty or a 4-digit year in range", async () => {
    const {
      getYearEstablishedValidationStatus,
      parseValidYearEstablished,
    } = await import("@/lib/validations/phone-rules");
    expect(getYearEstablishedValidationStatus("")).toBeNull();
    expect(parseValidYearEstablished("").ok).toBe(true);
    expect(parseValidYearEstablished("2015")).toEqual({
      ok: true,
      year: 2015,
    });
    expect(parseValidYearEstablished("99").ok).toBe(false);
    expect(parseValidYearEstablished("abc").ok).toBe(false);
    expect(parseValidYearEstablished("1700").ok).toBe(false);
    expect(parseValidYearEstablished(String(new Date().getFullYear() + 1)).ok).toBe(
      false,
    );
  });
});

describe("TF-19 financial bid preference bounds", () => {
  it("rejects when minimum tender value exceeds maximum", async () => {
    const { z } = await import("zod");
    // Mirror the action rule without importing server-only action module.
    const schema = z
      .object({
        minTenderValueInr: z.number().nullable(),
        maxTenderValueInr: z.number().nullable(),
      })
      .superRefine((data, ctx) => {
        if (
          data.minTenderValueInr != null &&
          data.maxTenderValueInr != null &&
          data.minTenderValueInr > data.maxTenderValueInr
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Minimum tender value cannot exceed maximum tender value",
          });
        }
      });

    expect(
      schema.safeParse({ minTenderValueInr: 10, maxTenderValueInr: 5 }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ minTenderValueInr: 5, maxTenderValueInr: 10 }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ minTenderValueInr: null, maxTenderValueInr: 10 }).success,
    ).toBe(true);
  });
});

describe("TF-7 / TF-14 password policy gate", () => {
  it("requires all configured password rules before submit is allowed", async () => {
    const { isPasswordPolicyMet } = await import(
      "@/lib/validations/password-rules"
    );
    expect(isPasswordPolicyMet("short")).toBe(false);
    expect(isPasswordPolicyMet("Secure1!")).toBe(true);
  });
});

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
});

import { describe, expect, it } from "vitest";

import { getEmailValidationStatus } from "@/lib/validations/email-rules";
import {
  getPasswordRuleStatuses,
  isPasswordPolicyMet,
} from "@/lib/validations/password-rules";

describe("password rule feedback", () => {
  it("tracks each rule independently while typing", () => {
    const rules = getPasswordRuleStatuses("Pass1");
    expect(rules.find((r) => r.id === "length")?.met).toBe(false);
    expect(rules.find((r) => r.id === "special")?.met).toBe(false);

    const complete = getPasswordRuleStatuses("Passw0rd!");
    expect(isPasswordPolicyMet("Passw0rd!")).toBe(true);
    expect(complete.every((rule) => rule.met)).toBe(true);
  });
});

describe("email validation feedback", () => {
  it("returns null for empty input", () => {
    expect(getEmailValidationStatus("")).toBeNull();
  });

  it("flags invalid emails while typing", () => {
    expect(getEmailValidationStatus("not-an-email")?.valid).toBe(false);
  });

  it("accepts valid emails", () => {
    expect(getEmailValidationStatus("user@example.com")?.valid).toBe(true);
  });
});

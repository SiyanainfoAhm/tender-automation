import { describe, expect, it } from "vitest";

import {
  detectPhoneCountry,
  formatInternationalPhone,
  getPhoneValidationStatus,
  isOptionalPhoneValidAnyCountry,
  isValidIndianMobile,
  isValidUsPhone,
  nationalPhoneDigits,
} from "@/lib/validations/phone-rules";

describe("phone country rules", () => {
  it("validates India and US national numbers", () => {
    expect(isValidIndianMobile("9876543210")).toBe(true);
    expect(isValidIndianMobile("+91 98765 43210")).toBe(true);
    expect(isValidIndianMobile("1234567890")).toBe(false);
    expect(isValidUsPhone("2025550123")).toBe(true);
    expect(isValidUsPhone("+1 2025550123")).toBe(true);
    expect(isValidUsPhone("20255")).toBe(false);
  });

  it("formats international values from country + national digits", () => {
    expect(formatInternationalPhone("9876543210", "IN")).toBe("+91 9876543210");
    expect(formatInternationalPhone("2025550123", "US")).toBe("+1 2025550123");
    expect(formatInternationalPhone("", "IN")).toBe("");
  });

  it("detects country from stored values", () => {
    expect(detectPhoneCountry("+1 2025550123")).toBe("US");
    expect(detectPhoneCountry("+91 9876543210")).toBe("IN");
    expect(detectPhoneCountry("")).toBe("IN");
  });

  it("accepts either country for optional server validation", () => {
    expect(isOptionalPhoneValidAnyCountry("")).toBe(true);
    expect(isOptionalPhoneValidAnyCountry("+91 9876543210")).toBe(true);
    expect(isOptionalPhoneValidAnyCountry("+1 2025550123")).toBe(true);
    expect(isOptionalPhoneValidAnyCountry("12")).toBe(false);
  });

  it("strips country prefixes when editing national digits", () => {
    expect(nationalPhoneDigits("+91 98765 43210", "IN")).toBe("9876543210");
    expect(nationalPhoneDigits("+1 2025550123", "US")).toBe("2025550123");
  });

  it("returns live validation hints per country", () => {
    expect(getPhoneValidationStatus("9876543210", "IN")?.valid).toBe(true);
    expect(getPhoneValidationStatus("2025550123", "US")?.valid).toBe(true);
    expect(getPhoneValidationStatus("123", "US")?.valid).toBe(false);
  });
});

/**
 * Shared phone validation for signup / company registration.
 * Supports India (+91) and United States (+1) with national number checks.
 */

export type PhoneCountryCode = "IN" | "US";

export type PhoneCountryOption = {
  code: PhoneCountryCode;
  dial: string;
  label: string;
  /** Unicode flag emoji */
  flag: string;
  placeholder: string;
  maxNationalDigits: number;
};

export const PHONE_COUNTRIES: PhoneCountryOption[] = [
  {
    code: "IN",
    dial: "+91",
    label: "India",
    flag: "🇮🇳",
    placeholder: "98765 43210",
    maxNationalDigits: 10,
  },
  {
    code: "US",
    dial: "+1",
    label: "United States",
    flag: "🇺🇸",
    placeholder: "202 555 0123",
    maxNationalDigits: 10,
  },
];

export function getPhoneCountry(
  code: PhoneCountryCode | string | null | undefined,
): PhoneCountryOption {
  return (
    PHONE_COUNTRIES.find((c) => c.code === code) || PHONE_COUNTRIES[0]!
  );
}

export function digitsOnlyPhone(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

/** Strip known country prefixes and return national digits. */
export function nationalPhoneDigits(
  value: string,
  country: PhoneCountryCode = "IN",
): string {
  let digits = digitsOnlyPhone(value);
  if (country === "IN") {
    if (digits.length === 12 && digits.startsWith("91")) {
      digits = digits.slice(2);
    } else if (digits.length === 11 && digits.startsWith("0")) {
      digits = digits.slice(1);
    }
  } else if (country === "US") {
    if (digits.length === 11 && digits.startsWith("1")) {
      digits = digits.slice(1);
    }
  }
  return digits;
}

/** True for 10-digit Indian mobiles; also accepts +91 / 0 prefixes. */
export function isValidIndianMobile(value: string): boolean {
  const digits = nationalPhoneDigits(value, "IN");
  return /^[6-9]\d{9}$/.test(digits);
}

/** True for 10-digit US numbers; also accepts +1 prefix. */
export function isValidUsPhone(value: string): boolean {
  const digits = nationalPhoneDigits(value, "US");
  return /^\d{10}$/.test(digits);
}

export function isValidPhoneForCountry(
  value: string,
  country: PhoneCountryCode,
): boolean {
  if (country === "US") return isValidUsPhone(value);
  return isValidIndianMobile(value);
}

/**
 * Format for storage / form submit: "+91 9876543210" or "+1 2025550123".
 * Empty national digits → empty string.
 */
export function formatInternationalPhone(
  national: string,
  country: PhoneCountryCode,
): string {
  const digits = nationalPhoneDigits(national, country);
  if (!digits) return "";
  const meta = getPhoneCountry(country);
  return `${meta.dial} ${digits}`;
}

/**
 * Infer country from a stored phone string when possible.
 * Defaults to India (product default).
 */
export function detectPhoneCountry(value: string): PhoneCountryCode {
  const trimmed = value.trim();
  if (!trimmed) return "IN";
  const digits = digitsOnlyPhone(trimmed);
  if (trimmed.startsWith("+1") || (digits.length === 11 && digits.startsWith("1"))) {
    // Avoid classifying Indian +91 as US: +91 starts with +9
    if (!trimmed.startsWith("+91") && !digits.startsWith("91")) {
      return "US";
    }
  }
  if (trimmed.startsWith("+91") || digits.startsWith("91")) return "IN";
  return "IN";
}

export type PhoneValidationStatus = {
  valid: boolean;
  message: string;
};

/** Live hint for optional phone fields — null while empty. */
export function getPhoneValidationStatus(
  value: string,
  country: PhoneCountryCode = "IN",
): PhoneValidationStatus | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const valid = isValidPhoneForCountry(trimmed, country);
  if (country === "US") {
    return {
      valid,
      message: valid
        ? "Valid US phone number"
        : "Enter a valid 10-digit US phone number",
    };
  }
  return {
    valid,
    message: valid
      ? "Valid mobile number"
      : "Enter a valid 10-digit mobile number",
  };
}

/** Optional phone: empty OK; non-empty must be valid for the country. */
export function isOptionalPhoneValid(
  value: string,
  country: PhoneCountryCode = "IN",
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  // Accept either IN or US when country omitted / unknown stored value
  if (country === "IN" || country === "US") {
    return isValidPhoneForCountry(trimmed, country);
  }
  return isValidIndianMobile(trimmed) || isValidUsPhone(trimmed);
}

/**
 * Server-side optional phone check when country is not posted separately.
 * Accepts empty, Indian, or US formats.
 */
export function isOptionalPhoneValidAnyCountry(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return isValidIndianMobile(trimmed) || isValidUsPhone(trimmed);
}

const CURRENT_YEAR = () => new Date().getFullYear();

export type YearValidationStatus = {
  valid: boolean;
  message: string;
};

/** Live hint for optional year established — null while empty. */
export function getYearEstablishedValidationStatus(
  value: string,
): YearValidationStatus | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}$/.test(trimmed)) {
    return { valid: false, message: "Enter a valid 4-digit year" };
  }
  const year = Number.parseInt(trimmed, 10);
  const max = CURRENT_YEAR();
  if (year < 1800 || year > max) {
    return {
      valid: false,
      message: `Year must be between 1800 and ${max}`,
    };
  }
  return { valid: true, message: "Valid year" };
}

export function parseValidYearEstablished(
  value: string,
): { ok: true; year: number | null } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, year: null };
  const status = getYearEstablishedValidationStatus(trimmed);
  if (!status?.valid) {
    return {
      ok: false,
      message: status?.message || "Enter a valid year",
    };
  }
  return { ok: true, year: Number.parseInt(trimmed, 10) };
}

/**
 * Shared Indian mobile validation used by signup/company registration
 * and Past Experience contacts (TF-46).
 */

export function digitsOnlyPhone(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

/** True for 10-digit Indian mobiles; also accepts +91 / 0 prefixes. */
export function isValidIndianMobile(value: string): boolean {
  const digits = digitsOnlyPhone(value);
  if (digits.length === 12 && digits.startsWith("91")) {
    return /^[6-9]\d{9}$/.test(digits.slice(2));
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return /^[6-9]\d{9}$/.test(digits.slice(1));
  }
  return /^[6-9]\d{9}$/.test(digits);
}

export type PhoneValidationStatus = {
  valid: boolean;
  message: string;
};

/** Live hint for optional phone fields — null while empty. */
export function getPhoneValidationStatus(
  value: string,
): PhoneValidationStatus | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const valid = isValidIndianMobile(trimmed);
  return {
    valid,
    message: valid
      ? "Valid mobile number"
      : "Enter a valid 10-digit mobile number",
  };
}

/** Optional phone: empty OK; non-empty must be a valid Indian mobile. */
export function isOptionalPhoneValid(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return isValidIndianMobile(trimmed);
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

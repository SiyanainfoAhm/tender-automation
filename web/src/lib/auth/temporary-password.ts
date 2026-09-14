import { passwordSchema } from "@/lib/validations";

/**
 * TF-25: Temporary password = first 4 characters of company name + @ + DDMM.
 * Example: Siyana + 07-09-2026 → Siya@0709
 */
export function generateCompanyTemporaryPassword(
  companyName: string,
  invitationDate: Date = new Date(),
): string {
  const letters = companyName.replace(/[^A-Za-z]/g, "");
  const prefixRaw = (letters || "User").slice(0, 4);
  const prefix =
    prefixRaw.length >= 4
      ? prefixRaw[0]!.toUpperCase() + prefixRaw.slice(1).toLowerCase()
      : (prefixRaw[0]!.toUpperCase() + (prefixRaw.slice(1) + "xxxx").slice(0, 3)).slice(
          0,
          4,
        );
  const dd = String(invitationDate.getDate()).padStart(2, "0");
  const mm = String(invitationDate.getMonth() + 1).padStart(2, "0");
  const password = `${prefix}@${dd}${mm}`;
  if (!passwordSchema.safeParse(password).success) {
    // Ensure policy compliance for short company names by padding lowers.
    const padded = `${prefix.padEnd(4, "x")}@${dd}${mm}`;
    if (passwordSchema.safeParse(padded).success) return padded;
  }
  return password;
}

/** @deprecated Prefer generateCompanyTemporaryPassword for invites (TF-25). */
export function generateTemporaryPassword(
  companyName = "User",
  invitationDate?: Date,
): string {
  return generateCompanyTemporaryPassword(companyName, invitationDate);
}

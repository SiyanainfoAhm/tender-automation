/**
 * Seeded Siyana company UUID — same value as web/src/lib/company/types.ts.
 * Crawler cannot import Next.js app code.
 */
export const SIYANA_COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

export function resolveRunCompanyId(): string {
  const fromEnv = process.env.COMPANY_ID?.trim() || process.env.SIYANA_COMPANY_ID?.trim();
  return fromEnv || SIYANA_COMPANY_ID;
}

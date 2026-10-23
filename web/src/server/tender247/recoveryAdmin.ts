export const recoveryOutcomeFilters = ["", "SOURCE_EMPTY", "SOURCE_INVALID", "SOURCE_UNAVAILABLE", "RETRY_PENDING", "UPLOAD_FAILED", "INTERNAL_FAILED", "COMPLETED", "RECONCILED"] as const;

export function recoveryFilter(value: string | undefined): string {
  return recoveryOutcomeFilters.includes((value || "") as typeof recoveryOutcomeFilters[number]) ? value || "" : "";
}

export function recoveryPage(value: string | undefined): number {
  const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function canAccessRecoveryCompany(sessionCompanyId: string | null | undefined, rowCompanyId: string | null | undefined): boolean {
  return Boolean(sessionCompanyId && rowCompanyId && sessionCompanyId === rowCompanyId);
}

export function canManuallyRetry(status: string | null | undefined): boolean {
  return Boolean(status && !["COMPLETED", "RECONCILED"].includes(status));
}

import { TENDER_STATUSES } from "@/lib/tender-status";

function emptyStatusMap(): Record<string, number> {
  return Object.fromEntries([
    ...TENDER_STATUSES.map((k) => [k, 0]),
    ["NOT_EVALUATED", 0],
  ]);
}

export function aggregateStatusCounts(
  rows: { effective_qualification_status: string | null }[],
): Record<string, number> {
  const byStatus = emptyStatusMap();
  for (const row of rows) {
    const key = row.effective_qualification_status || "NOT_EVALUATED";
    byStatus[key] = (byStatus[key] || 0) + 1;
  }
  return byStatus;
}

export function aggregateSourceCounts(
  rows: { source_portal: string }[],
): Record<string, number> {
  const bySource: Record<string, number> = {
    TENDER247: 0,
    BIDASSIST: 0,
    MANUAL: 0,
  };
  for (const row of rows) {
    bySource[row.source_portal] = (bySource[row.source_portal] || 0) + 1;
  }
  return bySource;
}

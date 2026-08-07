/**
 * Asia/Kolkata calendar-day bounds for timestamptz queries.
 * Kolkata is UTC+05:30 year-round (no DST).
 */
export function addOneCalendarDay(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  utc.setUTCDate(utc.getUTCDate() + 1);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function asiaKolkataDayBounds(dateIso: string): {
  startUtc: string;
  endUtcExclusive: string;
  startLocal: string;
  endLocalExclusive: string;
} {
  const next = addOneCalendarDay(dateIso);
  return {
    startLocal: `${dateIso}T00:00:00+05:30`,
    endLocalExclusive: `${next}T00:00:00+05:30`,
    startUtc: new Date(`${dateIso}T00:00:00+05:30`).toISOString(),
    endUtcExclusive: new Date(`${next}T00:00:00+05:30`).toISOString(),
  };
}

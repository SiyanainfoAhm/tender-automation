/** Local system date helpers (Windows-friendly, no UTC conversion). */

export function getLocalDateParts(date: Date = new Date()): {
  year: string;
  month: string;
  day: string;
  hours: string;
  minutes: string;
  seconds: string;
} {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return {
    year: String(date.getFullYear()),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
    hours: pad(date.getHours()),
    minutes: pad(date.getMinutes()),
    seconds: pad(date.getSeconds()),
  };
}

/** YYYY-MM-DD using local system date */
export function getTodayIsoDate(date: Date = new Date()): string {
  const { year, month, day } = getLocalDateParts(date);
  return `${year}-${month}-${day}`;
}

/** DD-MM-YYYY using local system date (Tender247 dashboard card format). */
export function getTodayDisplayDateDdMmYyyy(date: Date = new Date()): string {
  const { year, month, day } = getLocalDateParts(date);
  return `${day}-${month}-${year}`;
}

/** Compact timestamp for screenshot filenames: YYYY-MM-DD_HH-MM-SS */
export function getLocalTimestamp(date: Date = new Date()): string {
  const { year, month, day, hours, minutes, seconds } = getLocalDateParts(date);
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rem = (seconds % 60).toFixed(0);
  return `${minutes}m ${rem}s`;
}

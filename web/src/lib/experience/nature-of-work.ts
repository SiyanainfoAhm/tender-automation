export const NATURE_OF_WORK_OPTIONS = [
  "Software Development",
  "Web Application",
  "Website Development",
  "Mobile Application",
  "ERP / HRMS",
  "AI / Automation",
  "Cloud Services",
  "IT Infrastructure",
  "Cybersecurity",
  "System Integration",
  "GIS",
  "Data Center / Infrastructure",
  "Other",
] as const;

export type NatureOfWork = (typeof NATURE_OF_WORK_OPTIONS)[number];

export function isNatureOfWork(value: string): value is NatureOfWork {
  return (NATURE_OF_WORK_OPTIONS as readonly string[]).includes(value);
}

/** Normalize DB / form values into a string array (legacy single string supported). */
export function parseNatureOfWorkList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item ?? "").trim())
          .filter(Boolean);
      }
    } catch {
      // fall through to comma / single-value parsing
    }
  }
  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [trimmed];
}

export function formatNatureOfWorkList(values: string[] | string | null | undefined): string {
  const list = Array.isArray(values)
    ? values
    : parseNatureOfWorkList(values ?? "");
  return list.join(", ");
}

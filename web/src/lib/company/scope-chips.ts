/**
 * Shared Service Scope / Excluded Scope chip helpers.
 * Screening semantics stay separate: service = include, excluded = reject.
 */

export const MAX_SCOPE_LABEL_LENGTH = 80;

export const DEFAULT_SERVICE_SCOPE_SUGGESTIONS = [
  "Information Technology",
  "Software Development",
  "System Integration",
  "Networking",
  "Cloud Services",
  "Cybersecurity",
] as const;

/** Defaults for Excluded Scope chips when no central screening option list exists. */
export const DEFAULT_EXCLUDED_SCOPE_SUGGESTIONS = [
  "NON-IT",
  "Hardware Only",
  "Scanning / Digitization",
  "EOI / Empanelment",
  "Internet / Connectivity Service",
  "Pure Manpower Supply",
  "Civil / Construction",
  "Electrical Works",
  "Medical Equipment",
  "Vehicle / Transport",
  "Printing / Stationery",
  "Other Non-IT",
] as const;

export function normalizeScopeValue(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function findScopeMatch(
  value: string,
  items: readonly string[],
): string | undefined {
  const needle = normalizeScopeValue(value).toLowerCase();
  if (!needle) return undefined;
  return items.find((item) => item.toLowerCase() === needle);
}

export function dedupeScopeValues(items: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const normalized = normalizeScopeValue(item);
    if (!normalized) continue;
    if (!findScopeMatch(normalized, out)) {
      out.push(normalized.slice(0, MAX_SCOPE_LABEL_LENGTH));
    }
  }
  return out;
}

export function mergeScopeOptions(
  defaults: readonly string[],
  selected: readonly string[],
): string[] {
  return dedupeScopeValues([...defaults, ...selected]);
}

export function parseStoredScopeList(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return dedupeScopeValues(raw.map((item) => String(item)));
  }
  if (typeof raw !== "string") return [];

  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) || typeof parsed === "string") {
        return parseStoredScopeList(parsed);
      }
    } catch {
      // Fall through to delimiter split.
    }
  }

  return dedupeScopeValues(trimmed.split(/[\n,;|]/));
}

export function addAndSelectOption(
  rawValue: string,
  options: readonly string[],
  selected: readonly string[],
): { options: string[]; selected: string[] } {
  let value = normalizeScopeValue(rawValue);
  if (!value) {
    return { options: [...options], selected: [...selected] };
  }
  value = value.slice(0, MAX_SCOPE_LABEL_LENGTH);

  const existingOption = findScopeMatch(value, options);
  const normalized = existingOption ?? value;
  const nextOptions = existingOption
    ? [...options]
    : [...options, normalized];

  const alreadySelected = findScopeMatch(normalized, selected);
  const nextSelected = alreadySelected
    ? [...selected]
    : [...selected, normalized];

  return { options: nextOptions, selected: nextSelected };
}

export function removeSelectedScope(
  value: string,
  selected: readonly string[],
): string[] {
  const match = findScopeMatch(value, selected);
  if (!match) return [...selected];
  return selected.filter((item) => item !== match);
}

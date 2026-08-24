/**
 * Normalize tender city/location for filters and persistence.
 * Rejects org/product/office strings; never uses title/brief/buyer as city.
 *
 * Keep in sync with: src/location/normalizeTenderCity.ts
 */

export type TenderCitySource = {
  city?: string | null;
  district?: string | null;
  state?: string | null;
  location?: string | null;
  locationText?: string | null;
  location_text?: string | null;
};

/** Indian states / UTs — valid as region labels, not as city dropdown values alone. */
const INDIAN_STATES = new Set(
  [
    "Andaman and Nicobar Islands",
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chandigarh",
    "Chhattisgarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Dadra and Nagar Haveli",
    "Daman and Diu",
    "Delhi",
    "NCT of Delhi",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jammu and Kashmir",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Ladakh",
    "Lakshadweep",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Orissa",
    "Puducherry",
    "Pondicherry",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "Uttaranchal",
    "West Bengal",
  ].map((s) => s.toLowerCase()),
);

/** Structural markers that indicate non-city text (not a per-tender blacklist). */
const NON_CITY_MARKER =
  /\b(products?\s*:|item\s*category|contract\s+for|processor|laptop|computer|desktop|server|printer|equipment|institute|university|college|mahavidyalaya|mahavidyalay|vidyalaya|polytechnic|school|hospital|police|custom\s*house|executive\s+engineer|department|ministry|division|sub[-\s]?division|corporation|authority|pvt\.?\s*ltd|private\s+limited|\bltd\b|limited|data\s*center|data\s*centre|thermal\s+power|power\s+station|airport|office\s+of|under\s+the\s+office|board\s+of|commissioner|directorate|municipal\s+corporation|nigam|parishad|samiti|tender|bid\s+for|supply\s+of|procurement)\b/i;

const MAX_CITY_CHARS = 48;
const MAX_CITY_WORDS = 4;

function collapseSpaces(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** Strip leading/trailing punctuation often left by scraped "Location :" labels. */
export function stripLocationDecorators(value: string): string {
  return collapseSpaces(
    value
      .replace(/^[:：\-\u2013\u2014\s]+/, "")
      .replace(/[:：\-\u2013\u2014\s]+$/, "")
      .replace(/^location\s*[:：\-]\s*/i, "")
      .replace(/^city\s*[:：\-]\s*/i, "")
      .replace(/^place\s*[:：\-]\s*/i, ""),
  );
}

function toDisplayCity(value: string): string {
  const small = new Set(["and", "of", "the", "da", "de"]);
  return value
    .split(" ")
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && small.has(lower)) return lower;
      // Preserve very short acronyms only (e.g. UK); title-case normal words.
      if (/^[A-Z]{2}$/.test(word)) return word;
      // Keep hyphenated parts title-cased (e.g. Navi-Mumbai rare; usually spaces).
      return word
        .split("-")
        .map((part) =>
          part
            ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
            : part,
        )
        .join("-");
    })
    .join(" ");
}

export function isIndianStateName(value: string | null | undefined): boolean {
  if (!value) return false;
  return INDIAN_STATES.has(collapseSpaces(value).toLowerCase());
}

function extractDistrict(value: string): string | null {
  const match = value.match(
    /\bdistrict\s*[:：]\s*([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})/i,
  );
  if (!match?.[1]) return null;
  return stripLocationDecorators(stripProductSuffix(match[1]));
}

function stripProductSuffix(value: string): string {
  return collapseSpaces(
    value.split(/\bproducts?\s*[:：]/i)[0] ?? value,
  );
}

function looksLikeNonCity(value: string): boolean {
  if (!value) return true;
  if (value.length > MAX_CITY_CHARS) return true;
  const words = value.split(" ").filter(Boolean);
  if (words.length > MAX_CITY_WORDS) return true;
  if (NON_CITY_MARKER.test(value)) return true;
  if (/[:：]/.test(value)) return true;
  if (/\d{3,}/.test(value)) return true;
  if (/[()]/.test(value)) return true;
  if (/[/\\|]/.test(value)) return true;
  // Mostly punctuation / empty after clean
  if (!/[A-Za-z]/.test(value)) return true;
  return false;
}

/**
 * Normalize a single raw location/city string into a clean city display value,
 * or null when no reliable geographic city can be derived.
 */
export function normalizeCityString(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  let value = stripLocationDecorators(String(raw));
  if (!value || /^(n\/?a|na|nil|none|null|undefined|-|—|–)$/i.test(value)) {
    return null;
  }

  // Cut product/category tails before any geographic parsing.
  value = stripProductSuffix(value);
  value = stripLocationDecorators(value);

  // Prefer explicit district when present in scraped blobs.
  const district = extractDistrict(value);
  if (district) {
    const fromDistrict = normalizeCityString(district);
    if (fromDistrict) return fromDistrict;
  }

  // "X District Police" → try place name X
  const districtPolice = value.match(
    /^([A-Za-z][A-Za-z .'-]{1,40}?)\s+district\s+police$/i,
  );
  if (districtPolice?.[1]) {
    return normalizeCityString(districtPolice[1]);
  }

  // Comma / pipe separated "City, State"
  if (/[,|]/.test(value)) {
    const first = stripLocationDecorators(
      value.split(/[,|]/)[0] ?? "",
    );
    return normalizeCityString(first);
  }

  // "Leh Ladakh" style region — allow; pure state names → null for city filter
  if (isIndianStateName(value)) {
    return null;
  }

  // "Kerala State ..." without other geo → reject via markers / length
  value = value.replace(/\bstate\b/gi, " ").replace(/\s+/g, " ").trim();
  value = stripLocationDecorators(value);

  if (looksLikeNonCity(value)) {
    return null;
  }

  const display = toDisplayCity(value);
  if (!display || isIndianStateName(display) || looksLikeNonCity(display)) {
    return null;
  }
  return display;
}

/**
 * Resolve a clean city from structured tender fields.
 * Priority: city → district → location_text/location → (state only if not a state name / parseable).
 */
export function normalizeTenderCity(
  input: string | TenderCitySource | null | undefined,
): string | null {
  if (input == null) return null;
  if (typeof input === "string") {
    return normalizeCityString(input);
  }

  const ordered: Array<string | null | undefined> = [
    input.city,
    input.district,
    input.location_text,
    input.locationText,
    input.location,
  ];

  for (const candidate of ordered) {
    const normalized = normalizeCityString(candidate);
    if (normalized) return normalized;
  }

  // State field sometimes incorrectly holds the full scraped location blob.
  if (input.state) {
    if (isIndianStateName(input.state)) return null;
    return normalizeCityString(input.state);
  }

  return null;
}

/** Case-insensitive dedupe preserving first display form (already title-cased). */
export function uniqueNormalizedCities(
  values: Iterable<string | null | undefined>,
): string[] {
  const byKey = new Map<string, string>();
  for (const raw of values) {
    const city = normalizeTenderCity(raw);
    if (!city) continue;
    const key = city.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, city);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

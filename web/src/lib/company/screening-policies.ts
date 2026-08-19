/**
 * Keep in sync with src/runScreening/screeningPolicy.ts
 * Stored in agenttender_company_bid_preferences.extras.screeningPolicies
 */
export const SCREENING_POLICY_VALUES = ["ALLOW", "VERIFY", "NO_BID"] as const;

export type ScreeningPolicy = (typeof SCREENING_POLICY_VALUES)[number];

export const SCREENING_POLICY_FIELDS = [
  { key: "sameDayDeadline", label: "Same-day closing tender" },
  { key: "expiredTender", label: "Expired tender" },
  { key: "eoi", label: "EOI" },
  { key: "empanelment", label: "Empanelment" },
  { key: "hardwareOnly", label: "Hardware-only procurement" },
  { key: "hardwareDominant", label: "Hardware-dominant delivery" },
  { key: "oemAuthorization", label: "OEM authorization dependency" },
  { key: "partnerDependency", label: "Partner dependency" },
  { key: "consortium", label: "Consortium" },
  { key: "jointVenture", label: "Joint venture" },
  { key: "gisSoftware", label: "GIS software/application" },
  { key: "gisFieldSurvey", label: "GIS field survey" },
  { key: "cybersecurityOnly", label: "Cybersecurity-only engagement" },
  { key: "cotsLicence", label: "COTS/software licence procurement" },
  { key: "softwareRenewal", label: "Software renewal/product AMC" },
  { key: "oemProductAmc", label: "OEM product AMC" },
  { key: "manpowerOnly", label: "Dedicated manpower supply" },
  { key: "manpowerHeavy", label: "Manpower-heavy delivery" },
  { key: "nonIt", label: "Clearly non-IT scope" },
  { key: "genericItTitle", label: "Generic IT title" },
  { key: "customSoftware", label: "Custom software development" },
] as const;

export type ScreeningPolicyKey = (typeof SCREENING_POLICY_FIELDS)[number]["key"];

export type ScreeningPolicies = Partial<Record<ScreeningPolicyKey, ScreeningPolicy>>;

export function parseScreeningPolicyValue(raw: unknown): ScreeningPolicy | undefined {
  if (raw == null || raw === "") return undefined;
  const normalized = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "ALLOW" || normalized === "VERIFY") return normalized;
  if (normalized === "NO_BID" || normalized === "NOBID") return "NO_BID";
  return undefined;
}

export function parseScreeningPolicies(
  extras: Record<string, unknown> | null | undefined,
): ScreeningPolicies {
  const source = extras && typeof extras === "object" ? extras : {};
  const nested =
    source.screeningPolicies &&
    typeof source.screeningPolicies === "object" &&
    !Array.isArray(source.screeningPolicies)
      ? (source.screeningPolicies as Record<string, unknown>)
      : {};
  const policies: ScreeningPolicies = {};
  for (const field of SCREENING_POLICY_FIELDS) {
    const parsed = parseScreeningPolicyValue(
      nested[field.key] ?? nested[`${field.key}Policy`] ?? source[`${field.key}Policy`] ?? source[field.key],
    );
    if (parsed) policies[field.key] = parsed;
  }
  return policies;
}

export function mergeScreeningPoliciesIntoExtras(
  extras: Record<string, unknown> | null | undefined,
  policies: ScreeningPolicies,
): Record<string, unknown> {
  const next = { ...(extras && typeof extras === "object" ? extras : {}) };
  const previous =
    next.screeningPolicies &&
    typeof next.screeningPolicies === "object" &&
    !Array.isArray(next.screeningPolicies)
      ? { ...(next.screeningPolicies as Record<string, unknown>) }
      : {};
  for (const field of SCREENING_POLICY_FIELDS) {
    const value = policies[field.key];
    if (value) previous[field.key] = value;
    else delete previous[field.key];
  }
  next.screeningPolicies = previous;
  return next;
}

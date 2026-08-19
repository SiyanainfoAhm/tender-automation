/**
 * Versioned Phase-1 screening methodology + DB-backed policy snapshot.
 * Company values come from agenttender_company_bid_preferences (columns + extras).
 * Methodology text lives in buildTenderScreeningPrompt(); this module only
 * parses/render-ready values so ChatGPT never gets hardcoded Siyana numbers.
 */

export const PHASE1_SCREENING_POLICY_VERSION = "SIYANA_PHASE1_V4";

export type ScreeningPolicy = "ALLOW" | "VERIFY" | "NO_BID";

export const SCREENING_POLICY_VALUES: readonly ScreeningPolicy[] = [
  "ALLOW",
  "VERIFY",
  "NO_BID",
];

export const SCREENING_POLICY_FIELD_DEFS = [
  { key: "sameDayDeadline", label: "Same-day closing tender", logKey: "DEADLINE_POLICY" },
  { key: "expiredTender", label: "Expired tender", logKey: "EXPIRED_TENDER_POLICY" },
  { key: "eoi", label: "EOI", logKey: "EOI_POLICY" },
  { key: "empanelment", label: "Empanelment", logKey: "EMPANELMENT_POLICY" },
  { key: "hardwareOnly", label: "Hardware-only procurement", logKey: "HARDWARE_ONLY_POLICY" },
  { key: "hardwareDominant", label: "Hardware-dominant delivery", logKey: "HARDWARE_POLICY" },
  { key: "oemAuthorization", label: "OEM authorization dependency", logKey: "OEM_AUTHORIZATION_POLICY" },
  { key: "partnerDependency", label: "Partner dependency", logKey: "PARTNER_DEPENDENCY_POLICY" },
  { key: "consortium", label: "Consortium", logKey: "CONSORTIUM_POLICY" },
  { key: "jointVenture", label: "Joint venture", logKey: "JV_POLICY" },
  { key: "gisSoftware", label: "GIS software/application", logKey: "GIS_SOFTWARE_POLICY" },
  { key: "gisFieldSurvey", label: "GIS field survey", logKey: "GIS_FIELD_POLICY" },
  { key: "cybersecurityOnly", label: "Cybersecurity-only engagement", logKey: "CYBER_ONLY_POLICY" },
  { key: "cotsLicence", label: "COTS/software licence procurement", logKey: "COTS_POLICY" },
  { key: "softwareRenewal", label: "Software renewal/product AMC", logKey: "SOFTWARE_RENEWAL_POLICY" },
  { key: "oemProductAmc", label: "OEM product AMC", logKey: "OEM_AMC_POLICY" },
  { key: "manpowerOnly", label: "Dedicated manpower supply", logKey: "MANPOWER_ONLY_POLICY" },
  { key: "manpowerHeavy", label: "Manpower-heavy delivery", logKey: "MANPOWER_POLICY" },
  { key: "nonIt", label: "Clearly non-IT scope", logKey: "NON_IT_POLICY" },
  { key: "genericItTitle", label: "Generic IT title", logKey: "GENERIC_IT_TITLE_POLICY" },
  { key: "customSoftware", label: "Custom software development", logKey: "CUSTOM_SOFTWARE_POLICY" },
] as const;

export type ScreeningPolicyKey = (typeof SCREENING_POLICY_FIELD_DEFS)[number]["key"];

export type ScreeningPolicies = Partial<Record<ScreeningPolicyKey, ScreeningPolicy>>;

export type TenderScreeningPreferenceSnapshot = {
  companyId: string;
  companyName: string;
  financial: {
    maxEmdInr: number | null;
    minTenderValueInr: number | null;
    maxTenderValueInr: number | null;
  };
  preferredScopes: string[];
  excludedScopes: string[];
  policies: ScreeningPolicies;
  customRules?: Record<string, unknown>;
  screeningPolicyVersion: string;
};

const POLICY_ALIAS_KEYS: Record<ScreeningPolicyKey, string[]> = {
  sameDayDeadline: ["sameDayDeadlinePolicy", "same_day_deadline_policy"],
  expiredTender: ["expiredTenderPolicy", "expired_tender_policy"],
  eoi: ["eoiPolicy", "eoi_policy"],
  empanelment: ["empanelmentPolicy", "empanelment_policy"],
  hardwareOnly: ["hardwareOnlyPolicy", "hardware_only_policy"],
  hardwareDominant: ["hardwareDominantPolicy", "hardware_dominant_policy"],
  oemAuthorization: ["oemAuthorizationPolicy", "oem_authorization_policy"],
  partnerDependency: ["partnerDependencyPolicy", "partner_dependency_policy"],
  consortium: ["consortiumPolicy", "consortium_policy"],
  jointVenture: ["jointVenturePolicy", "jvPolicy", "joint_venture_policy"],
  gisSoftware: ["gisSoftwarePolicy", "gis_software_policy"],
  gisFieldSurvey: ["gisFieldSurveyPolicy", "gis_field_survey_policy"],
  cybersecurityOnly: ["cybersecurityOnlyPolicy", "cyber_only_policy"],
  cotsLicence: ["cotsLicencePolicy", "cots_licence_policy"],
  softwareRenewal: ["softwareRenewalPolicy", "software_renewal_policy"],
  oemProductAmc: ["oemProductAmcPolicy", "oem_product_amc_policy"],
  manpowerOnly: ["manpowerOnlyPolicy", "manpower_only_policy"],
  manpowerHeavy: ["manpowerHeavyPolicy", "manpower_heavy_policy"],
  nonIt: ["nonItPolicy", "non_it_policy"],
  genericItTitle: ["genericItTitlePolicy", "generic_it_title_policy"],
  customSoftware: ["customSoftwarePolicy", "custom_software_policy"],
};

const KNOWN_POLICY_EXTRA_KEYS = new Set<string>([
  "screeningPolicies",
  "screening_policies",
  "customRules",
  "custom_rules",
  ...SCREENING_POLICY_FIELD_DEFS.flatMap((field) => [
    field.key,
    ...POLICY_ALIAS_KEYS[field.key],
  ]),
]);

export function parseScreeningPolicyValue(raw: unknown): ScreeningPolicy | undefined {
  if (raw == null || raw === "") return undefined;
  const normalized = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "ALLOW") return "ALLOW";
  if (normalized === "VERIFY") return "VERIFY";
  if (normalized === "NO_BID" || normalized === "NOBID") return "NO_BID";
  return undefined;
}

function readNestedPolicies(extras: Record<string, unknown>): Record<string, unknown> {
  const nested = extras.screeningPolicies ?? extras.screening_policies;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return {};
}

export function parseScreeningPolicies(
  extras: Record<string, unknown> | null | undefined,
): ScreeningPolicies {
  const source = extras && typeof extras === "object" ? extras : {};
  const nested = readNestedPolicies(source);
  const policies: ScreeningPolicies = {};
  for (const field of SCREENING_POLICY_FIELD_DEFS) {
    const candidates = [
      nested[field.key],
      nested[`${field.key}Policy`],
      source[field.key],
      ...POLICY_ALIAS_KEYS[field.key].map((alias) => source[alias]),
      ...POLICY_ALIAS_KEYS[field.key].map((alias) => nested[alias]),
    ];
    for (const candidate of candidates) {
      const parsed = parseScreeningPolicyValue(candidate);
      if (parsed) {
        policies[field.key] = parsed;
        break;
      }
    }
  }
  return policies;
}

export function leftoverCustomRules(
  extras: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!extras || typeof extras !== "object") return undefined;
  const out: Record<string, unknown> = {};
  const nestedCustom = extras.customRules ?? extras.custom_rules;
  if (nestedCustom != null && nestedCustom !== "") {
    out.customRules = nestedCustom;
  }
  for (const [key, value] of Object.entries(extras)) {
    if (KNOWN_POLICY_EXTRA_KEYS.has(key)) continue;
    if (value == null || value === "") continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export function formatNullableInr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "(not specified in database)";
  }
  return `INR ${value.toLocaleString("en-IN")}`;
}

export function hasSelectedScope(
  scopes: readonly string[],
  pattern: RegExp,
): boolean {
  return scopes.some((scope) => pattern.test(scope));
}

export function configuredPolicyLines(policies: ScreeningPolicies): string[] {
  const lines: string[] = [];
  for (const field of SCREENING_POLICY_FIELD_DEFS) {
    const value = policies[field.key];
    if (!value) continue;
    lines.push(`${field.label}: ${value}`);
  }
  return lines;
}

export function logActiveScreeningRules(
  snapshot: TenderScreeningPreferenceSnapshot,
  log: (message: string) => void,
): void {
  log(`[AI SCREENING] POLICY_VERSION=${snapshot.screeningPolicyVersion}`);
  log(`[AI SCREENING] MAX_EMD=${snapshot.financial.maxEmdInr ?? "(not specified)"}`);
  log(
    `[AI SCREENING] MIN_TENDER_VALUE=${snapshot.financial.minTenderValueInr ?? "(not specified)"}`,
  );
  log(
    `[AI SCREENING] MAX_TENDER_VALUE=${snapshot.financial.maxTenderValueInr ?? "(not specified)"}`,
  );
  log(
    `[AI SCREENING] PREFERRED_SCOPES=${snapshot.preferredScopes.join(" | ") || "(none)"}`,
  );
  log(
    `[AI SCREENING] EXCLUDED_SCOPES=${snapshot.excludedScopes.join(" | ") || "(none)"}`,
  );

  const sameDay = snapshot.policies.sameDayDeadline;
  const expired = snapshot.policies.expiredTender;
  if (sameDay || expired) {
    const parts = [
      sameDay ? `sameDay=${sameDay}` : null,
      expired ? `expired=${expired}` : null,
    ].filter(Boolean);
    log(`[AI SCREENING] DEADLINE_POLICY=${parts.join("; ")}`);
  }
  if (snapshot.policies.eoi) {
    log(`[AI SCREENING] EOI_POLICY=${snapshot.policies.eoi}`);
  }
  if (snapshot.policies.empanelment) {
    log(`[AI SCREENING] EMPANELMENT_POLICY=${snapshot.policies.empanelment}`);
  }
  const hardware = [
    snapshot.policies.hardwareOnly ? `only=${snapshot.policies.hardwareOnly}` : null,
    snapshot.policies.hardwareDominant
      ? `dominant=${snapshot.policies.hardwareDominant}`
      : null,
  ].filter(Boolean);
  if (hardware.length) {
    log(`[AI SCREENING] HARDWARE_POLICY=${hardware.join("; ")}`);
  }
  const oemPartner = [
    snapshot.policies.oemAuthorization
      ? `oem=${snapshot.policies.oemAuthorization}`
      : null,
    snapshot.policies.partnerDependency
      ? `partner=${snapshot.policies.partnerDependency}`
      : null,
    snapshot.policies.consortium ? `consortium=${snapshot.policies.consortium}` : null,
    snapshot.policies.jointVenture ? `jv=${snapshot.policies.jointVenture}` : null,
  ].filter(Boolean);
  if (oemPartner.length) {
    log(`[AI SCREENING] OEM_PARTNER_POLICY=${oemPartner.join("; ")}`);
  }
  if (snapshot.policies.gisFieldSurvey || snapshot.policies.gisSoftware) {
    const gis = [
      snapshot.policies.gisSoftware ? `software=${snapshot.policies.gisSoftware}` : null,
      snapshot.policies.gisFieldSurvey
        ? `field=${snapshot.policies.gisFieldSurvey}`
        : null,
    ].filter(Boolean);
    log(`[AI SCREENING] GIS_FIELD_POLICY=${gis.join("; ")}`);
  }
  if (snapshot.policies.cybersecurityOnly) {
    log(`[AI SCREENING] CYBER_ONLY_POLICY=${snapshot.policies.cybersecurityOnly}`);
  }
  const cots = [
    snapshot.policies.cotsLicence ? `licence=${snapshot.policies.cotsLicence}` : null,
    snapshot.policies.softwareRenewal
      ? `renewal=${snapshot.policies.softwareRenewal}`
      : null,
    snapshot.policies.oemProductAmc ? `amc=${snapshot.policies.oemProductAmc}` : null,
  ].filter(Boolean);
  if (cots.length) {
    log(`[AI SCREENING] COTS_POLICY=${cots.join("; ")}`);
  }
  const manpower = [
    snapshot.policies.manpowerOnly ? `only=${snapshot.policies.manpowerOnly}` : null,
    snapshot.policies.manpowerHeavy ? `heavy=${snapshot.policies.manpowerHeavy}` : null,
  ].filter(Boolean);
  if (manpower.length) {
    log(`[AI SCREENING] MANPOWER_POLICY=${manpower.join("; ")}`);
  }
}

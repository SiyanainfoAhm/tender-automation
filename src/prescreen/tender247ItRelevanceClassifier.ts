import type { ItRelevance } from "./prescreenTypes.js";

/**
 * Deterministic IT/software relevance classifier — Tender247 only.
 * BidAssist must never invoke this module's classify path.
 */

export type Tender247ItRelevance = "IT_RELEVANT" | "NON_IT" | "AMBIGUOUS";

export type Tender247ItRelevanceReasonCode =
  | "SOFTWARE_SCOPE_MATCH"
  | "STRONG_IT_TERM_MATCH"
  | "IT_CONTEXTUAL_COMBINATION"
  | "CLEAR_NON_IT_SCOPE"
  | "BUSINESS_EXCLUSION"
  | "INSUFFICIENT_SCOPE_EVIDENCE"
  | "MIXED_UNCLEAR_SCOPE"
  | "EMPTY_SCOPE";

export type Tender247ItRelevanceResult = {
  relevance: Tender247ItRelevance;
  reasonCode: Tender247ItRelevanceReasonCode;
  matchedTerms: string[];
  negativeTerms: string[];
  evidenceFields: string[];
  explanation?: string;
};

export type ItRelevanceClassifierCallTracker = {
  called: boolean;
  sourcePortal?: string;
};

type PatternHit = { label: string; field?: string };

type PatternDef = {
  label: string;
  pattern: RegExp;
};

/** Strong positive IT/software deliverable signals */
const STRONG_POSITIVE: PatternDef[] = [
  { label: "software development", pattern: /\bsoftware\s+development\b/i },
  {
    label: "software implementation",
    pattern: /\bsoftware\s+implementation\b/i,
  },
  { label: "web application", pattern: /\bweb\s+application\b/i },
  {
    label: "website development",
    pattern: /\b(web\s*)?site\s+development\b/i,
  },
  { label: "website", pattern: /\bwebsite\b/i },
  { label: "web portal", pattern: /\bweb\s+portal\b/i },
  { label: "portal development", pattern: /\bportal\s+development\b/i },
  { label: "mobile application", pattern: /\bmobile\s+app(lication)?\b/i },
  { label: "Android application", pattern: /\bandroid\s+app(lication)?\b/i },
  { label: "iOS application", pattern: /\bios\s+app(lication)?\b/i },
  { label: "app development", pattern: /\bapp(lication)?\s+development\b/i },
  { label: "ERP", pattern: /\berp\b/i },
  { label: "HRMS", pattern: /\bhrms\b/i },
  { label: "payroll software", pattern: /\bpayroll\s+software\b/i },
  { label: "CRM", pattern: /\bcrm\b/i },
  { label: "CMS", pattern: /\bcms\b/i },
  { label: "LMS", pattern: /\blms\b/i },
  { label: "MIS", pattern: /\bmis\b/i },
  { label: "dashboard", pattern: /\bdashboard\b/i },
  { label: "GIS application", pattern: /\bgis\s+application\b/i },
  { label: "GIS portal", pattern: /\bgis\s+portal\b/i },
  {
    label: "database application",
    pattern: /\bdatabase\s+application\b/i,
  },
  { label: "API integration", pattern: /\bapi\s+integration\b/i },
  { label: "system integration", pattern: /\bsystem\s+integration\b/i },
  {
    label: "application maintenance",
    pattern: /\bapplication\s+maintenance\b/i,
  },
  { label: "software AMC", pattern: /\bsoftware\s+amc\b/i },
  {
    label: "cybersecurity software/services",
    pattern: /\bcyber[\s-]*security\b/i,
  },
  {
    label: "information security",
    pattern: /\binformation\s+security\b/i,
  },
  {
    label: "e-governance platform",
    pattern: /\be[\s-]?governance\b/i,
  },
  { label: "digital platform", pattern: /\bdigital\s+platform\b/i },
  { label: "cloud application", pattern: /\bcloud\s+application\b/i },
  {
    label: "AI/ML application",
    pattern: /\b(artificial\s+intelligence|machine\s+learning|ai[\s/:-]*ml)\b/i,
  },
  { label: "chatbot", pattern: /\bchat\s*bots?\b/i },
  {
    label: "application modernization",
    pattern: /\bapplication\s+modernization\b/i,
  },
  { label: "custom software", pattern: /\bcustom\s+software\b/i },
  {
    label: "IT application implementation",
    pattern: /\bit\s+application\s+implementation\b/i,
  },
  {
    label: "hiring agency for IT project",
    pattern:
      /\bhiring\s+of\s+agency\s+for\s+it\s+projects?\b|\bit\s+projects?\s*[-–—]?\s*milestone\b/i,
  },
  {
    label: "information technology",
    pattern: /\binformation\s+technology\b/i,
  },
  { label: "software", pattern: /\bsoftware\b/i },
  { label: "portal", pattern: /\bportal\b/i },
  { label: "SaaS", pattern: /\bsaas\b/i },
  { label: "ICT", pattern: /\bict\b/i },
  {
    label: "application development",
    pattern: /\bapplication\s+development\b/i,
  },
  { label: "IT services", pattern: /\bit\s+services?\b/i },
  { label: "IT support", pattern: /\bit\s+support\b/i },
  { label: "IT-enabled services", pattern: /\bit[\s-]?enabled\s+services?\b/i },
  { label: "computerization", pattern: /\bcomputerization\b/i },
  { label: "database", pattern: /\bdatabase\b/i },
  { label: "cloud", pattern: /\bcloud\b/i },
  { label: "GIS", pattern: /\bgis\b/i },
];

/** Contextual combinations that indicate IT deliverable without a single keyword */
const CONTEXTUAL_COMBOS: Array<{
  label: string;
  a: RegExp;
  b: RegExp;
}> = [
  {
    label: "implementation + digital system",
    a: /\bimplementation\b/i,
    b: /\bdigital\s+system\b/i,
  },
  {
    label: "development + portal",
    a: /\bdevelopment\b/i,
    b: /\bportal\b/i,
  },
  {
    label: "application + maintenance",
    a: /\bapplication\b/i,
    b: /\bmaintenance\b/i,
  },
  {
    label: "software + AMC",
    a: /\bsoftware\b/i,
    b: /\bamc\b/i,
  },
  {
    label: "GIS + application",
    a: /\bgis\b/i,
    b: /\bapplication\b/i,
  },
];

/** Business exclusions — always NON_IT when clearly present without strong IT deliverable override already handled */
const BUSINESS_EXCLUSIONS: PatternDef[] = [
  {
    label: "scanning/digitization",
    pattern:
      /\b(scanning|digitization|digitisation|document\s+digitization|document\s+digitisation)\b/i,
  },
  {
    label: "EOI",
    pattern: /\b(eoi|expression\s+of\s+interest)\b/i,
  },
  { label: "empanelment", pattern: /\bempanelment\b/i },
  {
    label: "internet/bandwidth service",
    pattern:
      /\b(internet\s+(service|connectivity|lease|leased\s+line)|bandwidth|leased\s+line)\b/i,
  },
];

/** Clear non-IT scope */
const STRONG_NEGATIVE: PatternDef[] = [
  { label: "civil construction", pattern: /\bcivil\s+construction\b/i },
  { label: "civil works", pattern: /\bcivil\s+works?\b/i },
  {
    label: "road works",
    pattern: /\broad\s+works?\b|\broad\s+construction\b|\broads?\s+and\s+bridges\b/i,
  },
  {
    label: "building construction",
    pattern: /\bbuilding\s+construction\b|\bcivil\s+works?\b/i,
  },
  { label: "furniture", pattern: /\bfurniture\b/i },
  {
    label: "electrical works",
    pattern: /\belectrical\s+(works?|equipment|supply)\b/i,
  },
  {
    label: "vehicles",
    pattern: /\bvehicles?\b|\bautomobile(s)?\b|\bvehicle\s+(procurement|purchase|supply)\b/i,
  },
  {
    label: "medical consumables",
    pattern: /\bmedical\s+consumables?\b/i,
  },
  { label: "medicines", pattern: /\bmedicines?\b|\bpharma(ceuticals?)?\b/i },
  { label: "food/catering", pattern: /\b(food|catering)\b/i },
  { label: "housekeeping", pattern: /\bhousekeeping\b/i },
  { label: "security guards", pattern: /\bsecurity\s+guards?\b/i },
  {
    label: "non-IT manpower",
    pattern: /\b(manpower\s+supply|non[\s-]?it\s+manpower)\b/i,
  },
  { label: "printing", pattern: /\bprinting\b/i },
  { label: "stationery", pattern: /\bstationery\b/i },
  {
    label: "pure hardware supply",
    pattern:
      /\b(hardware\s+supply|supply\s+of\s+hardware|computer\s+hardware\s+only)\b/i,
  },
  { label: "pipeline laying", pattern: /\bpipeline\s+laying\b/i },
  { label: "borewell", pattern: /\bborewell\b/i },
  { label: "real estate", pattern: /\breal\s+estate\b/i },
  { label: "mechanical repair", pattern: /\bmechanical\s+repair\b/i },
];

/** Weak / vague terms alone are not enough for IT_RELEVANT */
const WEAK_ONLY_AMBIGUOUS: PatternDef[] = [
  { label: "digital services", pattern: /\bdigital\s+services?\b/i },
  { label: "digital", pattern: /\bdigital\b/i },
  { label: "technology", pattern: /\btechnology\b/i },
  { label: "IT", pattern: /\bit\b/i },
];

function collectHits(haystack: string, defs: PatternDef[]): PatternHit[] {
  const hits: PatternHit[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    if (def.pattern.test(haystack) && !seen.has(def.label)) {
      seen.add(def.label);
      hits.push({ label: def.label });
    }
  }
  return hits;
}

function collectComboHits(haystack: string): PatternHit[] {
  const hits: PatternHit[] = [];
  for (const combo of CONTEXTUAL_COMBOS) {
    if (combo.a.test(haystack) && combo.b.test(haystack)) {
      hits.push({ label: combo.label });
    }
  }
  return hits;
}

/**
 * Full structured IT relevance evaluation from combined detail-page text.
 */
export function evaluateTender247ItRelevance(
  text: string,
  options?: {
    evidenceFields?: string[];
    tracker?: ItRelevanceClassifierCallTracker;
  },
): Tender247ItRelevanceResult {
  if (options?.tracker) {
    options.tracker.called = true;
    options.tracker.sourcePortal = "TENDER247";
  }

  const evidenceFields = options?.evidenceFields?.length
    ? [...options.evidenceFields]
    : ["combined"];
  const haystack = text.replace(/\s+/g, " ").trim();

  if (!haystack) {
    return {
      relevance: "AMBIGUOUS",
      reasonCode: "EMPTY_SCOPE",
      matchedTerms: [],
      negativeTerms: [],
      evidenceFields,
      explanation: "No scope text available for IT relevance classification.",
    };
  }

  const positiveHits = collectHits(haystack, STRONG_POSITIVE);
  const comboHits = collectComboHits(haystack);
  const exclusionHits = collectHits(haystack, BUSINESS_EXCLUSIONS);
  const negativeHits = collectHits(haystack, STRONG_NEGATIVE);
  const weakHits = collectHits(haystack, WEAK_ONLY_AMBIGUOUS);

  const matchedTerms = [
    ...positiveHits.map((h) => h.label),
    ...comboHits.map((h) => h.label),
  ];
  const negativeTerms = [
    ...exclusionHits.map((h) => h.label),
    ...negativeHits.map((h) => h.label),
  ];

  const hasStrongPositive =
    positiveHits.length > 0 || comboHits.length > 0;
  const hasBusinessExclusion = exclusionHits.length > 0;
  const hasStrongNegative = negativeHits.length > 0;

  // Explicit IT hiring / milestone agency — always IT even if wording is sparse
  const hiringIt = positiveHits.some(
    (h) => h.label === "hiring agency for IT project",
  );
  if (hiringIt) {
    return {
      relevance: "IT_RELEVANT",
      reasonCode: "SOFTWARE_SCOPE_MATCH",
      matchedTerms,
      negativeTerms,
      evidenceFields,
      explanation:
        "Hiring of agency for IT projects (milestone basis) is treated as IT-relevant.",
    };
  }

  // Business exclusions without a clear IT software deliverable
  if (hasBusinessExclusion && !hasStrongPositive) {
    return {
      relevance: "NON_IT",
      reasonCode: "BUSINESS_EXCLUSION",
      matchedTerms: [],
      negativeTerms,
      evidenceFields,
      explanation: `Excluded by business rule: ${exclusionHits.map((h) => h.label).join(", ")}.`,
    };
  }

  // Strong IT with no conflicting non-IT dominance
  if (hasStrongPositive && !hasStrongNegative && !hasBusinessExclusion) {
    const reasonCode: Tender247ItRelevanceReasonCode =
      comboHits.length > 0 && positiveHits.length === 0
        ? "IT_CONTEXTUAL_COMBINATION"
        : positiveHits.some((h) =>
              [
                "software development",
                "web application",
                "website development",
                "web portal",
                "mobile application",
                "ERP",
                "HRMS",
                "CRM",
                "CMS",
                "software AMC",
                "GIS application",
              ].includes(h.label),
            )
          ? "SOFTWARE_SCOPE_MATCH"
          : "STRONG_IT_TERM_MATCH";
    return {
      relevance: "IT_RELEVANT",
      reasonCode,
      matchedTerms,
      negativeTerms: [],
      evidenceFields,
      explanation:
        "Tender clearly indicates an IT/software deliverable based on detail metadata.",
    };
  }

  // Strong IT + some negative: keep IT when software deliverable is clear
  if (hasStrongPositive && (hasStrongNegative || hasBusinessExclusion)) {
    const softwareClear = positiveHits.some((h) =>
      /software|application|portal|erp|hrms|crm|cms|lms|mis|gis|website|web |api |cloud|chatbot|saas|ict/i.test(
        h.label,
      ),
    );
    if (softwareClear || comboHits.length > 0) {
      return {
        relevance: "IT_RELEVANT",
        reasonCode: "SOFTWARE_SCOPE_MATCH",
        matchedTerms,
        negativeTerms,
        evidenceFields,
        explanation:
          "IT/software deliverable is present despite mixed non-IT wording.",
      };
    }
    return {
      relevance: "AMBIGUOUS",
      reasonCode: "MIXED_UNCLEAR_SCOPE",
      matchedTerms,
      negativeTerms,
      evidenceFields,
      explanation:
        "Mixed IT and non-IT signals; insufficient confidence for automatic classification.",
    };
  }

  // Clear non-IT with no IT deliverable
  if ((hasStrongNegative || hasBusinessExclusion) && !hasStrongPositive) {
    return {
      relevance: "NON_IT",
      reasonCode: hasBusinessExclusion
        ? "BUSINESS_EXCLUSION"
        : "CLEAR_NON_IT_SCOPE",
      matchedTerms: [],
      negativeTerms,
      evidenceFields,
      explanation: "Scope is clearly non-IT with no meaningful software deliverable.",
    };
  }

  // Weak-only / vague digital wording → AMBIGUOUS (never force NON_IT)
  if (weakHits.length > 0) {
    return {
      relevance: "AMBIGUOUS",
      reasonCode: "INSUFFICIENT_SCOPE_EVIDENCE",
      matchedTerms: weakHits.map((h) => h.label),
      negativeTerms: [],
      evidenceFields,
      explanation:
        "Only vague digital/technology wording found; insufficient for IT relevance.",
    };
  }

  return {
    relevance: "AMBIGUOUS",
    reasonCode: "INSUFFICIENT_SCOPE_EVIDENCE",
    matchedTerms: [],
    negativeTerms: [],
    evidenceFields,
    explanation: "Insufficient scope evidence to classify as IT or non-IT.",
  };
}

/**
 * Classify Tender247 title/description/category for IT relevance.
 * Returns legacy ItRelevance labels used by detailed prescreen facts.
 * Must never be invoked for BidAssist.
 */
export function classifyTender247ItRelevance(
  text: string,
  tracker?: ItRelevanceClassifierCallTracker,
): ItRelevance {
  const result = evaluateTender247ItRelevance(text, { tracker });
  if (result.relevance === "IT_RELEVANT") {
    return "RELEVANT";
  }
  return result.relevance;
}

export function assertBidassistDidNotRunItClassifier(
  sourcePortal: string,
  tracker: ItRelevanceClassifierCallTracker,
): void {
  if (sourcePortal === "BIDASSIST" && tracker.called) {
    throw new Error("BIDASSIST_IT_RELEVANCE_CLASSIFIER_MUST_NOT_RUN");
  }
}

/**
 * Pipeline side-effect policy after IT relevance gate (pre-persistence).
 * ChatGPT still requires later detailed-prescreen PASSED + chatgpt_eligible.
 */
export function tender247StagesAllowedAfterItRelevance(
  relevance: Tender247ItRelevance,
): {
  downloadDocuments: boolean;
  supabasePersist: boolean;
  detailedPrescreen: boolean;
  chatgptAutomatic: boolean;
} {
  const continueIt = relevance === "IT_RELEVANT";
  return {
    downloadDocuments: continueIt,
    supabasePersist: continueIt,
    detailedPrescreen: continueIt,
    chatgptAutomatic: false, // never automatic from this gate alone
  };
}

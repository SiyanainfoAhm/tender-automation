/**
 * Bid checklist requirement keys, categories, and company-document matching.
 * Tender uploads stay tender-scoped; company matches are references only.
 */

export const CHECKLIST_CATEGORIES = [
  "COMPLIANCE",
  "TECHNICAL",
  "FINANCIAL",
  "LEGAL",
  "EXPERIENCE",
  "ANNEXURE",
  "DECLARATION",
  "AUTHORIZATION",
  "CERTIFICATE",
  "EMD",
  "BOQ",
  "SERVICE",
  "OTHER",
] as const;

export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number];

export const CHECKLIST_COMPLETION_STATUSES = [
  "MISSING",
  "COMPLETED_COMPANY_DOCUMENT",
  "COMPLETED_TENDER_DOCUMENT",
  "DRAFT_AVAILABLE",
  "INVALID_DOCUMENT",
  "EXPIRED_DOCUMENT",
  "PENDING_DOCUMENT",
  "ACTION_REQUIRED",
  "NOT_APPLICABLE",
] as const;

export type ChecklistCompletionStatus =
  (typeof CHECKLIST_COMPLETION_STATUSES)[number];

export const GENERATION_POLICIES = [
  "GENERATABLE",
  "GENERATABLE_DRAFT_ONLY",
  "EXTERNAL_EVIDENCE_REQUIRED",
  "MANUAL_ACTION_REQUIRED",
] as const;

export type GenerationPolicy = (typeof GENERATION_POLICIES)[number];

export type RequirementPattern = {
  key: string;
  category: ChecklistCategory;
  generationPolicy: GenerationPolicy;
  /** Derived: true when AI may draft a tender-scoped response document. */
  generationAllowed: boolean;
  /** Tokens that indicate a match in document name/type */
  aliases: string[];
  workspaceDocType: "Pre-Qualification" | "Technical" | "Annexure" | "Other";
};

function pattern(
  partial: Omit<RequirementPattern, "generationAllowed">,
): RequirementPattern {
  return {
    ...partial,
    generationAllowed:
      partial.generationPolicy === "GENERATABLE" ||
      partial.generationPolicy === "GENERATABLE_DRAFT_ONLY",
  };
}

/** Normalized requirement catalog used for matching + seeding. */
export const REQUIREMENT_PATTERNS: RequirementPattern[] = [
  pattern({
    key: "GST_REGISTRATION",
    category: "COMPLIANCE",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["gst", "gstin", "goods and services tax"],
    workspaceDocType: "Pre-Qualification",
  }),
  pattern({
    key: "PAN_CARD",
    category: "COMPLIANCE",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["pan card", "permanent account number", "income tax pan"],
    workspaceDocType: "Pre-Qualification",
  }),
  pattern({
    key: "CERTIFICATE_OF_INCORPORATION",
    category: "LEGAL",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["certificate of incorporation", "incorporation", "roc"],
    workspaceDocType: "Pre-Qualification",
  }),
  pattern({
    key: "CMMI_LEVEL_3",
    category: "TECHNICAL",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["cmmi", "cmmi level 3", "cmmi maturity", "cmmi appraisal"],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "ISO_9001",
    category: "CERTIFICATE",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["iso 9001", "iso9001", "quality management"],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "ISO_27001",
    category: "CERTIFICATE",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["iso 27001", "iso27001", "information security"],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "ESI_REGISTRATION",
    category: "COMPLIANCE",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["esi", "employees state insurance"],
    workspaceDocType: "Pre-Qualification",
  }),
  pattern({
    key: "EPF_REGISTRATION",
    category: "COMPLIANCE",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["epf", "provident fund", "pf registration"],
    workspaceDocType: "Pre-Qualification",
  }),
  pattern({
    key: "PAST_EXPERIENCE",
    category: "EXPERIENCE",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: [
      "past experience",
      "completion certificate",
      "work order",
      "experience certificate",
    ],
    workspaceDocType: "Pre-Qualification",
  }),
  pattern({
    key: "INTEGRITY_PACT",
    category: "DECLARATION",
    generationPolicy: "GENERATABLE_DRAFT_ONLY",
    aliases: ["integrity pact"],
    workspaceDocType: "Annexure",
  }),
  pattern({
    key: "TECHNICAL_APPROACH",
    category: "TECHNICAL",
    generationPolicy: "GENERATABLE",
    aliases: [
      "technical approach",
      "methodology",
      "approach and methodology",
      "technical proposal",
    ],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "PROJECT_PLAN",
    category: "TECHNICAL",
    generationPolicy: "GENERATABLE",
    aliases: ["project plan", "project schedule", "ms project", "gantt"],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "COMPLIANCE_MATRIX",
    category: "TECHNICAL",
    generationPolicy: "GENERATABLE",
    aliases: ["compliance matrix", "compliance statement", "clause compliance"],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "COMPANY_PROFILE_ANNEXURE",
    category: "ANNEXURE",
    generationPolicy: "GENERATABLE",
    aliases: ["company profile", "bidder profile", "about the company"],
    workspaceDocType: "Annexure",
  }),
  pattern({
    key: "KEY_PERSONNEL_CV",
    category: "TECHNICAL",
    generationPolicy: "GENERATABLE_DRAFT_ONLY",
    aliases: ["cv", "curriculum vitae", "key personnel", "resume"],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "OEM_AUTHORIZATION",
    category: "AUTHORIZATION",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["oem authorization", "manufacturer authorization", "maa"],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "NET_WORTH_CERTIFICATE",
    category: "FINANCIAL",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["net worth", "networth"],
    workspaceDocType: "Pre-Qualification",
  }),
  pattern({
    key: "AUDITED_BALANCE_SHEET",
    category: "FINANCIAL",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["balance sheet", "audited financial", "turnover certificate"],
    workspaceDocType: "Pre-Qualification",
  }),
  pattern({
    key: "EMD_INSTRUMENT",
    category: "EMD",
    generationPolicy: "EXTERNAL_EVIDENCE_REQUIRED",
    aliases: ["emd", "earnest money", "bid security", "bank guarantee"],
    workspaceDocType: "Other",
  }),
  pattern({
    key: "POWER_OF_ATTORNEY",
    category: "LEGAL",
    generationPolicy: "GENERATABLE_DRAFT_ONLY",
    aliases: ["power of attorney", "poa", "authorization letter"],
    workspaceDocType: "Annexure",
  }),
  pattern({
    key: "COVERING_LETTER",
    category: "ANNEXURE",
    generationPolicy: "GENERATABLE_DRAFT_ONLY",
    aliases: ["covering letter", "cover letter", "bid covering"],
    workspaceDocType: "Annexure",
  }),
  pattern({
    key: "MAKE_IN_INDIA_DECLARATION",
    category: "DECLARATION",
    generationPolicy: "GENERATABLE_DRAFT_ONLY",
    aliases: ["make in india", "local content"],
    workspaceDocType: "Annexure",
  }),
  pattern({
    key: "NON_BLACKLISTING_DECLARATION",
    category: "DECLARATION",
    generationPolicy: "GENERATABLE_DRAFT_ONLY",
    aliases: [
      "non blacklisting",
      "non-blacklisting",
      "not blacklisted",
      "blacklist declaration",
    ],
    workspaceDocType: "Annexure",
  }),
  pattern({
    key: "SIGNED_DECLARATION",
    category: "DECLARATION",
    generationPolicy: "GENERATABLE_DRAFT_ONLY",
    aliases: [
      "signed declaration",
      "declaration accuracy",
      "acceptance of terms",
      "self declaration",
    ],
    workspaceDocType: "Annexure",
  }),
  pattern({
    key: "TECHNICAL_BID",
    category: "TECHNICAL",
    generationPolicy: "GENERATABLE",
    aliases: [
      "technical bid",
      "technical bid format",
      "technical proposal format",
    ],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "COMPLIANCE_STATEMENT",
    category: "TECHNICAL",
    generationPolicy: "GENERATABLE",
    aliases: [
      "compliance statement",
      "scope of work compliance",
      "annexure i compliance",
    ],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "TECHNICAL_MANPOWER",
    category: "TECHNICAL",
    generationPolicy: "GENERATABLE",
    aliases: [
      "technical manpower",
      "staff strength",
      "manpower details",
      "technical staff",
    ],
    workspaceDocType: "Technical",
  }),
  pattern({
    key: "CLIENT_LIST",
    category: "EXPERIENCE",
    generationPolicy: "GENERATABLE",
    aliases: ["list of clients", "major clients", "client list"],
    workspaceDocType: "Annexure",
  }),
  pattern({
    key: "SLA_ACCEPTANCE",
    category: "DECLARATION",
    generationPolicy: "GENERATABLE_DRAFT_ONLY",
    aliases: ["sla acceptance", "service level", "acceptance of sla"],
    workspaceDocType: "Annexure",
  }),
];

/** True when the requirement must be authored for this tender (not a library upload). */
export function isFromScratchGeneratable(options: {
  requirementKey: string;
  requirementName: string;
  generationAllowed?: boolean;
}): boolean {
  const policy = resolveGenerationPolicy(options);
  return (
    policy === "GENERATABLE" || policy === "GENERATABLE_DRAFT_ONLY"
  );
}

export function resolveGenerationPolicy(options: {
  requirementKey: string;
  requirementName: string;
  generationAllowed?: boolean;
}): GenerationPolicy {
  const byKey = REQUIREMENT_PATTERNS.find((p) => p.key === options.requirementKey);
  if (byKey) return byKey.generationPolicy;
  // Deferred name match — resolveRequirementPattern is defined below and hoisted.
  const byName = resolveRequirementPattern(options.requirementName);
  if (byName) return byName.generationPolicy;
  if (options.generationAllowed === true) return "GENERATABLE_DRAFT_ONLY";
  // Narrative drafts that ingestion flagged but aren't in the catalog yet.
  const name = normalizeMatchText(options.requirementName);
  if (
    /(non blacklisting|covering letter|cover letter|technical bid|compliance statement|approach and methodology|technical approach|project plan|manpower|staff strength|client list|integrity pact|make in india|undertaking|signed declaration)/.test(
      name,
    )
  ) {
    return "GENERATABLE_DRAFT_ONLY";
  }
  // Generic "declaration" only when it looks like a bid declaration (not a certificate).
  if (
    /\bdeclaration\b/.test(name) &&
    !/(gst|pan|certificate|registration|iso|cmmi|emd|bank guarantee)/.test(name)
  ) {
    return "GENERATABLE_DRAFT_ONLY";
  }
  return "MANUAL_ACTION_REQUIRED";
}

export function slugRequirementKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "REQUIREMENT";
}

export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveRequirementPattern(
  name: string,
): RequirementPattern | null {
  const text = normalizeMatchText(name);
  let best: { pattern: RequirementPattern; score: number } | null = null;
  for (const pattern of REQUIREMENT_PATTERNS) {
    for (const alias of pattern.aliases) {
      const aliasNorm = normalizeMatchText(alias);
      if (!aliasNorm) continue;
      if (text.includes(aliasNorm) || aliasNorm.includes(text)) {
        const score = aliasNorm.length / Math.max(text.length, 1);
        if (!best || score > best.score) {
          best = { pattern, score };
        }
      }
    }
  }
  return best?.pattern ?? null;
}

export type MatchableCompanyDoc = {
  id: string;
  name: string;
  originalFileName: string | null;
  documentCategory: string;
  certificateType: string | null;
  documentType: string | null;
  verificationStatus: string;
  expiryState: string;
  status: string;
};

export type MatchableWorkspaceDoc = {
  id: string;
  title: string;
  fileName: string | null;
  documentType: string;
  status: string;
  hasFile: boolean;
};

export type DocumentMatchResult = {
  matched: boolean;
  source: "COMPANY" | "TENDER" | null;
  companyDocumentId: string | null;
  workspaceDocumentId: string | null;
  completionStatus: ChecklistCompletionStatus;
  confidence: number;
  reason: string;
  matchedBy: "SYSTEM";
};

function companyDocHaystack(doc: MatchableCompanyDoc): string {
  return normalizeMatchText(
    [
      doc.name,
      doc.originalFileName || "",
      doc.documentCategory,
      doc.certificateType || "",
      doc.documentType || "",
    ].join(" "),
  );
}

function isCompanyDocValid(doc: MatchableCompanyDoc): boolean {
  if (doc.status !== "active") return false;
  if (doc.verificationStatus === "rejected") return false;
  if (doc.expiryState === "EXPIRED") return false;
  return true;
}

function isWorkspaceDocComplete(doc: MatchableWorkspaceDoc): boolean {
  return (
    doc.hasFile && (doc.status === "ready" || doc.status === "approved")
  );
}

export function matchRequirementToDocuments(options: {
  requirementName: string;
  requirementKey: string;
  companyDocuments: MatchableCompanyDoc[];
  workspaceDocuments: MatchableWorkspaceDoc[];
  /** When set, overrides catalog pattern for MISSING vs ACTION_REQUIRED. */
  generationAllowed?: boolean;
}): DocumentMatchResult {
  const pattern =
    REQUIREMENT_PATTERNS.find((p) => p.key === options.requirementKey) ||
    resolveRequirementPattern(options.requirementName);
  const fromScratch = isFromScratchGeneratable({
    requirementKey: options.requirementKey,
    requirementName: options.requirementName,
    generationAllowed: options.generationAllowed ?? pattern?.generationAllowed,
  });
  const needles = pattern
    ? pattern.aliases.map(normalizeMatchText)
    : [normalizeMatchText(options.requirementName)];

  // Prefer tender-specific complete docs first for generatable types.
  for (const doc of options.workspaceDocuments) {
    if (!isWorkspaceDocComplete(doc)) continue;
    const hay = normalizeMatchText(`${doc.title} ${doc.fileName || ""}`);
    const hit = needles.some((n) => n && (hay.includes(n) || n.includes(hay)));
    if (!hit && pattern) continue;
    if (!hit && !pattern) {
      const req = normalizeMatchText(options.requirementName);
      if (!(hay.includes(req) || req.includes(hay))) continue;
    }
    return {
      matched: true,
      source: "TENDER",
      companyDocumentId: null,
      workspaceDocumentId: doc.id,
      completionStatus: "COMPLETED_TENDER_DOCUMENT",
      confidence: 0.9,
      reason: `Matched tender document “${doc.title}”.`,
      matchedBy: "SYSTEM",
    };
  }

  // From-scratch bid responses are never satisfied by Company Library uploads.
  // Only external-evidence requirements (GST, PAN, certificates, …) match company docs.
  if (!fromScratch) {
    for (const doc of options.companyDocuments) {
      const hay = companyDocHaystack(doc);
      const hit = needles.some((n) => n && hay.includes(n));
      if (!hit) continue;
      if (doc.expiryState === "EXPIRED") {
        return {
          matched: true,
          source: "COMPANY",
          companyDocumentId: doc.id,
          workspaceDocumentId: null,
          completionStatus: "EXPIRED_DOCUMENT",
          confidence: 0.85,
          reason: `Matched company document “${doc.name}” but it is expired.`,
          matchedBy: "SYSTEM",
        };
      }
      if (doc.verificationStatus === "rejected" || doc.status !== "active") {
        return {
          matched: true,
          source: "COMPANY",
          companyDocumentId: doc.id,
          workspaceDocumentId: null,
          completionStatus: "INVALID_DOCUMENT",
          confidence: 0.8,
          reason: `Matched company document “${doc.name}” but it is not valid.`,
          matchedBy: "SYSTEM",
        };
      }
      if (!isCompanyDocValid(doc)) continue;
      const completed =
        doc.verificationStatus === "verified" ||
        doc.verificationStatus === "pending";
      return {
        matched: true,
        source: "COMPANY",
        companyDocumentId: doc.id,
        workspaceDocumentId: null,
        completionStatus: completed
          ? "COMPLETED_COMPANY_DOCUMENT"
          : "PENDING_DOCUMENT",
        confidence: 0.92,
        reason: `Matched company document “${doc.name}”.`,
        matchedBy: "SYSTEM",
      };
    }
  }

  // Persisted tender workspace docs (AI-generated or uploaded) that clearly match.
  for (const doc of options.workspaceDocuments) {
    if (!doc.hasFile) continue;
    const hay = normalizeMatchText(`${doc.title} ${doc.fileName || ""}`);
    const requirementHay = normalizeMatchText(
      `${options.requirementName} ${options.requirementKey || ""}`,
    );
    const hit = needles.some((n) => n && hay.includes(n));
    // High-confidence: requirement title tokens appear in doc title/filename,
    // or the full normalized requirement name is contained in the doc name.
    const strongTitle =
      Boolean(requirementHay) &&
      (hay.includes(requirementHay) ||
        requirementHay
          .split(" ")
          .filter((t) => t.length > 4)
          .every((t) => hay.includes(t)));
    if (!hit && !strongTitle) continue;
    const ready =
      doc.status === "ready" ||
      doc.status === "approved" ||
      doc.status === "drafting" ||
      doc.status === "pending";
    if (!ready) continue;
    return {
      matched: true,
      source: "TENDER",
      companyDocumentId: null,
      workspaceDocumentId: doc.id,
      completionStatus: "COMPLETED_TENDER_DOCUMENT",
      confidence: strongTitle ? 0.9 : 0.8,
      reason: `Linked tender document “${doc.title}” satisfies this requirement.`,
      matchedBy: "SYSTEM",
    };
  }

  const generationAllowed =
    options.generationAllowed === true || fromScratch;
  return {
    matched: false,
    source: null,
    companyDocumentId: null,
    workspaceDocumentId: null,
    completionStatus: generationAllowed ? "MISSING" : "ACTION_REQUIRED",
    confidence: 0,
    reason: generationAllowed
      ? "No matching document. Generate this tender-specific draft with AI."
      : "No valid document found. Upload an existing company certificate or evidence file.",
    matchedBy: "SYSTEM",
  };
}

export function isChecklistItemComplete(
  status: ChecklistCompletionStatus,
): boolean {
  return (
    status === "COMPLETED_COMPANY_DOCUMENT" ||
    status === "COMPLETED_TENDER_DOCUMENT"
  );
}

/** Persisted completion: manual flag OR a valid linked document status. */
export function isRequirementCompleted(options: {
  manualCompleted?: boolean | null;
  completionStatus: ChecklistCompletionStatus;
}): boolean {
  if (options.manualCompleted === true) return true;
  return isChecklistItemComplete(options.completionStatus);
}

export type RequirementCompletionSource =
  | "AI_GENERATED"
  | "UPLOADED"
  | "COMPANY_DOCUMENT"
  | "MANUAL"
  | "MULTIPLE"
  | null;

export function deriveCompletionSource(options: {
  manualCompleted?: boolean | null;
  matchedBy?: "AI" | "USER" | "SYSTEM" | null;
  matchedDocumentSource?: "COMPANY" | "TENDER" | null;
  hasWorkspaceDocument?: boolean;
  hasCompanyDocument?: boolean;
}): RequirementCompletionSource {
  const sources: RequirementCompletionSource[] = [];
  if (options.manualCompleted) sources.push("MANUAL");
  if (options.matchedDocumentSource === "COMPANY" || options.hasCompanyDocument) {
    sources.push("COMPANY_DOCUMENT");
  }
  if (options.matchedDocumentSource === "TENDER" || options.hasWorkspaceDocument) {
    sources.push(options.matchedBy === "AI" ? "AI_GENERATED" : "UPLOADED");
  }
  const unique = [...new Set(sources.filter(Boolean))];
  if (unique.length === 0) return null;
  if (unique.length > 1) return "MULTIPLE";
  return unique[0] ?? null;
}

export type WorkspaceSectionKey =
  | "checklist"
  | "prequalification"
  | "technical"
  | "annexures";

export type RequirementDestinationSection = Exclude<
  WorkspaceSectionKey,
  "checklist"
>;

export type RequirementOrigin = "AI" | "MANUAL" | "SEED";

/** Map checklist category → Bid Workspace section tab. */
export function sectionForChecklistCategory(
  category: string,
): RequirementDestinationSection {
  const c = category.toUpperCase();
  if (c === "TECHNICAL" || c === "BOQ") return "technical";
  if (
    c === "ANNEXURE" ||
    c === "DECLARATION" ||
    c === "AUTHORIZATION" ||
    c === "LEGAL"
  ) {
    return "annexures";
  }
  return "prequalification";
}

/** Prefer explicit workspace_section when set (manual add / section moves). */
export function resolveWorkspaceSection(item: {
  category: string;
  workspaceSection?: string | null;
}): RequirementDestinationSection {
  const section = item.workspaceSection;
  if (
    section === "prequalification" ||
    section === "technical" ||
    section === "annexures"
  ) {
    return section;
  }
  return sectionForChecklistCategory(item.category);
}

export function itemMatchesWorkspaceSection(
  itemOrCategory:
    | string
    | { category: string; workspaceSection?: string | null },
  section: RequirementDestinationSection,
): boolean {
  if (typeof itemOrCategory === "string") {
    return sectionForChecklistCategory(itemOrCategory) === section;
  }
  return resolveWorkspaceSection(itemOrCategory) === section;
}

/**
 * Canonical section progress from unique requirements.
 * Documents nested under a requirement never increase total/completed.
 */
export function calculateSectionProgress<T extends {
  mandatory: boolean;
  category: string;
  workspaceSection?: string | null;
  manualCompleted?: boolean | null;
  completionStatus: ChecklistCompletionStatus;
}>(
  items: T[],
  section?: RequirementDestinationSection,
): { completed: number; total: number; percent: number } {
  const scoped = items.filter((item) => {
    if (!item.mandatory) return false;
    if (!section) return true;
    return itemMatchesWorkspaceSection(item, section);
  });
  const total = scoped.length;
  const completed = scoped.filter((item) =>
    isRequirementCompleted({
      manualCompleted: item.manualCompleted,
      completionStatus: item.completionStatus,
    }),
  ).length;
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

/** Stable identity key used for upsert / duplicate prevention. */
export function normalizeRequirementIdentityKey(
  requirementKey: string,
  requirementName: string,
): string {
  const fromKey = slugRequirementKey(requirementKey || "");
  if (fromKey && fromKey !== "REQUIREMENT") return fromKey;
  return slugRequirementKey(requirementName);
}

/** Exact duplicate after identity normalization (safe to block). */
export function isExactRequirementDuplicate(
  a: { requirementKey?: string | null; requirementName: string },
  b: { requirementKey?: string | null; requirementName: string },
): boolean {
  return (
    normalizeRequirementIdentityKey(
      a.requirementKey || "",
      a.requirementName,
    ) ===
    normalizeRequirementIdentityKey(
      b.requirementKey || "",
      b.requirementName,
    )
  );
}

/**
 * Cautious fuzzy similarity for duplicate warnings / AI↔manual merge.
 * Prefer preserving both when unsure.
 */
export function areRequirementTitlesSimilar(
  titleA: string,
  titleB: string,
): boolean {
  const a = normalizeMatchText(titleA);
  const b = normalizeMatchText(titleB);
  if (!a || !b) return false;
  if (a === b) return true;

  const stripNoise = (value: string) =>
    value
      .replace(
        /\b(letter|certificate|document|form|undertaking|affidavit|copy|of|the|a|an|and|or|for|required|submission)\b/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();

  const sa = stripNoise(a);
  const sb = stripNoise(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;

  const shorter = sa.length <= sb.length ? sa : sb;
  const longer = sa.length > sb.length ? sa : sb;
  // Require meaningful stem overlap — avoid merging short generic titles.
  if (shorter.length < 10) return false;
  if (longer.includes(shorter) || shorter.includes(longer)) return true;

  const tokensA = new Set(sa.split(" ").filter((t) => t.length > 2));
  const tokensB = new Set(sb.split(" ").filter((t) => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 && overlap / union >= 0.75 && overlap >= 2;
}

/** Default category when user picks a destination section without a type. */
export function defaultCategoryForSection(
  section: RequirementDestinationSection,
): ChecklistCategory {
  if (section === "technical") return "TECHNICAL";
  if (section === "annexures") return "ANNEXURE";
  return "COMPLIANCE";
}

export function completionSourceLabel(
  source: RequirementCompletionSource,
): string {
  switch (source) {
    case "AI_GENERATED":
      return "Generated with AI";
    case "UPLOADED":
      return "Uploaded document";
    case "COMPANY_DOCUMENT":
      return "Linked company document";
    case "MANUAL":
      return "Marked as complete manually";
    case "MULTIPLE":
      return "Completed";
    default:
      return "Pending";
  }
}

export function categoryLabel(category: string): string {
  const map: Record<string, string> = {
    COMPLIANCE: "Compliance",
    TECHNICAL: "Technical",
    FINANCIAL: "Financial",
    LEGAL: "Legal",
    EXPERIENCE: "Experience",
    ANNEXURE: "Annexure",
    DECLARATION: "Declaration",
    AUTHORIZATION: "Authorization",
    CERTIFICATE: "Certificate",
    EMD: "EMD",
    BOQ: "BOQ",
    SERVICE: "Service",
    OTHER: "Other",
  };
  return map[category] || category;
}

export function workspaceSectionLabel(
  section: RequirementDestinationSection,
): string {
  if (section === "prequalification") return "Pre-Qualification";
  if (section === "technical") return "Technical";
  return "Annexure";
}

export function buildChecklistSeedFromMissingDocuments(
  missingDocuments: unknown[],
): Array<{
  requirementKey: string;
  requirementName: string;
  category: ChecklistCategory;
  generationAllowed: boolean;
  documentType: string;
  workspaceDocType: RequirementPattern["workspaceDocType"];
}> {
  const titles = missingDocuments
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return String(
          record.name || record.title || record.document || "",
        ).trim();
      }
      return "";
    })
    .filter(Boolean);

  const seen = new Set<string>();
  const rows: Array<{
    requirementKey: string;
    requirementName: string;
    category: ChecklistCategory;
    generationAllowed: boolean;
    documentType: string;
    workspaceDocType: RequirementPattern["workspaceDocType"];
  }> = [];

  for (const title of titles) {
    const pattern = resolveRequirementPattern(title);
    const key = pattern?.key || slugRequirementKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      requirementKey: key,
      requirementName: title,
      category: pattern?.category || "COMPLIANCE",
      generationAllowed: pattern?.generationAllowed === true,
      documentType: pattern?.key || "OTHER",
      workspaceDocType: pattern?.workspaceDocType || "Other",
    });
  }
  return rows;
}

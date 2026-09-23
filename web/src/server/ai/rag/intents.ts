import "server-only";

import type { AskAiAction } from "@/lib/ai/ask-ai-stream";
import { normalizeAskAiActionId } from "@/lib/ai/ask-ai-actions";
import { ACTION_RETRIEVAL_HINTS } from "@/server/ai/rag/action-retrieval";

const SUGGESTION_TO_ACTION: Record<string, AskAiAction> = {
  "assess tender": "ASSESS_TENDER",
  "assess this tender against our available company evidence.":
    "ASSESS_TENDER",
  "check eligibility": "CHECK_ELIGIBILITY",
  "check the eligibility requirements and how our available evidence compares.":
    "CHECK_ELIGIBILITY",
  "check similar experience": "CHECK_SIMILAR_EXPERIENCE",
  "check the similar experience requirement and matching company projects.":
    "CHECK_SIMILAR_EXPERIENCE",
  "check turnover": "CHECK_TURNOVER",
  "check the turnover requirement and whether our available evidence meets it.":
    "CHECK_TURNOVER",
  "check government experience": "CHECK_GOVERNMENT_EXPERIENCE",
  "check whether government or psu experience is required and how our evidence compares.":
    "CHECK_GOVERNMENT_EXPERIENCE",
  "check required documents": "CHECK_REQUIRED_DOCUMENTS",
  "list the required documents and whether we have supporting evidence.":
    "CHECK_REQUIRED_DOCUMENTS",
  "check emd/msme": "CHECK_EMD_MSME",
  "check the emd requirement and any msme/mse/startup exemptions.":
    "CHECK_EMD_MSME",
  "identify risks": "IDENTIFY_RISKS",
  "identify evidence-backed risks in this tender for our bid preparation.":
    "IDENTIFY_RISKS",
  "summarize tender": "SUMMARIZE_TENDER",
  "summarize this tender using the indexed documents.": "SUMMARIZE_TENDER",
};

/** Preserve important tender terms while normalizing whitespace/punctuation noise. */
export function normalizeAskAiQuery(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function resolveAskAiAction(
  message: string,
  explicit?: string | null,
): AskAiAction {
  // Explicit structured action always wins (Phase 7 quick actions).
  const fromExplicit = normalizeAskAiActionId(explicit);
  if (fromExplicit) return fromExplicit;

  const normalized = normalizeAskAiQuery(message).toLowerCase();
  if (SUGGESTION_TO_ACTION[normalized]) {
    return SUGGESTION_TO_ACTION[normalized]!;
  }
  if (/\b(assess|complete assessment|bid assessment)\b/i.test(message)) {
    return "ASSESS_TENDER";
  }
  if (/\b(summarize|summary|executive summary)\b/i.test(message)) {
    return "SUMMARIZE_TENDER";
  }
  if (/\beligibility\b/i.test(message)) return "CHECK_ELIGIBILITY";
  if (/\bturnover\b/i.test(message)) return "CHECK_TURNOVER";
  if (/\bsimilar experience|similar work\b/i.test(message)) {
    return "CHECK_SIMILAR_EXPERIENCE";
  }
  if (/\bgovernment experience|psu\b/i.test(message)) {
    return "CHECK_GOVERNMENT_EXPERIENCE";
  }
  if (/\bemd|msme|mse|earnest money\b/i.test(message)) return "CHECK_EMD_MSME";
  if (/\brequired documents|submission documents\b/i.test(message)) {
    return "CHECK_REQUIRED_DOCUMENTS";
  }
  if (/\brisks?\b/i.test(message)) return "IDENTIFY_RISKS";
  return "GENERAL";
}

/** Enrich FTS query with action-specific terminology (retrieval hints only). */
export function buildFtsQuery(options: {
  normalizedQuestion: string;
  action: AskAiAction;
}): string {
  const hints = ACTION_RETRIEVAL_HINTS[options.action] || [];
  const parts = [options.normalizedQuestion, ...hints.slice(0, 10)];
  const unique = Array.from(
    new Set(
      parts
        .join(" ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 1),
    ),
  ).slice(0, 28);
  return unique.join(" OR ");
}

/**
 * Action-specific output instructions appended to the grounded user prompt.
 * Base system prompt remains shared.
 */
export function actionPromptAddon(action: AskAiAction): string {
  const statusRule =
    "Allowed Status values ONLY: Meets | Does Not Meet | Needs Verification | Not Found. Cite [T#]/[C#] for factual claims. Do not invent evidence.";

  switch (action) {
    case "ASSESS_TENDER":
      return `Produce a concise executive assessment with these Markdown sections:

## Overall assessment
Short factual summary grounded in evidence. Do NOT output a bid / no-bid recommendation as an unsupported AI conclusion.

## Key eligibility requirements
Table: Requirement | Tender requirement | Company evidence | Status | Source
${statusRule}

## Key gaps
Evidence-backed gaps only.

## Risks
Evidence-backed tender risks only.

## Documents to verify
Items that require human confirmation.`;

    case "CHECK_ELIGIBILITY":
      return `Return a Markdown table:
| Requirement | Tender Requirement | Company Evidence | Status | Source |

Every material requirement must show evidence or an explicit absence.
Do not infer compliance from general company capability.
${statusRule}`;

    case "CHECK_TURNOVER":
      return `Return:

## Tender requirement
- required amount
- average vs annual wording
- required financial years
- CA/audited certificate requirement if stated
- source citations

## Company evidence
Available turnover evidence only.

## Comparison
Calculate only when values are explicitly available. Be careful with ₹ / lakhs / crores — do not mix units incorrectly.

## Status
One of: Meets | Does Not Meet | Needs Verification | Not Found
${statusRule}`;

    case "CHECK_SIMILAR_EXPERIENCE":
      return `Extract and compare: type/nature of similar work, number of projects, minimum individual project value, aggregate value if applicable, required customer type, completion period, certificates required.

Preferred table:
| Tender Requirement | Matching Company Project | Evidence | Status | Source |

Do not claim similarity based only on project title if scope evidence is insufficient.
${statusRule}`;

    case "CHECK_GOVERNMENT_EXPERIENCE":
      return `First state whether Government/PSU/ULB experience is:
- Mandatory
- Preferred
- Scoring criterion
- Not found as a requirement

Then compare company evidence. Do NOT treat private-sector projects as government projects.
Cite sources. ${statusRule}`;

    case "CHECK_REQUIRED_DOCUMENTS":
      return `Return checklist table:
| Document | Mandatory? | Available? | Source | Action Required |

Use Yes / No / Needs Verification for Mandatory? and Available?.
Do not claim a company document exists unless indexed evidence supports it.
Cite sources.`;

    case "CHECK_EMD_MSME":
      return `Extract precisely when present: EMD amount, payment mode, bid security form, BG/DD/online requirements, validity, MSME/MSE exemption, startup exemption, exemption conditions, documents needed to claim exemption.

Clearly distinguish:
1) Tender says exemption exists
2) Company appears eligible for exemption

These are not the same. Do not claim company exemption eligibility without company evidence.
Cite sources.`;

    case "IDENTIFY_RISKS":
      return `Only return evidence-backed risks. Categories may include: Eligibility, Financial, Technical, Experience, Documentation, Timeline, Commercial, Security/PBG, EMD, Compliance.

Preferred table:
| Risk | Evidence | Impact | Verification/Action |

Avoid speculative business advice. Cite sources.`;

    case "SUMMARIZE_TENDER":
      return `Return a compact tender summary covering only evidence-supported fields among:
- Tender title
- Authority
- Scope
- Important dates
- Estimated value if found
- EMD
- Eligibility highlights
- Similar experience
- Turnover
- Technical requirements
- Important documents
- Key contractual obligations

If unknown: omit or label Not found. Cite sources. Do not invent values.`;

    default:
      return `Answer the question concisely using only retrieved evidence. Cite [T#] / [C#].`;
  }
}

/**
 * Build prompt-only qualification text for DOCUMENT_TEXT_MODE.
 * Uses company prefs + metadata + compressed document context (never raw 100k+ extracts).
 */
import type { CompanyPreferenceSnapshot } from "../../runScreening/companyPreferences.js";
import { formatNullableInr } from "../../runScreening/screeningPolicy.js";

export function buildDocumentTextQualificationPrompt(options: {
  tenderId: string;
  companySnapshot: CompanyPreferenceSnapshot;
  metadataJson: string;
  /** Pre-compressed qualification-relevant document context. */
  compressedDocumentContext: string;
}): string {
  const { company, preferences } = options.companySnapshot;
  const companyName = company.name || "Siyana Info Solutions Pvt. Ltd.";
  const tenderId = options.tenderId.replace(/^T247-/i, "").replace(/\D/g, "");
  const displayId = `T247-${tenderId}`;

  const preferred =
    preferences.serviceScope.length > 0
      ? preferences.serviceScope.map((s) => `- ${s}`).join("\n")
      : "(none stored)";
  const excluded =
    preferences.excludedScope.length > 0
      ? preferences.excludedScope.map((s) => `- ${s}`).join("\n")
      : "(none stored)";

  const credentials = [
    company.industryType ? `Industry: ${company.industryType}` : null,
    company.businessLocation ? `Location: ${company.businessLocation}` : null,
    company.yearEstablished != null
      ? `Year established: ${company.yearEstablished}`
      : null,
    company.description ? `Description: ${company.description}` : null,
    company.website ? `Website: ${company.website}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `DOCUMENT TEXT MODE QUALIFICATION

Evaluate this tender for ${companyName}.

Company:
${companyName}

Company credentials:
${credentials || "(see Project Sources / company snapshot)"}

Company preferences:

Maximum EMD:
${formatNullableInr(preferences.maxEmdInr)}

Minimum Tender Value:
${formatNullableInr(preferences.minTenderValueInr)}

Maximum Tender Value:
${formatNullableInr(preferences.maxTenderValueInr)}

Preferred Scope:
${preferred}

Excluded Scope:
${excluded}

Tender ID:
${displayId}

Source portal:
TENDER247

Tender metadata:
${options.metadataJson}


Compressed document context:

------------------

${options.compressedDocumentContext || "(no qualification-relevant document context extracted)"}

------------------


IMPORTANT:
- No ZIP, PDF, or DOCX files are attached.
- Document text was cleaned and compressed locally; use this context as the document evidence.
- Use only the company preferences, metadata JSON, and compressed document context above.
- Project Sources credentials may be used as additional company context.
- Return JSON only. No markdown fences. No prose outside JSON.

Use the existing Siyana qualification JSON schema with at least:

{
  "sourcePortal": "TENDER247",
  "sourceTenderId": "${tenderId}",
  "t247Id": "${tenderId}",
  "company": "${companyName}",
  "status": "GO | CONDITIONAL_GO | PARTNER_BID | VERIFY | NO_GO",
  "decisionLabel": "",
  "verdict": "",
  "reason": "",
  "requiredAction": "",
  "confidence": 0,
  "matchedCriteria": [],
  "failedCriteria": [],
  "unclearCriteria": [],
  "missingDocuments": [],
  "conditions": [],
  "partnershipRequiredFor": [],
  "partnershipModeAllowed": [],
  "manualReviewRequired": false
}

Also include when useful:
- "missing": short string of missing evidence
- "risk": short risk note

status must be exactly one of: GO, CONDITIONAL_GO, PARTNER_BID, VERIFY, NO_GO.
`;
}

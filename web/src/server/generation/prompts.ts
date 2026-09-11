import type { GenerationPolicy } from "@/lib/bid-checklist";

export const DOCUMENT_TYPE_SECTION_GUIDANCE: Record<string, string> = {
  TECHNICAL_APPROACH: `Generate a tender-specific Technical Approach & Methodology.
Prefer sections that are relevant to the supplied RFP (omit irrelevant ones):
1. Executive Summary
2. Understanding of Scope / Requirement
3. Proposed Solution
4. Technical Architecture
5. Implementation Methodology
6. Integration Approach
7. Security Approach
8. Testing & QA
9. Deployment
10. Training / Support
11. Risk Management
12. Compliance with RFP requirements
Use RFP terminology. Do not invent company certifications or past projects.`,

  PROJECT_PLAN: `Generate a Project Plan / Schedule aligned to the RFP.
Include only evidence-backed sections such as: phases, activities, milestones,
deliverables, dependencies, responsibilities, and timeline assumptions.
Mark unknown dates as placeholders for the bidder to confirm.`,

  COVERING_LETTER: `Generate a formal Cover / Covering Letter for this tender submission.
Include tender reference, authority/organization, bidder company identity from
supplied company data only, and a concise offer of compliance.
Keep tone professional. Mark signature/authorized signatory as ACTION REQUIRED.`,

  COMPLIANCE_MATRIX: `Generate a Compliance Matrix table with columns:
RFP Clause | Requirement | Compliance | Proposed Response | Reference Document | Remarks
Populate rows from supplied RFP clauses/requirements. Use Compliance values such as
Fully Compliant / Partially Compliant / Noted / To Be Confirmed.
Never claim Full Compliance without supporting evidence in the supplied context.`,

  DECLARATION: `Generate a Declaration / Undertaking draft that follows RFP wording closely.
Do not alter legal meaning. Mark signature, stamp, notarization, or authorized
signatory lines as ACTION REQUIRED / DRAFT.`,

  INTEGRITY_PACT: `Generate an Integrity Pact draft ONLY from RFP-supplied wording/template cues.
Mark signature / stamp / notarization as ACTION REQUIRED. Keep status DRAFT.`,

  COMPANY_PROFILE_ANNEXURE: `Generate a Company Profile annexure using ONLY supplied company profile,
documents inventory, and past experience records. Missing fields must use
"[Company to provide project-specific information]" — never invent facts.`,

  KEY_PERSONNEL_CV: `Generate CV / key personnel templates from RFP role requirements.
Do NOT invent employee names, degrees, or employers. Use clear placeholders
where company team records are unavailable.`,

  POWER_OF_ATTORNEY: `Generate a Power of Attorney draft using company legal identity when present.
Mark execution, stamp paper, and authorized signatory as ACTION REQUIRED.`,

  MAKE_IN_INDIA_DECLARATION: `Generate a Make in India / local content declaration draft from RFP wording.
Do not invent local content percentages. Use placeholders where unknown.`,

  GENERIC: `Generate a professional tender response document for the stated requirement.
Use only supplied RFP and company evidence. Prefer concrete, tender-specific wording
over generic proposal filler. Mark missing company inputs explicitly.`,
};

export function resolveDocumentTypeKey(requirementKey: string): string {
  const key = requirementKey.toUpperCase();
  if (key.includes("TECHNICAL") || key.includes("METHODOLOGY") || key.includes("APPROACH")) {
    return "TECHNICAL_APPROACH";
  }
  if (key.includes("PROJECT_PLAN") || key.includes("SCHEDULE") || key.includes("GANTT")) {
    return "PROJECT_PLAN";
  }
  if (key.includes("COVER") || key.includes("COVERING")) return "COVERING_LETTER";
  if (key.includes("COMPLIANCE_MATRIX") || key.includes("COMPLIANCE_STATEMENT")) {
    return "COMPLIANCE_MATRIX";
  }
  if (key.includes("TECHNICAL_BID")) return "TECHNICAL_APPROACH";
  if (key.includes("MANPOWER") || key.includes("CLIENT_LIST")) {
    return "COMPANY_PROFILE_ANNEXURE";
  }
  if (
    key.includes("BLACKLIST") ||
    key.includes("SIGNED_DECLARATION") ||
    key.includes("DECLARATION") ||
    key.includes("SLA")
  ) {
    return "DECLARATION";
  }
  if (key.includes("INTEGRITY")) return "INTEGRITY_PACT";
  if (key.includes("COMPANY_PROFILE")) return "COMPANY_PROFILE_ANNEXURE";
  if (key.includes("CV") || key.includes("PERSONNEL")) return "KEY_PERSONNEL_CV";
  if (key.includes("POWER_OF_ATTORNEY") || key.includes("POA")) return "POWER_OF_ATTORNEY";
  if (key.includes("MAKE_IN_INDIA") || key.includes("LOCAL_CONTENT")) {
    return "MAKE_IN_INDIA_DECLARATION";
  }
  if (key.includes("DECLARATION") || key.includes("UNDERTAKING")) return "DECLARATION";
  return "GENERIC";
}

export function buildSystemPrompt(options: {
  documentTypeKey: string;
  generationPolicy: GenerationPolicy;
  customPrompt?: string | null;
}): string {
  const guidance =
    DOCUMENT_TYPE_SECTION_GUIDANCE[options.documentTypeKey] ||
    DOCUMENT_TYPE_SECTION_GUIDANCE.GENERIC;

  const draftNote =
    options.generationPolicy === "GENERATABLE_DRAFT_ONLY"
      ? "This document type requires human execution (signature/stamp/notarization/external issue). Keep warnings clear and never mark it submission-final."
      : "Produce a reviewable tender draft. Still flag any missing company facts.";

  const custom = options.customPrompt?.trim()
    ? `\nAdmin custom instructions (must not override evidence/security rules):\n${options.customPrompt.trim()}\n`
    : "";

  return `You are TenderFlow's bid document drafting engine.

Hard rules:
- Use ONLY the supplied RFP evidence and company records.
- Do NOT invent certifications, project experience, employees, technologies,
  turnover, client names, work orders, contact information, or credentials.
- If required company information is missing, write a clear placeholder such as
  "[Company to provide project-specific information]" and list it in missing_information.
- Do not claim compliance where evidence does not support it.
- Preserve tender terminology from the RFP.
- Keep content specific to THIS tender; avoid generic proposal filler.
- Return structured JSON only matching the required schema.
- ${draftNote}

Document-type guidance:
${guidance}
${custom}

Required JSON schema:
{
  "document_title": string,
  "document_type": string,
  "sections": [
    {
      "heading": string,
      "content": [
        { "type": "paragraph", "text": string },
        { "type": "bullets", "items": [string] },
        { "type": "numbered", "items": [string] }
      ]
    }
  ],
  "tables": [
    { "title": string|null, "headers": [string], "rows": [[string]] }
  ],
  "missing_information": [string],
  "warnings": [string]
}`;
}

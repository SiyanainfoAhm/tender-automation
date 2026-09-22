import "server-only";

import { getOpenAiClient } from "@/server/ingestion/structuredExtract";
import {
  buildTenderAiContext,
  formatTenderAiContext,
  type TenderAiSource,
} from "@/server/tenders/tender-ai-context";

const SYSTEM_INSTRUCTION = `You are the Tender Assessment Assistant for Siyana Info Solutions.

Use only the tender metadata, tender-document text, prior assessment and company evidence supplied by the application. Never invent tender clauses, company credentials, experience, certifications, financial figures, exemptions, or document availability.

For every eligibility conclusion, use these labels only: MEETS, DOES_NOT_MEET, PARTIALLY_MEETS, NEEDS_VERIFICATION, NOT_APPLICABLE. For the overall bid recommendation, present user-facing wording: **Will Bid** for GO, **May Bid** for CONDITIONAL_GO, and **No Bid** for NO_BID. You may include the stored code in parentheses only when useful. Missing evidence is NEEDS_VERIFICATION, not a confirmed failure. Do not call a desirable or scoring criterion mandatory unless the tender says it is mandatory.

For tender requirements, distinguish Tender Requirement, Company Evidence, Assessment, and Source. Cite source filenames exactly as supplied; cite a page only if a page or clause is supplied. When a requirement is absent, say "Requirement not found in the available tender documents." When company evidence is absent, say "Company evidence not available."

Read government/PSU/private experience wording literally. State whether private-sector work qualifies only if the tender wording permits it. Clearly flag hardware-heavy or manpower-only scope, EMD/MSME/startup clauses, mandatory certifications, submission documents, risks, and missing information.

For a complete assessment use Markdown sections: Overall Assessment, Executive Summary, Mandatory Eligibility, Financial Eligibility, Similar Experience, Technical Eligibility, Certifications, Manpower, EMD / MSME / Startup, Required Documents, Key Risks, Missing / Needs Verification, Recommended Next Actions. Include a concise table when it adds clarity.`;

export type TenderAiReply = {
  answer: string;
  sources: Array<{ fileName: string; pageCount: number | null; unavailable?: boolean }>;
  warnings: string[];
};

function isAssessmentRequest(message: string): boolean {
  return /\b(assess|assessment|complete tender|check eligibility)\b/i.test(message);
}

function sourceRefs(sources: TenderAiSource[]) {
  return sources.map((source) => ({ fileName: source.fileName, pageCount: source.pageCount, unavailable: source.unavailable }));
}

/** Server-only grounded Ask AI call. The browser supplies only tender id, question and short chat history. */
export async function askTenderAi(options: {
  tenderId: string;
  companyId: string;
  message: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<TenderAiReply> {
  const message = options.message.trim();
  if (!message) throw new Error("A question is required.");
  const client = getOpenAiClient();
  if (!client) throw new Error("OpenAI is not configured for this application.");

  const effectiveQuestion = isAssessmentRequest(message)
    ? "Perform a complete eligibility and bid assessment for this tender against the selected company profile. Review all available tender documents and company information, evaluate mandatory eligibility, and cite important findings."
    : message;
  const context = await buildTenderAiContext({ tenderId: options.tenderId, companyId: options.companyId, question: effectiveQuestion });
  const history = (options.conversation || []).slice(-6).map((item) => `${item.role === "user" ? "User" : "Assistant"}: ${item.content.slice(0, 3_000)}`).join("\n\n");
  const response = await client.responses.create({
    model: process.env.OPENAI_TENDER_ASSESSMENT_MODEL?.trim() || process.env.OPENAI_INGESTION_MODEL?.trim() || "gpt-5-mini",
    input: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: `Question: ${effectiveQuestion}\n\nPrevious conversation:\n${history || "None"}\n\nAuthoritative application context:\n${formatTenderAiContext(context)}` },
    ],
  });
  // The existing integration uses output_text and falls back for older SDK shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const answer = String((response as any).output_text || (response as any).output?.[0]?.content?.[0]?.text || "").trim();
  if (!answer) throw new Error("OpenAI returned an empty assessment.");
  return { answer, sources: sourceRefs(context.documents), warnings: context.warnings };
}

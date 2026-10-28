// One requirement check per tender (RFP clauses vs Siyana's verified company documents,
// owner rules and credential records), cached so every chatbot answer uses the same facts.
import {assessQualification,QUALIFICATION_VERSION} from './qualification.mjs';
import {chatQualificationAnswer} from './official-evaluation.mjs';

export const COMPANY_CHECK_VERSION = QUALIFICATION_VERSION + '+checks-20261028b';
const MAX_AGE_MS = 12 * 3600 * 1000;

export async function getCompanyCheck({db, tender, companyId, allowCompany, aiKey, signal, refresh = false}) {
  if (!allowCompany) return null;
  let stamp = '';
  try {
    const s = await db.rpc('agenttender_company_check_stamp', {p_tender_id: tender.id, p_company_id: companyId});
    stamp = String(s.data || '');
  } catch { /* cache is optional */ }
  if (!refresh && stamp) {
    const {data} = await db.from('agenttender_chat_company_checks')
      .select('version,stamp,report,sources,created_at').eq('tender_id', tender.id).eq('company_id', companyId).maybeSingle();
    if (data && data.version === COMPANY_CHECK_VERSION && data.stamp === stamp && Date.now() - Date.parse(data.created_at) < MAX_AGE_MS) {
      return {report: data.report, sources: data.sources || [], cached: true};
    }
  }
  const evaluated = await assessQualification({db, tender, companyId, question: 'Do we qualify for this tender? Check every mandatory eligibility condition.', allowCompany, aiKey, signal});
  const sources = (evaluated.sources || []).map(({text, metadata, ...s}) => s);
  if (stamp) {
    await db.from('agenttender_chat_company_checks').upsert({tender_id: tender.id, company_id: companyId, version: COMPANY_CHECK_VERSION, stamp, report: evaluated.report, sources, created_at: new Date().toISOString()}).then(() => {}, () => {});
  }
  return {report: evaluated.report, sources, cached: false};
}

/** Compact, plain rows handed to the answer model as verified company facts. */
export function companyCheckContext(report, ev) {
  if (!report) return null;
  const decisionLine = chatQualificationAnswer(report, ev).split('\n')[0].replace(/\*\*/g, '').replace(/^Decision:\s*/, '').replace(/\s*\(evaluated.*$/, '');
  return {
    decision: decisionLine,
    rows: (report.requirements || []).filter((r) => r.mandatory !== false).map((r) => ({
      category: r.category,
      requirement: String(r.requirement || '').slice(0, 260),
      result: r.result,
      finding: String(r.calculation?.explanation || r.explanation || '').slice(0, 360),
      company_documents: [...new Set([...(r.company_evidence || []).map((e) => e.document), ...((r.calculation?.company_documents) || []).map((e) => e.document), ...((r.calculation?.evidence) || []).map((e) => e.source_document_name)].filter(Boolean))].slice(0, 4),
    })),
  };
}

export const COMPANY_CHECK_INSTRUCTION =
  '\nCOMPANY CHECK (binding facts): company_check compares every mandatory RFP condition with Siyana’s verified company ' +
  'documents (CA certificates, audited accounts, ISO/CMMI certificates, incorporation, work orders) and the owner rules. ' +
  'For any statement about whether Siyana meets a condition, use company_check: PASS = met (name the company document), ' +
  'FAIL = not met (say why), UNKNOWN = not yet proven. Never say a document is missing or a condition is unproven when ' +
  'company_check marks it PASS, and never contradict a FAIL. Use company_evidence chunks only to add detail.';

// One requirement check per tender (RFP clauses vs Siyana's verified company documents,
// owner rules and credential records), cached so every chatbot answer uses the same facts.
import {assessQualification,QUALIFICATION_VERSION} from './qualification.mjs';
import {chatQualificationAnswer} from './official-evaluation.mjs';
import {retrieve} from './analyst.ts';
import {activeRules} from './policy.mjs';
import {loadCredentials} from './company-credentials-store.mjs';

export const COMPANY_CHECK_VERSION = QUALIFICATION_VERSION + '+checks-20261028d';
// The stamp already changes whenever company documents, RFP documents or rules change.
// Saved checks from earlier versions of the same day stay valid: the table clean-up (placeholder rows,
// Scope / deadline rows, duplicates) is applied when the answer is built, so a version bump must not
// force a slow full re-read of every tender (that re-read can exceed the function's resource limit).
const compatibleVersion = (v) => String(v || '').startsWith('v2-material-qualification-20261028') && String(v).endsWith('+checks-20261028d');
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export async function getCompanyCheck({db, tender, companyId, allowCompany, aiKey, signal, refresh = false, cacheOnly = false}) {
  if (!allowCompany) return null;
  let stamp = '';
  try {
    const s = await db.rpc('agenttender_company_check_stamp', {p_tender_id: tender.id, p_company_id: companyId});
    stamp = String(s.data || '');
  } catch { /* cache is optional */ }
  if (!refresh && stamp) {
    const {data} = await db.from('agenttender_chat_company_checks')
      .select('version,stamp,report,sources,created_at').eq('tender_id', tender.id).eq('company_id', companyId).maybeSingle();
    if (data && compatibleVersion(data.version) && data.stamp === stamp && Date.now() - Date.parse(data.created_at) < MAX_AGE_MS) {
      return {report: data.report, sources: data.sources || [], cached: true};
    }
  }
  if (cacheOnly) return null;
  const question = 'Read every mandatory pre-qualification condition in the RFP (bidder type, years in business, turnover, net worth, similar project experience, certifications, registrations, blacklisting, EMD) and compare it against verified Siyana evidence.';
  // Clause extraction varies between runs; two independent readings are merged so no
  // mandatory condition found by either reading is lost.
  // Load the RFP excerpts, rules and company records once, then run both readings in parallel.
  const [data, rules, credentials] = await Promise.all([
    retrieve(db, tender.id, companyId, question, 'ELIGIBILITY', 'DO_WE_QUALIFY', allowCompany),
    activeRules(db),
    loadCredentials(db, companyId),
  ]);
  const shared = {data, rules, credentials};
  // One reading keeps a first-time check inside the function's CPU / memory limit (two parallel readings exceeded it).
  const readings = await Promise.allSettled([0].map(() => assessQualification({db, tender, companyId, question, allowCompany, aiKey, signal, shared})));
  const ok = readings.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw readings[0].reason;
  const evaluated = mergeReadings(ok);
  const sources = (evaluated.sources || []).map(({text, metadata, ...s}) => s);
  if (stamp) {
    await db.from('agenttender_chat_company_checks').upsert({tender_id: tender.id, company_id: companyId, version: COMPANY_CHECK_VERSION, stamp, report: evaluated.report, sources, created_at: new Date().toISOString()}).then(() => {}, () => {});
  }
  return {report: evaluated.report, sources, cached: false, credentials};
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

const words = (t) => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
function similar(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return false;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.55;
}
const RANK = {FAIL: 3, PASS: 2, UNKNOWN: 1};

/** Union of requirement rows from several readings; a decided row beats an UNKNOWN duplicate. */
export function mergeReadings(readings) {
  const sorted = [...readings].sort((a, b) => (b.report?.requirements?.length || 0) - (a.report?.requirements?.length || 0));
  const base = sorted[0];
  const rows = [...(base.report?.requirements || [])];
  const sources = [...(base.sources || [])];
  for (const other of sorted.slice(1)) {
    const refMap = new Map();
    for (const s of other.sources || []) {
      const same = sources.find((x) => x.chunk_id && x.chunk_id === s.chunk_id);
      if (same) refMap.set(s.ref, same.ref);
      else { const ref = (s.ref || 'S')[0] + (sources.length + 1) + 'm'; sources.push({...s, ref}); refMap.set(s.ref, ref); }
    }
    const remap = (list) => (list || []).map((e) => ({...e, ref: refMap.get(e.ref) || e.ref}));
    for (const r of other.report?.requirements || []) {
      const row = {...r, rfp_evidence: remap(r.rfp_evidence), company_evidence: remap(r.company_evidence)};
      const i = rows.findIndex((x) => similar(x.requirement, r.requirement));
      if (i < 0) rows.push(row);
      else if ((RANK[r.result] || 0) > (RANK[rows[i].result] || 0)) rows[i] = row;
    }
  }
  return {...base, report: {...base.report, requirements: rows, merged_readings: readings.length}, sources};
}

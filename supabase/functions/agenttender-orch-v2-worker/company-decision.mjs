// Turns proven company-document shortfalls into a rule-backed NO_GO the database validator accepts.
export const COMPANY_RULE = 'COMPANY_MANDATORY_PQ_FAILURE';
const inr = (n) => '₹' + Math.round(Number(n)).toLocaleString('en-IN');

/** Mandatory FAIL rows proven deterministically from Siyana's verified documents. */
export function provenCompanyFailures(report, sources) {
  const out = [];
  for (const r of report?.requirements || []) {
    if (r.mandatory === false || r.result !== 'FAIL') continue;
    const c = r.calculation || {};
    const turnover = r.category === 'Turnover' && Number.isFinite(c.value_inr) && Number.isFinite(c.required_inr) && c.value_inr < c.required_inr && (c.evidence || []).length > 0;
    const documentCheck = (c.company_documents || []).length > 0;
    if (!turnover && !documentCheck) continue;
    const rfp = (r.rfp_evidence || []).find((e) => String(e.quote || '').trim().length >= 25);
    const src = rfp && (sources || []).find((s) => s.ref === rfp.ref);
    if (!src?.chunk_id) continue;
    const documents = [...new Set(turnover ? c.evidence.map((e) => e.source_document_name).filter(Boolean) : c.company_documents.map((e) => e.document))];
    const reason = turnover
      ? `${c.method === 'average' ? 'average' : c.method || ''} turnover ${inr(c.value_inr)} is below the required ${inr(c.required_inr)} (${(c.annual_values || []).map((v) => 'FY ' + v.year + ' ' + inr(v.amount_inr)).join(', ')})`
      : String(c.explanation || r.explanation || '');
    out.push({requirement: String(r.requirement || '').slice(0, 300), reason, documents, chunk_id: src.chunk_id, excerpt: String(rfp.quote).trim(), document_name: src.document || null});
  }
  return out;
}

/** Mutates the assessment into a validated NO_GO; returns null when the rule is not enabled. */
export function companyFailureOverride(assessment, proven, context) {
  const rule = (context?.owner_rules || []).find((r) => r.code === COMPANY_RULE);
  if (!rule || !proven.length) return null;
  const reason = 'Siyana does not meet ' + (proven.length > 1 ? proven.length + ' mandatory conditions' : 'a mandatory condition') + ' of the RFP: ' +
    proven.map((p) => `${p.requirement.replace(/\.$/, '')} — ${p.reason.replace(/\.$/, '')}${p.documents.length ? ' (' + p.documents.join(', ') + ')' : ''}`).join('; ') + '.';
  assessment.final_decision = 'NO_GO';
  assessment.evidence_verified = true;
  assessment.confidence = Math.max(assessment.confidence || 0, 0.95);
  assessment.matched_rule_codes = [...new Set([COMPANY_RULE, ...(assessment.matched_rule_codes || [])])];
  assessment.rule_versions = {...(assessment.rule_versions || {}), [COMPANY_RULE]: rule.version};
  assessment.evidence_used = [
    ...proven.map((p) => ({rule_code: COMPANY_RULE, establishes: 'MANDATORY_FAILURE', exceptions_checked: true, chunk_id: p.chunk_id, document_name: p.document_name, excerpt: p.excerpt})),
    ...(assessment.evidence_used || []),
  ].slice(0, 12);
  assessment.company_evidence = [...proven.flatMap((p) => p.documents.map((d) => ({document: d, rule_code: COMPANY_RULE, finding: p.reason.slice(0, 300)}))), ...(assessment.company_evidence || [])].slice(0, 8);
  assessment.business_reason = reason.slice(0, 1800);
  assessment.decided_by = 'COMPANY_DOCUMENT_CHECK';
  return {reason};
}

const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
const overlap = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };

/**
 * Record the company check as requirement findings (the commit step reads them), and upgrade
 * evaluator findings that the company documents now prove. Existing findings are never deleted.
 */
export async function syncCompanyFindings(db, tenderId, report, sources) {
  const rows = (report?.requirements || []).filter((r) => r.mandatory !== false);
  if (!rows.length) return {written: 0, upgraded: 0};
  const docsOf = (r) => {
    const c = r.calculation || {};
    const names = [...(c.company_documents || []).map((e) => e.document), ...(c.evidence || []).map((e) => e.source_document_name || e.document), ...(r.company_evidence || []).map((e) => e.document)].filter(Boolean);
    return [...new Set(names)].map((document) => ({document, source: 'COMPANY_CHECK'}));
  };
  const rfpOf = (r) => (r.rfp_evidence || []).map((e) => ({ref: e.ref, quote: e.quote, document: e.document, page: e.page, chunk_id: (sources || []).find((s) => s.ref === e.ref)?.chunk_id || null}));
  const records = rows.map((r) => ({
    tender_id: tenderId,
    requirement_key: ('COMPANY_CHECK:' + String(r.requirement || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')).slice(0, 180),
    requirement_text: String(r.requirement || '').slice(0, 3000),
    // Scope, deadline and EMD are tender-side checks (EMD has its own financial gate), not company proof.
    mandatory: !['Scope', 'Deadline / amendments', 'EMD'].includes(r.category),
    verdict: ['PASS', 'FAIL'].includes(r.result) ? r.result : 'UNKNOWN',
    rfp_evidence: rfpOf(r),
    company_evidence: r.result === 'UNKNOWN' ? [] : docsOf(r),
    explanation: String(r.calculation?.explanation || r.explanation || '').slice(0, 2000),
  }));
  const {error} = await db.from('agenttender_orch_v2_requirement_findings').upsert(records, {onConflict: 'tender_id,requirement_key'});
  if (error) throw error;
  // Evaluator findings left UNKNOWN that the company check proves PASS / FAIL.
  const {data: existing} = await db.from('agenttender_orch_v2_requirement_findings').select('requirement_key,requirement_text,verdict,mandatory').eq('tender_id', tenderId).not('requirement_key', 'like', 'COMPANY_CHECK:%').limit(200);
  let upgraded = 0;
  for (const f of existing || []) {
    if (f.verdict !== 'UNKNOWN') continue;
    const match = records.filter((r) => r.verdict !== 'UNKNOWN' && r.company_evidence.length).map((r) => ({r, s: overlap(f.requirement_text, r.requirement_text)})).sort((a, b) => b.s - a.s)[0];
    if (!match || match.s < 0.6) continue;
    const u = await db.from('agenttender_orch_v2_requirement_findings').update({verdict: match.r.verdict, company_evidence: match.r.company_evidence, explanation: ('Company check: ' + match.r.explanation).slice(0, 2000)}).eq('tender_id', tenderId).eq('requirement_key', f.requirement_key);
    if (!u.error) upgraded++;
  }
  return {written: records.length, upgraded};
}

/** Company check computed by the chat function (separate isolate, shared cache). */
export async function fetchCompanyCheck(tenderId, companyId) {
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(url + '/functions/v1/agenttender-orch-v2-chat', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': 'application/json'},
    body: JSON.stringify({action: 'company_check', tender_id: tenderId, company_id: companyId, question: 'company check'}),
    signal: AbortSignal.timeout(170000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok || !j.report) throw Error('COMPANY_CHECK_UNAVAILABLE: ' + (j.error || ('HTTP ' + r.status)));
  return j;
}

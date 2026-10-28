import {prequalificationTable,isPrequalificationRow,pqRows} from './pq-table.mjs';
// The tender chatbot speaks from the SAME evaluation the daily V2 orchestrator made
// (agenttender_v2_decision_audit + requirement findings + recorded status/reason),
// so chat answers never contradict the GO / NO_GO / CONDITIONAL_GO shown in TenderFlow.

const NO_GO_STATUSES = new Set(['NO_GO', 'DISQUALIFIED', 'CANCELLED', 'DELETE', 'DUPLICATE']);
const GO_STATUSES = new Set(['GO', 'PARTNER_BID', 'SUBMITTED', 'WON', 'LOST', 'TECHNICAL_REJECTED', 'FINANCIAL_REJECTED']);

const LABEL = {
  GO: 'GO',
  CONDITIONAL_GO: 'CONDITIONAL GO',
  NO_GO: 'NO-GO',
  VERIFY: 'VERIFY',
  REVIEW: 'REVIEW',
  PARTNER_BID: 'PARTNER BID',
  SUBMITTED: 'SUBMITTED',
  WON: 'WON',
  LOST: 'LOST',
  DISQUALIFIED: 'DISQUALIFIED',
  CANCELLED: 'CANCELLED',
  DUPLICATE: 'DUPLICATE',
  DELETE: 'REMOVED',
  TECHNICAL_REJECTED: 'TECHNICAL REJECTED',
  FINANCIAL_REJECTED: 'FINANCIAL REJECTED',
};

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const inr = (n) => (Number.isFinite(Number(n)) ? '₹' + Number(n).toLocaleString('en-IN') : null);
const dateIn = (v) => {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    : null;
};

/** Plain-language explanation for internal pipeline codes. */
export function describePipelineReason(text) {
  const s = String(text || '');
  if (/TENDER247_ACQUISITION_REQUIRED|SOURCE_ACQUISITION_BLOCKED/i.test(s))
    return 'The tender documents have not been downloaded from the portal yet, so the full evaluation is waiting for them.';
  if (/TARGETED_SOURCE_ACQUISITION/i.test(s))
    return 'Some tender documents are still being collected; the full evaluation runs once they are available.';
  if (/MISSING_SOURCE_EVIDENCE/i.test(s))
    return 'The full RFP document was not available, so eligibility could not be checked.';
  if (/EVIDENCE_REFRESH_REQUIRED/i.test(s))
    return 'The tender documents changed; a fresh evaluation is pending.';
  if (/PREPARATION|WORKER_RESOURCE_LIMIT|compute resources/i.test(s))
    return 'Document processing failed temporarily; the evaluation will be retried.';
  return 'The automatic evaluation has not finished yet.';
}

/** Human-written parts of a recorded reason (e.g. "... | Removed from VERIFY 2026-10-27 by user: scope is India only"). */
function humanParts(text) {
  return clean(text)
    .split(/\s+\|\s+/)
    .filter((p) => p && !machineReason(p))
    .map((p) => p.replace(/^Removed from [A-Z_ -]+ (\d{4}-\d{2}-\d{2}) by user:\s*/i, 'Marked by user on $1: '));
}

/** Remove machine prefixes such as "NO_GO — validated approved rule(s): X. Evidence:". */
function plainReason(text) {
  const human = humanParts(text);
  if (clean(text) && machineReason(clean(text).split(/\s+\|\s+/)[0]) && human.length) return human.join(' ');
  let s = clean(text);
  s = s.replace(/^(?:NO[_ -]?GO|CONDITIONAL[_ ]GO|GO|VERIFY|REVIEW)\s*[—:-]\s*/i, '');
  s = s.replace(/^validated approved rule\(s\):\s*[A-Z0-9_, ]+\.\s*/i, '');
  s = s.replace(/^supported custom software scope:\s*[A-Z0-9_, ]+\.\s*/i, '');
  s = s.replace(/\bEvidence:\s*/i, 'Tender text: ');
  return machineReason(s) ? '' : s;
}

/** Internal pipeline codes / errors are not a business reason a user can act on. */
function machineReason(text) {
  const s = clean(text);
  if (!s) return false;
  if (/\b(?:Error|Exception|DEPENDENCY_PENDING|EVIDENCE_PENDING|TIMEOUT|HTTP \d{3})\b/i.test(s)) return true;
  // Mostly UPPER_SNAKE tokens with little prose
  const words = s.split(/\s+/);
  const codes = words.filter((w) => /^[A-Z0-9]+(?:_[A-Z0-9]+)+[:.,]?$/.test(w)).length;
  return codes > 0 && codes / words.length > 0.25;
}

const PENDING_REASON = {
  VERIFY: 'The automatic evaluation has not finished for this tender — some tender documents are still being collected and checked. The requirement check below shows what is already known.',
  REVIEW: 'This tender needs a manual review. The requirement check below shows what is already known.',
  CONDITIONAL_GO: 'Siyana can bid if the conditions listed below are met.',
  GO: 'The tender matches Siyana’s target business and eligibility.',
  NO_GO: 'The tender was marked NO-GO.',
};

function shortRuleTitle(title) {
  // Owner rule titles are long policy sentences; keep the first clause for display.
  let s = clean(title).replace(/^Owner hard NO_GO:\s*/i, '').replace(/^Preferred fit:\s*/i, '');
  const cut = s.search(/[.;](\s|$)/);
  if (cut > 30) s = s.slice(0, cut);
  return s.length > 160 ? s.slice(0, 157).trimEnd() + '…' : s;
}

export async function loadOfficialEvaluation(db, tender) {
  const [audit, findings, rules, qr] = await Promise.all([
    db.from('agenttender_v2_decision_audit')
      .select('final_decision,reason,matched_rule_codes,decision_at,assessment')
      .eq('tender_id', tender.id).order('decision_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('agenttender_orch_v2_requirement_findings')
      .select('requirement_text,mandatory,verdict,explanation')
      .eq('tender_id', tender.id).limit(60),
    db.from('agenttender_eligibility_rules').select('code,title,decision').eq('enabled', true),
    db.from('agenttender_qualification_results')
      .select('verdict,decision_label,reason,required_action,failed_criteria,missing_documents,conditions,updated_at')
      .eq('tender_id', tender.id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const a = audit.data || null;
  const ruleByCode = new Map((rules.data || []).map((r) => [r.code, r]));
  const codes = Array.isArray(a?.matched_rule_codes) ? a.matched_rule_codes : [];
  const status = clean(tender.qualification_status).toUpperCase() || null;
  const v2Decision = a?.final_decision ? String(a.final_decision).toUpperCase() : null;

  // The recorded tender status is what TenderFlow shows; it may be a later human decision.
  let decision = status || v2Decision;
  if (!decision && qr.data?.verdict) decision = String(qr.data.verdict).toUpperCase();
  const family = !decision ? 'NONE'
    : NO_GO_STATUSES.has(decision) ? 'NO_GO'
    : GO_STATUSES.has(decision) ? 'GO'
    : decision === 'CONDITIONAL_GO' ? 'CONDITIONAL_GO'
    : 'VERIFY';

  const assessment = a?.assessment || {};
  const familyOf = (d) => (!d ? null : NO_GO_STATUSES.has(d) ? 'NO_GO' : GO_STATUSES.has(d) ? 'GO' : d === 'CONDITIONAL_GO' ? 'CONDITIONAL_GO' : 'VERIFY');
  // When the recorded status was changed after the automatic run (owner decision, EMD,
  // deadline), the automatic reasoning no longer explains it: use the recorded reason.
  const overridden = Boolean(status && v2Decision && familyOf(status) !== familyOf(v2Decision));
  const usable = (t) => (machineReason(t) ? '' : clean(t));
  const recorded = (overridden
    ? plainReason(tender.prescreen_reason) || usable(qr.data?.reason)
    : usable(assessment.business_reason) ||
      plainReason(a?.reason) ||
      plainReason(tender.prescreen_reason) ||
      usable(qr.data?.reason)) || '';
  const pendingText = tender.prescreen_reason || a?.reason || '';
  // VERIFY / not evaluated with only pipeline codes on record = evaluation still pending.
  const pending = (family === 'VERIFY' || family === 'NONE') && (!recorded || machineReason(pendingText));
  const reason = recorded && !pending
    ? recorded
    : decision
      ? (family === 'VERIFY' || family === 'NONE' ? describePipelineReason(pendingText) : PENDING_REASON[family])
      : null;

  return {
    available: Boolean(decision && reason),
    decision,
    family,
    label: LABEL[decision] || decision,
    v2_decision: v2Decision,
    status_overrides_v2: overridden,
    pending,
    decided_on: dateIn(a?.decision_at || qr.data?.updated_at),
    reason,
    rules: (overridden ? [] : codes).map((code) => ({
      code,
      title: shortRuleTitle(ruleByCode.get(code)?.title || code),
      kind: ruleByCode.get(code)?.decision || null,
    })),
    emd: overridden ? null : assessment.emd_assessment || null,
    blocking_issues: Array.isArray(assessment.blocking_issues) ? assessment.blocking_issues.slice(0, 8) : [],
    missing_company_evidence: Array.isArray(assessment.missing_company_evidence)
      ? assessment.missing_company_evidence.slice(0, 8) : [],
    findings: (findings.data || []).map((f) => ({
      requirement: clean(f.requirement_text).slice(0, 240),
      mandatory: f.mandatory,
      verdict: f.verdict,
      explanation: clean(f.explanation).slice(0, 400),
    })),
    qualification_result: qr.data
      ? {
          verdict: qr.data.verdict,
          reason: clean(qr.data.reason).slice(0, 1200),
          required_action: clean(qr.data.required_action).slice(0, 600),
          failed_criteria: qr.data.failed_criteria || null,
          missing_documents: qr.data.missing_documents || null,
          conditions: qr.data.conditions || null,
        }
      : null,
  };
}

function emdLine(ev, tender) {
  const e = ev.emd || {};
  if (e.payable_verified && Number(e.payable_amount) === 0) return 'EMD: Not payable (₹0).';
  const amount = inr(e.payable_amount ?? tender.emd_amount);
  return amount ? `EMD listed: ${amount}.` : null;
}

const NOT_NEEDED = {
  EMD: 'Because the tender is NO-GO, no EMD needs to be arranged.',
  DO_WE_QUALIFY: 'Siyana will not bid, so the detailed eligibility check was not needed.',
  REQUIRED_DOCUMENTS: 'No bid documents need to be prepared for this tender.',
  TURNOVER: 'A turnover check is not needed because Siyana will not bid.',
  EXPERIENCE: 'An experience check is not needed because Siyana will not bid.',
  CERTIFICATIONS: 'A certification check is not needed because Siyana will not bid.',
  PROJECT_COST: 'No cost estimate is needed because Siyana will not bid.',
  SUBMISSION_READINESS: 'Nothing needs to be submitted for this tender.',
};

/** Clean, deterministic answer for NO-GO tenders: the decision and why, nothing else. */
export function noGoAnswer(ev, tender, category, opts = {}) {
  const lines = [];
  lines.push(`**Decision: ${ev.label}**` + (ev.decided_on && !ev.status_overrides_v2 ? ` (evaluated ${ev.decided_on})` : ''));
  if (category === 'GENERAL_TENDER_INFO' || category === 'SCOPE_OF_WORK' || category === 'TENDER_STATUS') {
    const buyer = clean(tender.organization || tender.authority || tender.department);
    const closing = dateIn(tender.closing_date);
    lines.push('', `**Tender:** ${clean(tender.title)}` + (buyer ? ` — ${buyer}` : '') + (closing ? ` (closes ${closing})` : ''));
  }
  lines.push('');
  lines.push(`**Why:** ${ev.reason}`);
  const hard = ev.rules.filter((r) => r.kind === 'NO_GO' || ev.rules.length === 1);
  if (hard.length) {
    lines.push('');
    lines.push('**Company rule applied:**');
    for (const r of hard) lines.push(`- ${r.title}`);
  }
  if (category === 'EMD') {
    const emd = emdLine(ev, tender);
    if (emd) lines.push('', emd);
  }
  if (opts.table && ev.findings?.length) {
    lines.push('', prequalificationTable(ev.findings.map((f) => ({requirement: f.requirement, result: f.verdict, mandatory: f.mandatory, explanation: f.explanation}))));
  }
  if (NOT_NEEDED[category]) lines.push('', NOT_NEEDED[category]);
  if (ev.status_overrides_v2 && ev.v2_decision) {
    lines.push('', `_This decision was recorded after the automatic evaluation (which had suggested ${LABEL[ev.v2_decision] || ev.v2_decision})._`);
  }
  return lines.join('\n');
}

/** Compact, authoritative context handed to the model for GO / CONDITIONAL GO / VERIFY tenders. */
export function evaluationContext(ev) {
  return {
    decision: ev.decision,
    decision_label: ev.label,
    decided_on: ev.decided_on,
    reason: ev.reason,
    company_rules_applied: ev.rules.map((r) => r.title),
    emd_assessment: ev.emd,
    blocking_issues: ev.blocking_issues,
    missing_company_evidence: ev.missing_company_evidence,
    requirement_findings: ev.findings.slice(0, 40),
    earlier_qualification_result: ev.qualification_result,
  };
}

export const OFFICIAL_EVALUATION_INSTRUCTION =
  '\nOFFICIAL EVALUATION (binding): official_evaluation is the decision TenderFlow already made for this tender ' +
  'by the V2 evaluator using the company rules, company documents and knowledge base. Begin the answer with one line ' +
  '"Decision: <decision_label>" and stay consistent with it. Never give a different GO / NO GO / CONDITIONAL GO / VERIFY ' +
  'recommendation, and never contradict its reason, rules, requirement findings or EMD assessment; explain them in plain ' +
  'business language and add supporting tender details from the evidence. If the RFP evidence seems to disagree, say so ' +
  'in one sentence and still report the official decision. Do not mention indexing, embeddings, chunks, retrieval or ' +
  'system warnings.';

/** Replace the re-computed qualification decision line with the official one. */
export function alignQualificationAnswer(answer, ev) {
  const header = `**Decision: ${ev.label}**` + (ev.decided_on ? ` (evaluated ${ev.decided_on})` : '') + `\n\n**Why:** ${ev.reason}`;
  let body = String(answer || '').replace(/\\r?\\n/g, '\n');
  body = body.replace(/\*\*Decision:[^*]*\*\*\n?[^\n]*\n?Confidence measures verified mandatory evidence, not probability of winning\.\n?/i, '');
  body = body.replace(/\n*\*\*Evidence limits:\*\*[^\n]*(?:\n(?!\n)[^\n]*)*/i, '');
  body = body.replace(/\n*Recorded workflow:[^\n]*No status changed\.?/i, '');
  body = body.replace(/\n{3,}/g, '\n\n');
  // Source cell: drop auto section tags (often wrong, e.g. "§ EMD" on an experience clause) and repeats.
  body = body.replace(/^(\|.*\| )([^|]*) \|$/gm, (row, lead, src) => {
    if (/^-+$/.test(src.trim())) return row;
    const parts = [...new Set(src.split(/;\s*/).map((p) => p.replace(/\s*§\s*[^;]*$/, '').trim()).filter(Boolean))];
    return lead + parts.join('; ') + ' |';
  });
  return header + '\n\n**Requirement check**\n\n' + body.trim();
}

// ---------------------------------------------------------------------------
// "Do we qualify?" — short, decision-first answer built from the requirement check.

/** Short label for a long RFP clause. */
function shortRequirement(text) {
  let s = clean(text)
    .replace(/^(?:the\s+)?bidder\s+(?:must|shall|should)\s+(?:have\s+been\s+|have\s+|be\s+|possess\s+|hold\s+)?/i, '')
    .replace(/^(?:a\s+)?valid\s+/i, 'Valid ');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > 170) {
    const cut = s.slice(0, 170).search(/[,;(](?=[^,;(]*$)/);
    s = (cut > 60 ? s.slice(0, cut) : s.slice(0, 167)).trim().replace(/[,;:]$/, '') + '…';
  }
  return s.replace(/\.$/, '');
}

const inrPlain = (n) => '₹' + Number(n).toLocaleString('en-IN');

/** Turn evaluator boilerplate into a plain gap description. */
function plainGap(r) {
  const t = turnoverText(r);
  if (t) return t;
  const e = clean(r.calculation?.explanation || r.explanation);
  const extra = [];
  const missing = r.calculation?.missing_years || [];
  if (missing.length) extra.push('audited figures missing for ' + missing.join(', '));
  for (const c of r.calculation?.contradictions || []) {
    if (c?.year && Array.isArray(c.values)) extra.push(`two different ${c.year} figures (${c.values.map(inrPlain).join(' vs ')})`);
  }
  if (extra.length) return 'Not confirmed — ' + extra.join('; ') + '.';
  if (/supported calculation specification|No passing average or project count/i.test(e))
    return 'Not confirmed — no matching completed project / figure verified from company documents yet.';
  if (/matching company compliance evidence has not been verified/i.test(e))
    return 'Company proof (declaration / statement) not attached or verified yet.';
  if (/original evidence is missing, expired or mismatched/i.test(e))
    return 'A current, valid certificate was not found (missing or expired).';
  if (/Missing or contradictory annual evidence/i.test(e))
    return 'Audited turnover figures are incomplete or conflicting.';
  const first = e.split(/(?<=\.)\s+/)[0] || e;
  return first.length > 260 ? first.slice(0, 257) + '…' : first;
}

function turnoverText(r) {
  const c = r.calculation;
  if (!c || !Number.isFinite(c.value_inr) || !Array.isArray(c.annual_values)) return null;
  const years = c.annual_values.map((v) => `FY ${v.year}: ${inrPlain(v.amount_inr)}`).join(', ');
  const label = c.method === 'average' ? 'Average turnover' : c.method === 'cumulative' ? 'Total turnover' : 'Turnover';
  const need = Number.isFinite(c.required_inr) ? c.required_inr : null;
  const src = c.evidence?.[0]?.source_document_name ? ` (${c.evidence[0].source_document_name})` : '';
  return `${label} ${inrPlain(Math.round(c.value_inr))}${need ? ' against ' + inrPlain(need) + ' required' : ''} — ${years}${src}.`;
}

function failReason(r) {
  const t = turnoverText(r);
  if (t) return t;
  const e = clean(r.explanation).replace(/\s*This is a proven positive non-compliance\.?/i, '');
  const sentences = e.split(/(?<=\.)\s+/).slice(0, 2).join(' ');
  return sentences.length > 480 ? sentences.slice(0, 477) + '…' : sentences;
}

// ---------------------------------------------------------------------------
// Detailed, row-specific text for the prequalification table.

const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh','Puducherry','Chandigarh'];
const GOVT_TYPES = new Set(['Central Government', 'State Government', 'PSU', 'Local Body / Municipal Body', 'Autonomous Body', 'Other']);
const GENERIC = /original clause (?:is verified|did not establish)|matching company compliance evidence has not been verified|supported calculation specification|Evidence did not verify the proposed finding|No passing average or project count|Missing proof is UNKNOWN|not automatically verified/i;
const GENERIC_ACTION = /^Verify the original clause and obtain current company proof\.?$/i;

/** First rupee amount in a clause, in INR (handles lakh / crore). */
function clauseAmount(text) {
  const m = clean(text).match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?)?/i) || clean(text).match(/([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?)\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = (m[2] || '').toLowerCase();
  return n * (/^cr/.test(u) ? 1e7 : /^la/.test(u) ? 1e5 : 1);
}
const shortInr = (n) => (n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} cr` : n >= 1e5 ? `₹${+(n / 1e5).toFixed(2)} lakh` : inrPlain(n));

/** What Siyana's own project records show for an experience clause. */
function experienceDetail(r, projects) {
  const req = clean(r.requirement);
  const list = (projects || []).filter((p) => p?.qualification?.verification_state === 'VERIFIED');
  const parts = [];
  const excluded = r.calculation?.excluded || [];
  if (Number.isInteger(r.calculation?.required_count)) {
    parts.push(`${r.calculation.qualifying_count || 0} of Siyana's verified projects qualify; ${r.calculation.required_count} required.`);
    const reasons = {};
    for (const x of excluded) for (const why of x.reasons || []) reasons[why] = (reasons[why] || 0) + 1;
    const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, n]) => `${w} (${n})`);
    if (top.length) parts.push(`Main gaps: ${top.join(', ')}.`);
  }
  const state = STATES.find((s) => new RegExp(`\\b${s}\\b`, 'i').test(req));
  if (state) {
    const inState = list.filter((p) => new RegExp(`\\b${state}\\b`, 'i').test(`${p.client_name} ${p.project_name}`));
    parts.push(inState.length
      ? `Work orders on file for ${state}: ${inState.slice(0, 3).map((p) => `${clean(p.project_name).slice(0, 60)} (${clean(p.client_name)}${Number.isFinite(p.project_value_inr) ? ', ' + shortInr(p.project_value_inr) : ''})`).join('; ')}.`
      : `None of Siyana's ${list.length} verified work orders is for a client in ${state} — this clause needs ${state} Government experience.`);
  }
  const min = clauseAmount(req);
  const govtOnly = /govt|government|psu|public sector/i.test(req);
  if (min && !state) {
    const big = list.filter((p) => Number.isFinite(p.project_value_inr) && p.project_value_inr >= min && (!govtOnly || GOVT_TYPES.has(p.project_type)))
      .sort((a, b) => b.project_value_inr - a.project_value_inr);
    parts.push(big.length
      ? `Work orders ≥ ${shortInr(min)}${govtOnly ? ' with government/public clients' : ''} on file: ${big.slice(0, 3).map((p) => `${clean(p.client_name)} (${shortInr(p.project_value_inr)})`).join('; ')} — completion certificate${big.length > 1 ? 's' : ''} still to be confirmed against the clause.`
      : `No verified work order of ${shortInr(min)} or more${govtOnly ? ' from a government client' : ''} is on file.`);
  }
  if (!parts.length) {
    const gov = list.filter((p) => GOVT_TYPES.has(p.project_type) && Number.isFinite(p.project_value_inr)).sort((a, b) => b.project_value_inr - a.project_value_inr);
    parts.push(gov.length
      ? `Not matched automatically. Closest work orders on file: ${gov.slice(0, 3).map((p) => `${clean(p.project_name).slice(0, 50)} (${clean(p.client_name)}, ${shortInr(p.project_value_inr)})`).join('; ')}.`
      : 'No matching completed project is verified in company documents.');
  }
  parts.push(`Needed: work order${/completion/i.test(req) ? ' + completion certificate' : ''} matching this clause.`);
  return parts.join(' ');
}

const NEEDED = {
  'Staffing / deployment': 'Needed: CVs and degree / experience certificates of the named staff.',
  'Certifications / empanelment': 'Needed: a current copy of this certificate / registration in company documents.',
  'Product ownership / certification': 'Needed: OEM authorisation or product-ownership certificate.',
  'Hosting / security / integrations': 'Needed: proof of the required hosting / security credential.',
  'Local office': 'Needed: proof of an office in the required location (rent agreement / GST address).',
  'Consortium / subcontracting': 'Needed: check the RFP consortium / JV terms and the partner documents.',
  EMD: 'Needed: EMD payment or a valid MSE / Udyam exemption certificate.',
  Turnover: 'Needed: CA-certified turnover / audited accounts for the exact years asked.',
};

/** Row text for the prequalification table: why it passed or failed, with the document used. */
export function pqDetail(r, report) {
  if (r.standard_detail) return r.standard_detail;
  if (r.result === 'PASS') {
    const t = turnoverText(r);
    if (t) return t;
    let text = clean(r.calculation?.explanation || r.explanation)
      .replace(/^All listed credential identifiers, legal entity and required validity are supported by current original documents\.?$/i, 'Valid document on file.')
      .replace(/^\d+ distinct source-backed projects qualify.*$/i, 'Matching completed project on file.');
    const own = (r.calculation?.company_documents || []).map((e) => e.document);
    const docs = [...new Set((own.length ? own : [...(r.calculation?.evidence || []).map((e) => e.source_document_name || e.document), ...(r.company_evidence || []).map((e) => e.document)]).filter(Boolean))].slice(0, 2);
    if (docs.length && !docs.some((d) => text.includes(d))) text += ` Source: ${docs.join(', ')}.`;
    return text || 'Met by verified company documents.';
  }
  if (r.result === 'FAIL') return failReason(r);
  if (['Experience', 'Government experience'].includes(r.category) && report?.credentials) return experienceDetail(r, report.credentials.projects);
  const raw = clean(r.calculation?.explanation || r.explanation);
  const gap = GENERIC.test(raw) ? '' : plainGap(r);
  const action = clean(r.action);
  const need = action && !GENERIC_ACTION.test(action) ? `Needed: ${action.replace(/^needed:\s*/i, '').replace(/^./, (c) => c.toLowerCase())}` : NEEDED[r.category] || 'Needed: the supporting company document / declaration for this clause.';
  return [gap || 'Not yet proven from verified company documents.', need].join(' ');
}

const docName = (d) => clean(d).replace(/^sp-[0-9a-f-]{36}-/i, '').replace(/^[0-9a-f]{8}-[0-9a-f-]{27}\.html$/i, 'portal tender page');

/**
 * Standard conditions every tender is checked for, used ONLY when the downloaded documents
 * do not contain the RFP's eligibility section. Never "Passed": the clause is not available.
 */
export function standardPqRows(report) {
  const NA = 'RFP clause not available yet. ';
  const facts = [...(report?.credentials?.financial_facts || [])].filter((f) => Number.isFinite(f.amount_inr))
    .sort((a, b) => String(b.financial_year).localeCompare(String(a.financial_year))).slice(0, 3);
  const projects = (report?.credentials?.projects || []).filter((p) => p?.qualification?.verification_state === 'VERIFIED' && Number.isFinite(p.project_value_inr))
    .sort((a, b) => b.project_value_inr - a.project_value_inr);
  const row = (requirement, detail) => ({category: 'Standard', requirement, mandatory: true, result: 'UNKNOWN', rfp_evidence: [], standard_detail: NA + detail});
  return [
    row('Bidder is a registered firm / company providing IT / software services', 'Siyana is a registered private limited company; incorporation and registration documents are on file.'),
    row('Minimum years in business / since incorporation', 'Incorporation certificate is on file; compare the date with the required years once the clause is available.'),
    row('Minimum average annual turnover (last 3 financial years)', facts.length ? `Certified turnover on file: ${facts.map((f) => `FY ${f.financial_year} ${inrPlain(f.amount_inr)}`).join(', ')}.` : 'No certified turnover figures are on file.'),
    row('Similar project experience (work orders / completion certificates)', projects.length ? `${projects.length} verified work orders on file; largest: ${projects.slice(0, 2).map((p) => `${clean(p.client_name)} (${shortInr(p.project_value_inr)})`).join('; ')}.` : 'No verified work orders on file.'),
    row('Valid GST and PAN registration', 'GST certificates (Gujarat, Telangana) and PAN are on file; check whether the RFP asks for a particular State.'),
    row('Not blacklisted — self-declaration / affidavit', 'Siyana signs a non-blacklisting undertaking with each bid; prepare it on letterhead for this tender.'),
    row('EMD / bid security', 'Check the amount and any MSE / Udyam exemption in the full RFP.'),
  ];
}

/** Message when no real prequalification clause is in the documents TenderFlow has. */
export function noPqMessage(rfpDocuments) {
  const docs = [...new Set((rfpDocuments || []).map(docName).filter(Boolean))];
  return '**Prequalification checklist** — not available yet.\n\n' +
    (docs.length ? `TenderFlow has only these tender documents: ${docs.join(', ')}. ` : '') +
    'They do not contain the eligibility / prequalification section of the RFP, so no prequalification item can be checked. ' +
    'Upload the full tender document (RFP / NIT with the eligibility criteria) and ask again.';
}

export function chatQualificationAnswer(report, ev, opts = {}) {
  // Decision counts use the same real prequalification rows the table shows (plus scope).
  const reqs = (report?.requirements || []).filter((r) => isPrequalificationRow(r) || (r.category === 'Scope' && r.result === 'FAIL'));
  const fails = reqs.filter((r) => r.result === 'FAIL' && r.mandatory !== false);
  const unknown = reqs.filter((r) => r.result === 'UNKNOWN' && r.mandatory !== false && !/closing date|bid submission by/i.test(r.requirement));
  const passed = reqs.filter((r) => r.result === 'PASS');
  const official = ev?.available && !ev.pending;

  let label, why;
  if (official) {
    label = ev.label;
    why = ev.reason;
  } else if (fails.length) {
    label = 'NO-GO';
    why = fails.length > 1
      ? `Siyana does not meet ${fails.length} mandatory eligibility conditions in the RFP (below).`
      : 'Siyana does not meet a mandatory eligibility condition in the RFP (below).';
  } else if (report?.recommendation === 'GO') {
    label = 'GO';
    why = 'Every mandatory condition found in the RFP is met by verified company documents.';
  } else {
    label = 'VERIFY';
    why = !pqRows(report?.requirements || []).some((x) => x.row.category !== 'Scope')
      ? 'The eligibility / prequalification section of the RFP is not in the documents TenderFlow has, so eligibility cannot be checked yet.'
      : unknown.length
      ? `No mandatory condition is failed, but ${unknown.length} condition${unknown.length > 1 ? 's still need' : ' still needs'} proof before Siyana can confirm eligibility.`
      : 'Eligibility could not be fully verified from the available documents.';
  }

  const out = [`**Decision: ${label}**` + (official && ev.decided_on ? ` (evaluated ${ev.decided_on})` : ''), '', `**Why:** ${why}`];
  const hasClauses = pqRows(report?.requirements || []).some((x) => x.row.category !== 'Scope');
  const tableRows = hasClauses ? report?.requirements || [] : [...(report?.requirements || []).filter((r) => r.category === 'Scope'), ...standardPqRows(report)];
  out.push('', prequalificationTable(tableRows, {explain: (r) => pqDetail(r, report), empty: noPqMessage(opts.rfpDocuments)}));
  if (!hasClauses) out.push('', `_The RFP's eligibility section is not in the downloaded tender documents${opts.rfpDocuments?.length ? ' (' + [...new Set(opts.rfpDocuments.map(docName))].join(', ') + ')' : ''}. The rows below Scope are the standard conditions every tender is checked for, so they stay "not yet proven". Upload the full RFP / NIT and ask again for the exact clauses._`);

  if (!official && ev?.pending) {
    const detail = /has not finished yet/i.test(ev.reason) ? '' : ` (${ev.reason.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())})`;
    out.push('', `_The daily automatic evaluation for this tender has not finished yet${detail}. This answer comes from today's requirement check of the RFP against Siyana's company documents._`);
  }
  if (label === 'NO-GO' && !official) out.push('', 'No bid documents need to be prepared unless the blocking condition is resolved.');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Turnover / Experience / Certifications quick questions: the relevant rows of the same check.
const FOCUS = {
  TURNOVER: {title: 'Turnover check', cats: ['Turnover'], test: /turnover|net\s*worth|financial/i, none: 'The RFP sets no turnover requirement.'},
  EXPERIENCE: {title: 'Experience check', cats: ['Experience', 'Government experience'], test: /experience|similar|project|years|engaged/i, none: 'The RFP sets no project-experience requirement.'},
  GOVERNMENT_EXPERIENCE: {title: 'Government experience check', cats: ['Government experience', 'Experience'], test: /government|psu|public sector/i, none: 'The RFP sets no government-experience requirement.'},
  CERTIFICATIONS: {title: 'Certifications check', cats: ['Certifications / empanelment', 'Product ownership / certification'], test: /\biso\b|cmmi|certif|registration|empanel|\bpan\b|\bgst\b/i, none: 'The RFP asks for no specific certification.'},
};

export function focusedCheckAnswer(report, ev, category) {
  const f = FOCUS[category];
  if (!f || !report) return null;
  const overall = chatQualificationAnswer(report, ev).split('\n')[0];
  const owned = ['Turnover', 'Experience', 'Government experience', 'Certifications / empanelment', 'Product ownership / certification', 'EMD', 'Scope', 'Deadline / amendments'];
  const rows = (report.requirements || []).filter((r) => r.mandatory !== false && (f.cats.includes(r.category) || (!owned.includes(r.category) && f.test.test(r.requirement || ''))) && !/closing date|bid submission by|\bemd\b|earnest money/i.test(r.requirement || ''));
  const mark = {PASS: '✅ Met', FAIL: '❌ Not met', UNKNOWN: '⚠️ Not confirmed'};
  const out = [overall, '', `**${f.title}**`];
  if (!rows.length) out.push('', f.none);
  else out.push('', prequalificationTable(rows, {explain: (r) => pqDetail(r, report)}).replace(/^\*\*Prequalification checklist\*\*/, '**Checklist**'), '', '**Details**');
  for (const r of rows) {
    const passText = clean(r.calculation?.explanation || r.explanation)
      .replace(/^All listed credential identifiers, legal entity and required validity are supported by current original documents\.?$/i, 'Valid certificate on file.')
      .replace(/^\d+ distinct source-backed projects qualify.*$/i, 'Matching completed project on file.');
    const text = r.result === 'PASS' ? (turnoverText(r) || passText) : r.result === 'FAIL' ? failReason(r) : plainGap(r);
    const own = (r.calculation?.company_documents || []).map((e) => e.document);
    const docs = [...new Set((own.length ? own : [...(r.calculation?.evidence || []).map((e) => e.source_document_name || e.document), ...(r.company_evidence || []).map((e) => e.document)]).filter(Boolean))].slice(0, 3);
    out.push('', `- **${shortRequirement(r.requirement)}** — ${mark[r.result] || r.result}. ${text}${docs.length && r.result !== 'FAIL' && !/\(.*certificate.*\)/i.test(text) ? ` _Source: ${docs.join(', ')}._` : ''}`);
  }
  if (category === 'TURNOVER') {
    const facts = (report.credentials?.financial_facts || []).filter((x) => x.source === 'CA_CERTIFICATE');
    if (facts.length && !rows.some((r) => turnoverText(r))) {
      out.push('', `Siyana’s certified turnover: ${facts.map((x) => `FY ${x.financial_year} ${inrPlain(x.amount_inr)}`).join(', ')} (${facts[0].source_document_name}).`);
    }
  }
  out.push('', '_Full eligibility result: ask **Do We Qualify?**_');
  return out.join('\n');
}

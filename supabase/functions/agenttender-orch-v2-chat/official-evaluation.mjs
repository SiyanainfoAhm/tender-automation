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

/** Remove machine prefixes such as "NO_GO — validated approved rule(s): X. Evidence:". */
function plainReason(text) {
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
  const reason = (overridden
    ? plainReason(tender.prescreen_reason) || usable(qr.data?.reason)
    : usable(assessment.business_reason) ||
      plainReason(a?.reason) ||
      plainReason(tender.prescreen_reason) ||
      usable(qr.data?.reason)) ||
    (decision ? PENDING_REASON[family] || PENDING_REASON.VERIFY : null);

  return {
    available: Boolean(decision && reason),
    decision,
    family,
    label: LABEL[decision] || decision,
    v2_decision: v2Decision,
    status_overrides_v2: overridden,
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
export function noGoAnswer(ev, tender, category) {
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

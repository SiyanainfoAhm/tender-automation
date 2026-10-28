// Prequalification checklist table shared by the tender-specific and global chatbots.
// Only real prequalification (PQ / eligibility) clauses that actually appear in the RFP
// are listed: no scope, deadline or contract-condition rows, no placeholder rows for
// clauses the RFP does not contain, no duplicates. Anything not proven by verified
// company evidence is shown as Failed (not yet proven) — never as Passed.

const clean = (v) => String(v ?? '').replace(/[|\r\n]/g, ' ').replace(/<[^>]*>/g, '').replace(/\[?\b[RC]\d+m?\b\]?/g, '').replace(/\(\s*[,;\s]*\)/g, '').replace(/\s+/g, ' ').trim();

/** Readable RFP clause (kept nearly whole: users need the actual condition). */
export function pqItemLabel(text, max = 320) {
  let s = clean(text)
    .replace(/^(?:the\s+)?bidder\s+(?:must|shall|should)\s+(?:have\s+been\s+|have\s+|be\s+|possess\s+|hold\s+)?/i, '')
    .replace(/^(?:a\s+)?valid\s+/i, 'Valid ');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > max) {
    const cut = s.slice(0, max).search(/[,;(](?=[^,;(]*$)/);
    s = (cut > max / 2 ? s.slice(0, cut) : s.slice(0, max - 3)).trim().replace(/[,;:]$/, '') + '…';
  }
  return s.replace(/\.$/, '');
}

export const PQ_RESULT = {
  PASS: '✅ Passed',
  FAIL: '❌ Failed',
  UNKNOWN: '❌ Failed (not yet proven)',
};

// Rows the evaluator sometimes writes for clauses that are NOT in the RFP.
const PLACEHOLDER = /\b(?:not|none)\s+(?:present|found|available|stated|specified|mentioned)\b|\bno\s+[a-z /-]{0,40}\b(?:clause|requirement|condition)s?\s+(?:is\s+|are\s+)?(?:present|found|available|stated|specified)|not\s+(?:in|part of)\s+the\s+(?:supplied|reviewed|available)\s+(?:extract|pages|documents?)|as\s+(?:set out|specified|mentioned|given)\s+in\s+the\s+(?:tender|rfp|bid)\s+document|\bnot\s+(?:yet\s+)?available\s+in\s+the\b/i;
// Bid-process / contract-execution terms, not prequalification.
const NOT_PQ = /closing date|bid submission by|last date (?:of|for) submission|bid (?:end|due) date|submitted by the .{0,30}(?:end|due) date|shall not (?:assign|sub-?let|transfer)|\bsub-?let\b|liquidated damages|penalt(?:y|ies)\b|payment terms|performance (?:bank )?guarantee|security deposit|warranty period|delivery (?:period|schedule)|arbitration|force majeure|termination/i;
const NOT_PQ_CATEGORY = new Set(['Scope', 'Deadline / amendments']);

const words = (t) => new Set(clean(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !/^(bidder|must|shall|should|have|with|from|that|this|their|the)$/.test(w)));
function sameClause(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return false;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.75;
}
const RANK = {FAIL: 3, PASS: 2, UNKNOWN: 1};

/** Row written for a clause the RFP does not actually contain. */
export const isPlaceholderRequirement = (text) => PLACEHOLDER.test(String(text || ''));

/** True when a requirement row is a genuine prequalification clause from the RFP. */
export function isPrequalificationRow(r) {
  if (!r || r.mandatory === false) return false;
  if (NOT_PQ_CATEGORY.has(r.category)) return false;
  const text = String(r.requirement || '');
  if (!clean(text)) return false;
  if (PLACEHOLDER.test(text)) return false;
  if (NOT_PQ.test(text)) return false;
  return true;
}

/** RFP page reference(s) for a row, e.g. "RFP p. 4". */
function rfpRef(r) {
  const pages = [...new Set((r.rfp_evidence || []).map((e) => e.page).filter((p) => p !== null && p !== undefined && p !== ''))].slice(0, 3);
  return pages.length ? `RFP p. ${pages.join(', ')}` : '';
}

/**
 * rows: [{requirement, result: PASS|FAIL|UNKNOWN, mandatory, category?, rfp_evidence?}]
 * Real prequalification rows only, de-duplicated (a decided row beats an undecided copy).
 */
export function pqRows(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isPrequalificationRow(r)) continue;
    const item = pqItemLabel(r.requirement);
    if (!item) continue;
    const raw = String(r?.result || r?.verdict || 'UNKNOWN').toUpperCase();
    const result = PQ_RESULT[raw] ? raw : 'UNKNOWN';
    const i = out.findIndex((x) => sameClause(x.row.requirement, r.requirement));
    if (i >= 0) {
      if ((RANK[result] || 0) > (RANK[out[i].result] || 0)) out[i] = {item, result, row: r};
      continue;
    }
    out.push({item, result, row: r});
  }
  // Failed first, then not yet proven, then passed: what needs action comes first.
  const order = {FAIL: 0, UNKNOWN: 1, PASS: 2};
  return out.map((x, n) => ({...x, n})).sort((a, b) => order[a.result] - order[b.result] || a.n - b.n);
}

export function prequalificationTable(rows, {empty = 'No prequalification clauses were found in the tender documents for this tender.', explain = null} = {}) {
  const list = pqRows(rows);
  if (!list.length) return empty;
  const passed = list.filter((r) => r.result === 'PASS').length;
  const failed = list.filter((r) => r.result === 'FAIL').length;
  const unproven = list.length - passed - failed;
  const detail = (r) => {
    const text = clean(explain ? explain(r.row) : (r.row?.calculation?.explanation || r.row?.explanation || ''));
    if (text) return text;
    return r.result === 'PASS' ? 'Met by verified company documents.'
      : r.result === 'FAIL' ? 'Our company documents do not meet this condition.'
      : 'No verified company document proves this condition yet.';
  };
  const summary = [`${passed} passed`, failed ? `${failed} failed` : null, unproven ? `${unproven} not yet proven` : null].filter(Boolean).join(' · ');
  return [
    `**Prequalification checklist** — ${list.length} item${list.length > 1 ? 's' : ''} in the RFP: ${summary}`,
    '',
    '| # | Prequalification item (as per RFP) | Passed / Failed | Details |',
    '| --- | --- | --- | --- |',
    ...list.map((r, i) => {
      const ref = rfpRef(r.row);
      return `| ${i + 1} | ${r.item}${ref ? ` _(${ref})_` : ''} | ${PQ_RESULT[r.result]} | ${detail(r)} |`;
    }),
  ].join('\n');
}

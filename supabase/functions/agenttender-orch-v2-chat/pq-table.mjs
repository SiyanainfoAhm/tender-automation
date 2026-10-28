// Prequalification checklist table shared by the tender-specific and global chatbots.
// Column 1: checklist item, column 2: Passed / Failed. Anything not proven by
// verified company evidence is shown as Failed (not yet proven) — never as Passed.

const clean = (v) => String(v ?? '').replace(/[|\r\n]/g, ' ').replace(/<[^>]*>/g, '').replace(/\[?\b[RC]\d+\b\]?/g, '').replace(/\s+/g, ' ').trim();

/** Short label for a long RFP clause. */
export function pqItemLabel(text) {
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

export const PQ_RESULT = {
  PASS: '✅ Passed',
  FAIL: '❌ Failed',
  UNKNOWN: '❌ Failed (not yet proven)',
};

/**
 * rows: [{requirement, result: PASS|FAIL|UNKNOWN, mandatory, category?}]
 * Mandatory items only (plus Scope); deadline-only rows are left out.
 */
export function pqRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.mandatory === false && r?.category !== 'Scope') continue;
    if (/closing date|bid submission by|last date (?:of|for) submission/i.test(String(r?.requirement || ''))) continue;
    const item = r?.category === 'Scope' ? 'Scope matches our software / IT services work' : pqItemLabel(r?.requirement);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const result = String(r?.result || r?.verdict || 'UNKNOWN').toUpperCase();
    out.push({item, result: PQ_RESULT[result] ? result : 'UNKNOWN'});
  }
  return out;
}

export function prequalificationTable(rows, {empty = 'No prequalification items were found in the RFP for this tender.'} = {}) {
  const list = pqRows(rows);
  if (!list.length) return empty;
  const passed = list.filter((r) => r.result === 'PASS').length;
  return [
    `**Prequalification checklist** — ${passed} of ${list.length} passed`,
    '',
    '| Prequalification checklist item | Passed / Failed |',
    '| --- | --- |',
    ...list.map((r) => `| ${r.item} | ${PQ_RESULT[r.result]} |`),
  ].join('\n');
}

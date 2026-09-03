import assert from "node:assert/strict";
import test from "node:test";

import {
  compactDisplayRange,
  excelCountMatchesWebBadge,
  parseCompactListCount,
  parseCompactListCountDetails,
} from "../tender247ListUi.js";

test("parseCompactListCount handles K and Lakh suffixes", () => {
  assert.equal(parseCompactListCount("518"), 518);
  assert.equal(parseCompactListCount("1.00 K"), 1000);
  assert.equal(parseCompactListCount("1.03 Lakh"), 103000);
});

test("1.00 K is approximate and covers Excel 1003", () => {
  const parsed = parseCompactListCountDetails("1.00 K");
  assert.ok(parsed);
  assert.equal(parsed.value, 1000);
  assert.equal(parsed.approximate, true);
  assert.ok(parsed.min <= 1003 && parsed.max >= 1003);
  assert.equal(excelCountMatchesWebBadge(parsed, 1003), true);
  assert.equal(excelCountMatchesWebBadge(parsed, 1000), true);
  assert.equal(excelCountMatchesWebBadge(parsed, 990), false);
  assert.equal(excelCountMatchesWebBadge(parsed, 1010), false);
});

test("plain Fresh count stays exact", () => {
  const parsed = parseCompactListCountDetails("518");
  assert.ok(parsed);
  assert.equal(parsed.approximate, false);
  assert.equal(excelCountMatchesWebBadge(parsed, 518), true);
  assert.equal(excelCountMatchesWebBadge(parsed, 520), false);
});

test("compactDisplayRange matches toFixed rounding", () => {
  const { min, max } = compactDisplayRange(1.0, 2, 1000);
  assert.equal((min / 1000).toFixed(2), "1.00");
  assert.equal((max / 1000).toFixed(2), "1.00");
  if (min > 0) {
    assert.notEqual(((min - 1) / 1000).toFixed(2), "1.00");
  }
  assert.notEqual(((max + 1) / 1000).toFixed(2), "1.00");
  assert.equal((1003 / 1000).toFixed(2), "1.00");
});

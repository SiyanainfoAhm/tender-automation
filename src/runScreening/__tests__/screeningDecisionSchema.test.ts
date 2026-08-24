import assert from "node:assert/strict";
import test from "node:test";
import {
  parseScreeningDecisionsJson,
  tryParseScreeningDecisionsJson,
} from "../screeningDecisionSchema.js";

test("parseScreeningDecisionsJson accepts array of decisions", () => {
  const text = `[
    {"t247_id":"1001","screening_status":"NO_BID","screening_reason":"hardware"},
    {"t247_id":"1002","screening_status":"MAY_BID","screening_reason":"software"}
  ]`;
  const parsed = parseScreeningDecisionsJson(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.decisions.length, 2);
  assert.equal(parsed.decisions[0]!.screeningStatus, "NO_BID");
  assert.equal(parsed.decisions[1]!.statusEnum, "CONDITIONAL_GO");
});

test("parseScreeningDecisionsJson coerces legacy status labels", () => {
  const parsed = parseScreeningDecisionsJson(
    `[{"t247_id":"9","screening_status":"GO","screening_reason":"fit"}]`,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.decisions[0]!.screeningStatus, "WILL_BID");
});

test("tryParseScreeningDecisionsJson rejects empty / object payloads", () => {
  assert.equal(tryParseScreeningDecisionsJson("{}").ok, false);
  assert.equal(tryParseScreeningDecisionsJson("[]").ok, false);
  assert.equal(
    tryParseScreeningDecisionsJson(
      `[{"t247_id":"1","screening_status":"VERIFY","screening_reason":"x"}]`,
    ).ok,
    true,
  );
});

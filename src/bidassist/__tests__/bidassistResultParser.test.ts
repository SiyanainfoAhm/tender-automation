import assert from "node:assert/strict";
import test from "node:test";
import { isAwardedBidder, normalizeBidderName, parseBidassistAmount, parseBidderRank } from "../bidassistResultParser.js";
test("parses BidAssist Indian amounts without losing raw display", () => { const p = parseBidassistAmount("₹ 4.2 Lac"); assert.equal(p.display, "₹ 4.2 Lac"); assert.equal(p.normalized, 420000); assert.equal(p.currency, "INR"); assert.equal(parseBidassistAmount("Rs. 1.25 Crore").normalized, 12500000); assert.equal(parseBidassistAmount("INR 20 Thousand").normalized, 20000); });
test("parses ranks and awarded signal defensively", () => { assert.equal(parseBidderRank("₹4.2 Lac (L1)"), "L1"); assert.equal(parseBidderRank("no rank"), null); assert.equal(isAwardedBidder("Accepted-Aoc Awarded"), true); assert.equal(isAwardedBidder("Rejected-Financial"), false); });
test("normalizes bidder identity for repeat-run upserts", () => { assert.equal(normalizeBidderName(" Siyana Info Solutions Private Limited "), "siyana info solutions private limited"); assert.equal(normalizeBidderName("Siyana-Info Solutions, Pvt. Ltd."), "siyana info solutions pvt ltd"); });

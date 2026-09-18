import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TENDER247_SOURCE_REGION,
  getTender247Source,
  isTender247AuthListUrl,
  parseTender247SourceRegion,
  tender247DetailUrl,
  tender247ExcelBasename,
  tender247RegionLabel,
  urlMatchesTender247Region,
  parseTender247DetailRoute,
  TENDER247_SOURCES,
} from "../sourceRegion.js";

test("defaults to INDIAN", () => {
  assert.equal(DEFAULT_TENDER247_SOURCE_REGION, "INDIAN");
  assert.equal(parseTender247SourceRegion(undefined), "INDIAN");
  assert.equal(parseTender247SourceRegion(""), "INDIAN");
});

test("parses GLOBAL aliases", () => {
  assert.equal(parseTender247SourceRegion("GLOBAL"), "GLOBAL");
  assert.equal(parseTender247SourceRegion("global"), "GLOBAL");
  assert.equal(parseTender247SourceRegion("international"), "GLOBAL");
});

test("alternateTender247Region switches feeds", async () => {
  const { alternateTender247Region } = await import("../sourceRegion.js");
  assert.equal(alternateTender247Region("INDIAN"), "GLOBAL");
  assert.equal(alternateTender247Region("GLOBAL"), "INDIAN");
});

test("rejects unknown region", () => {
  assert.throws(
    () => parseTender247SourceRegion("EU"),
    /Invalid --region=EU/,
  );
});

test("source configs use distinct feed URLs", () => {
  assert.equal(
    TENDER247_SOURCES.INDIAN.url,
    "https://www.tender247.com/auth/tender",
  );
  assert.equal(
    TENDER247_SOURCES.GLOBAL.url,
    "https://www.tender247.com/auth/globaltender",
  );
  assert.equal(getTender247Source("GLOBAL").path, "/auth/globaltender");
  assert.notEqual(
    getTender247Source("INDIAN").url,
    getTender247Source("GLOBAL").url,
  );
});

test("auth list URL helper", () => {
  assert.equal(
    isTender247AuthListUrl("https://www.tender247.com/auth/tender"),
    true,
  );
  assert.equal(
    isTender247AuthListUrl("https://www.tender247.com/auth/globaltender"),
    true,
  );
  assert.equal(isTender247AuthListUrl("https://www.tender247.com/auth"), false);
});

test("detail URLs are region-scoped", () => {
  assert.equal(
    tender247DetailUrl("INDIAN", "104309894", "abc"),
    "https://www.tender247.com/auth/tender/104309894/abc",
  );
  assert.equal(
    tender247DetailUrl("GLOBAL", "104309894", "abc"),
    "https://www.tender247.com/auth/globaltender/104309894/abc",
  );
});

test("excel basename is region-aware", () => {
  assert.equal(
    tender247ExcelBasename("INDIAN", "2026-09-15"),
    "Tender247_2026-09-15.xlsx",
  );
  assert.equal(
    tender247ExcelBasename("GLOBAL", "2026-09-15"),
    "Tender247_GLOBAL_2026-09-15.xlsx",
  );
});

test("region labels", () => {
  assert.equal(tender247RegionLabel("INDIAN"), "Indian");
  assert.equal(tender247RegionLabel("GLOBAL"), "Global");
});

test("urlMatchesTender247Region distinguishes Indian vs Global", () => {
  assert.equal(
    urlMatchesTender247Region(
      "https://www.tender247.com/auth/tender",
      "INDIAN",
    ),
    true,
  );
  assert.equal(
    urlMatchesTender247Region(
      "https://www.tender247.com/auth/tender",
      "GLOBAL",
    ),
    false,
  );
  assert.equal(
    urlMatchesTender247Region(
      "https://www.tender247.com/auth/globaltender",
      "GLOBAL",
    ),
    true,
  );
  assert.equal(
    urlMatchesTender247Region(
      "https://www.tender247.com/auth/globaltender",
      "INDIAN",
    ),
    false,
  );
});

test("parseTender247DetailRoute requires uuid segment", () => {
  assert.deepEqual(
    parseTender247DetailRoute(
      "https://www.tender247.com/auth/globaltender/104294221/deadbeef-cafe-babe-0001",
    ),
    {
      region: "GLOBAL",
      tenderId: "104294221",
      securityCode: "deadbeef-cafe-babe-0001",
    },
  );
  assert.equal(
    parseTender247DetailRoute(
      "https://www.tender247.com/auth/globaltender/104294221",
    ),
    null,
  );
});

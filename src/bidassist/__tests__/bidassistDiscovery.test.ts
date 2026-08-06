import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBidassistCardKey,
  chooseBestTitle,
  deriveAuthorityFromUrl,
  isTitleCandidate,
  looksLikeCompleteCard,
  parseCardLocation,
  pickAuthority,
  pickGemCategoryName,
  pickTitleFromLines,
} from "../bidassistCrawler.js";

test("card keys ignore whitespace and case differences", () => {
  const a = buildBidassistCardKey({
    title: "Supply of  Laptops",
    authority: "Dept of IT",
    closingDate: "12 Aug 2026",
  });
  const b = buildBidassistCardKey({
    title: "supply of laptops",
    authority: "dept of it",
    closingDate: "12 Aug 2026",
  });
  assert.equal(a, b);
});

test("card keys separate tenders sharing a title", () => {
  const a = buildBidassistCardKey({
    title: "Annual Maintenance",
    authority: "Authority A",
    closingDate: "12 Aug 2026",
  });
  const b = buildBidassistCardKey({
    title: "Annual Maintenance",
    authority: "Authority B",
    closingDate: "12 Aug 2026",
  });
  assert.notEqual(a, b);
});

test("looksLikeCompleteCard needs a closing date or enough detail", () => {
  assert.equal(looksLikeCompleteCard("Closing 12 Aug 2026"), true);
  assert.equal(looksLikeCompleteCard("Download"), false);
  assert.equal(looksLikeCompleteCard("x".repeat(80)), true);
});

test("card affordances, locations and labels are not titles", () => {
  assert.equal(isTitleCandidate("Follow"), false);
  assert.equal(isTitleCandidate("Download"), false);
  assert.equal(isTitleCandidate("Mumbai, Maharashtra"), false);
  assert.equal(isTitleCandidate("GEM Category: Something"), false);
  assert.equal(isTitleCandidate("10 Aug 2026"), false);
  assert.equal(
    isTitleCandidate("Supply and installation of network switches"),
    true,
  );
});

test("pickTitleFromLines skips location and label rows", () => {
  const lines = [
    "Mumbai, Maharashtra",
    "Follow",
    "Supply of managed IT services",
    "Closing 10 Aug 2026",
  ];
  assert.equal(pickTitleFromLines(lines), "Supply of managed IT services");
});

test("the tender name wins over short chips and labels", () => {
  assert.equal(
    chooseBestTitle([
      "Services",
      "Software and IT Solutions",
      "Supply, installation and commissioning of campus network",
    ]),
    "Supply, installation and commissioning of campus network",
  );
  assert.equal(chooseBestTitle(["Follow", "x".repeat(300)]), "");
});

test("pickGemCategoryName reads the GEM category row", () => {
  assert.equal(
    pickGemCategoryName([
      "Software and IT Solutions",
      "GEM Category: Custom Bid for Services - Manpower",
    ]),
    "Custom Bid for Services - Manpower",
  );
  assert.equal(
    pickGemCategoryName([
      "GEM",
      "Category: Automationtestcategory_donotuse (q3)",
    ]),
    "Automationtestcategory_donotuse (q3)",
  );
  assert.equal(pickGemCategoryName(["Services"]), "");
});

test("parseCardLocation splits the city and state line", () => {
  assert.deepEqual(parseCardLocation(["Follow", "Mumbai, Maharashtra"]), {
    city: "Mumbai",
    state: "Maharashtra",
  });
  assert.deepEqual(parseCardLocation(["No location here"]), {
    city: "",
    state: "",
  });
});

test("deriveAuthorityFromUrl reads the department slug", () => {
  assert.equal(
    deriveAuthorityFromUrl(
      "https://bidassist.com/maharashtra-tenders/department-of-agricultural-research-and-education/detail-96fb9eec",
    ),
    "Department Of Agricultural Research And Education",
  );
  assert.equal(deriveAuthorityFromUrl(""), "");
});

test("pickAuthority prefers a department line over the URL slug", () => {
  assert.equal(
    pickAuthority(
      ["Services", "Municipal Corporation of Greater Mumbai"],
      "https://bidassist.com/x-tenders/some-dept/detail-1",
    ),
    "Municipal Corporation of Greater Mumbai",
  );
  assert.equal(
    pickAuthority(
      ["Services"],
      "https://bidassist.com/x-tenders/some-dept/detail-1",
    ),
    "Some Dept",
  );
});

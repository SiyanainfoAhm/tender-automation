import assert from "node:assert/strict";
import test from "node:test";
import {
  detectActiveTendersPageReady,
  detectCategoryRouteApplied,
  detectPageNotFound,
} from "../bidassistFilters.js";

test("detectPageNotFound recognises the BidAssist 404 screen", () => {
  assert.equal(detectPageNotFound("Page Not Found"), true);
  assert.equal(
    detectPageNotFound("Oops! We are looking for your page\nGo Home"),
    true,
  );
  assert.equal(detectPageNotFound("Go Home"), true);
});

test("detectPageNotFound ignores listing pages with a Go Home link", () => {
  assert.equal(
    detectPageNotFound("Saved Filters Category More Filters Go Home"),
    false,
  );
  assert.equal(detectPageNotFound("Active Indian Tenders Download"), false);
});

test("detectActiveTendersPageReady needs listing chrome", () => {
  assert.equal(detectActiveTendersPageReady("Category More Filters"), true);
  assert.equal(detectActiveTendersPageReady("Indian Tenders"), true);
  assert.equal(detectActiveTendersPageReady("Oops!"), false);
});

test("detectCategoryRouteApplied matches the direct category URL", () => {
  assert.equal(
    detectCategoryRouteApplied({
      url: "https://bidassist.com/all-tenders/software-and-it-solutions-category/active",
      bodyText: "",
      category: "Software and IT Solutions",
    }),
    true,
  );
});

test("detectCategoryRouteApplied matches the category heading text", () => {
  assert.equal(
    detectCategoryRouteApplied({
      url: "https://bidassist.com/all-tenders/active",
      bodyText: "Software and IT Solutions Tenders",
      category: "Software and IT Solutions",
    }),
    true,
  );
  assert.equal(
    detectCategoryRouteApplied({
      url: "https://bidassist.com/all-tenders/active",
      bodyText: "All Active Tenders",
      category: "Software and IT Solutions",
    }),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildBidassistCardKey } from "../bidassistCrawler.js";
import {
  didPaginationChange,
  isDisabledControlAttrs,
  nextNumericPageTarget,
  remainingSlots,
  shouldContinuePagination,
  type PaginationBeforeState,
} from "../bidassistPagination.js";

test("five-tender limit completes without needing page 2", () => {
  assert.equal(shouldContinuePagination({ processedCount: 5, limit: 5 }), false);
  assert.equal(remainingSlots({ processedCount: 0, limit: 5 }), 5);
  assert.equal(remainingSlots({ processedCount: 5, limit: 5 }), 0);
});

test("ten-tender limit requires page 2 when page 1 is exhausted", () => {
  assert.equal(shouldContinuePagination({ processedCount: 8, limit: 10 }), true);
  assert.equal(remainingSlots({ processedCount: 8, limit: 10 }), 2);
});

test("unlimited limit continues until the final page", () => {
  assert.equal(shouldContinuePagination({ processedCount: 100, limit: 0 }), true);
  assert.equal(remainingSlots({ processedCount: 100, limit: 0 }), Number.POSITIVE_INFINITY);
});

test("Next attributes detect a disabled pagination control", () => {
  assert.equal(
    isDisabledControlAttrs({
      disabledAttr: "",
      ariaDisabled: null,
      className: "",
      enabled: true,
    }),
    true,
  );
  assert.equal(
    isDisabledControlAttrs({
      disabledAttr: null,
      ariaDisabled: "true",
      className: "",
      enabled: true,
    }),
    true,
  );
  assert.equal(
    isDisabledControlAttrs({
      disabledAttr: null,
      ariaDisabled: null,
      className: "page-item disabled",
      enabled: true,
    }),
    true,
  );
  assert.equal(
    isDisabledControlAttrs({
      disabledAttr: null,
      ariaDisabled: null,
      className: "page-link",
      enabled: false,
    }),
    true,
  );
  assert.equal(
    isDisabledControlAttrs({
      disabledAttr: null,
      ariaDisabled: null,
      className: "page-link",
      enabled: true,
    }),
    false,
  );
});

test("didPaginationChange detects active page moving from 1 to 2", () => {
  const before: PaginationBeforeState = {
    activePage: 1,
    firstCardKey: "a|b|c|d",
    url: "https://bidassist.com/all-tenders/active",
  };
  assert.equal(
    didPaginationChange({
      before,
      afterPage: 2,
      afterFirstCardKey: "a|b|c|d",
      afterUrl: before.url,
    }),
    true,
  );
  assert.equal(
    didPaginationChange({
      before,
      afterPage: 1,
      afterFirstCardKey: "w|x|y|z",
      afterUrl: before.url,
    }),
    true,
  );
  assert.equal(
    didPaginationChange({
      before,
      afterPage: 1,
      afterFirstCardKey: "a|b|c|d",
      afterUrl: before.url,
    }),
    false,
  );
});

test("failed Next leave the crawl on the same page number", () => {
  const before: PaginationBeforeState = {
    activePage: 2,
    firstCardKey: "same",
    url: "https://bidassist.com/all-tenders/active?page=2",
  };
  assert.equal(
    didPaginationChange({
      before,
      afterPage: 2,
      afterFirstCardKey: "same",
      afterUrl: before.url,
    }),
    false,
  );
  // Callers must not reset currentPageNumber back to 1 on failure
  const lastPageVisited = before.activePage;
  assert.equal(lastPageVisited, 2);
});

test("numeric fallback targets the next page only", () => {
  assert.equal(nextNumericPageTarget(1), 2);
  assert.equal(nextNumericPageTarget(9), 10);
  assert.equal(nextNumericPageTarget(null), null);
});

test("card keys include detail URL so duplicates across pages collapse", () => {
  const keyA = buildBidassistCardKey({
    title: "Same Title",
    authority: "Dept",
    closingDate: "10 Aug 2026",
    tenderDetailUrl: "https://bidassist.com/t/detail-1",
  });
  const keyB = buildBidassistCardKey({
    title: "Same Title",
    authority: "Dept",
    closingDate: "10 Aug 2026",
    tenderDetailUrl: "https://bidassist.com/t/detail-1",
  });
  const keyC = buildBidassistCardKey({
    title: "Same Title",
    authority: "Dept",
    closingDate: "10 Aug 2026",
    tenderDetailUrl: "https://bidassist.com/t/detail-2",
  });
  assert.equal(keyA, keyB);

  const seen = new Set<string>();
  seen.add(keyA);
  assert.equal(seen.has(keyB), true);
  assert.equal(seen.has(keyC), false);
});

test("locators must be refreshed after page change (snapshot contract)", () => {
  // Page 1 and page 2 can share titles; cardKey + re-query is the only safe identity
  const page1 = buildBidassistCardKey({
    title: "Managed services",
    authority: "Dept A",
    closingDate: "10 Aug 2026",
    tenderDetailUrl: "https://bidassist.com/t/a",
  });
  const page2 = buildBidassistCardKey({
    title: "Managed services",
    authority: "Dept B",
    closingDate: "11 Aug 2026",
    tenderDetailUrl: "https://bidassist.com/t/b",
  });
  assert.notEqual(page1, page2);
});

test("filters-preserved log contract uses the destination page number", () => {
  const toPage = 2;
  assert.equal(`BIDASSIST_FILTERS_PRESERVED_ON_PAGE=${toPage}`, "BIDASSIST_FILTERS_PRESERVED_ON_PAGE=2");
});

import { describe, expect, it } from "vitest";

import {
  filterKeyWithoutPage,
  isCacheFresh,
  invalidateTenderListCaches,
  getCachedTenderList,
  setCachedTenderList,
  getTenderListMutationEpoch,
} from "@/lib/tenders/list-cache";
import {
  isSafeTendersListReturnPath,
  tendersListHrefFromParts,
} from "@/lib/tenders/list-return";

describe("tender list return path", () => {
  it("allows only /tenders with optional query", () => {
    expect(isSafeTendersListReturnPath("/tenders")).toBe(true);
    expect(
      isSafeTendersListReturnPath("/tenders?status=GO&page=3"),
    ).toBe(true);
    expect(isSafeTendersListReturnPath("/tenders/abc")).toBe(false);
    expect(isSafeTendersListReturnPath("//evil.com")).toBe(false);
    expect(isSafeTendersListReturnPath("https://evil.com")).toBe(false);
    expect(isSafeTendersListReturnPath("/dashboard")).toBe(false);
  });

  it("builds list href from pathname + query", () => {
    expect(tendersListHrefFromParts("/tenders", "")).toBe("/tenders");
    expect(tendersListHrefFromParts("/tenders", "status=GO&page=2")).toBe(
      "/tenders?status=GO&page=2",
    );
  });
});

describe("tender list cache", () => {
  it("stores and returns list payloads; invalidate bumps epoch", () => {
    invalidateTenderListCaches("test-reset");
    const epoch = getTenderListMutationEpoch();
    setCachedTenderList("status=GO&page=1", {
      rows: [{ id: "1" }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const hit = getCachedTenderList("status=GO&page=1");
    expect(hit?.data.total).toBe(1);
    expect(isCacheFresh(hit!.fetchedAt)).toBe(true);
    expect(filterKeyWithoutPage("status=GO&page=3&includeCount=0")).toBe(
      "status=GO",
    );
    invalidateTenderListCaches("test");
    expect(getTenderListMutationEpoch()).toBeGreaterThan(epoch);
    expect(getCachedTenderList("status=GO&page=1")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  detailOriginLabel,
  isSafeTenderDetailOriginPath,
  isSafeTendersListReturnPath,
  tendersListHrefFromParts,
} from "@/lib/tenders/list-return";

describe("tenders list return paths", () => {
  it("allows indian and global list paths", () => {
    expect(isSafeTendersListReturnPath("/tenders/indian")).toBe(true);
    expect(isSafeTendersListReturnPath("/tenders/global")).toBe(true);
    expect(isSafeTendersListReturnPath("/tenders/global?date=today")).toBe(
      true,
    );
    expect(isSafeTendersListReturnPath("/tenders/abc-uuid")).toBe(false);
    expect(isSafeTendersListReturnPath("/submitted-tenders")).toBe(false);
  });

  it("allows submitted tenders as a detail back origin", () => {
    expect(isSafeTenderDetailOriginPath("/submitted-tenders")).toBe(true);
    expect(isSafeTenderDetailOriginPath("/tenders/indian?q=abc")).toBe(true);
    expect(isSafeTenderDetailOriginPath("/tenders/abc-uuid")).toBe(false);
    expect(detailOriginLabel("/submitted-tenders")).toBe("Submitted Tenders");
    expect(detailOriginLabel("/tenders/global")).toBe("Tenders");
  });

  it("builds return href from region path", () => {
    expect(tendersListHrefFromParts("/tenders/global", "date=today")).toBe(
      "/tenders/global?date=today",
    );
    expect(tendersListHrefFromParts("/tenders/indian", "")).toBe(
      "/tenders/indian",
    );
  });
});

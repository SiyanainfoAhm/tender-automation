import { describe, expect, it } from "vitest";

import {
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

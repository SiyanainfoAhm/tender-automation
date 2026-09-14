import { describe, expect, it } from "vitest";

import {
  buildTenderStatusCountSearchParams,
  searchParamsForStatusCounts,
  tenderStatusCountQueryKey,
} from "@/lib/tender-status-count-params";

describe("tender status-count filter params", () => {
  it("includes non-status filters and excludes status/page/sort", () => {
    const params = buildTenderStatusCountSearchParams(
      new URLSearchParams({
        date: "today",
        status: "under_evaluation",
        city: "Delhi",
        category: "Website / Web Portal",
        source: "TENDER247",
        page: "3",
        sortBy: "closing_date",
        q: "gem",
      }),
    );
    expect(params.get("date")).toBe("today");
    expect(params.get("city")).toBe("Delhi");
    expect(params.get("category")).toBe("Website / Web Portal");
    expect(params.get("source")).toBe("TENDER247");
    expect(params.get("q")).toBe("gem");
    expect(params.get("status")).toBeNull();
    expect(params.get("page")).toBeNull();
    expect(params.get("sortBy")).toBeNull();
  });

  it("defaults missing scraped date to all so Won KPIs are not zeroed", () => {
    const params = buildTenderStatusCountSearchParams(
      new URLSearchParams({
        city: "Delhi",
        status: "won",
      }),
    );
    expect(params.get("date")).toBe("all");
    expect(params.get("city")).toBe("Delhi");
    expect(searchParamsForStatusCounts({})).toEqual({ date: "all" });
  });

  it("keeps the same query key when only status changes", () => {
    const withStatus = tenderStatusCountQueryKey(
      new URLSearchParams({
        date: "today",
        status: "under_evaluation",
        city: "Delhi",
      }),
    );
    const withoutStatus = tenderStatusCountQueryKey(
      new URLSearchParams({
        date: "today",
        city: "Delhi",
      }),
    );
    expect(withStatus).toBe(withoutStatus);
    expect(withStatus).toContain("date=today");
    expect(withStatus).toContain("city=Delhi");
    expect(withStatus).not.toContain("status=");
  });

  it("drops status when flattening Next.js searchParams for SSR counts", () => {
    const flat = searchParamsForStatusCounts({
      date: "today",
      status: ["under_evaluation"],
      source: "ALL",
      city: "Mumbai",
    });
    expect(flat).toEqual({
      date: "today",
      city: "Mumbai",
    });
  });

  it("keeps scraped-date facet stable when status card is selected", () => {
    const scrapedToday = tenderStatusCountQueryKey(
      new URLSearchParams({ date: "today" }),
    );
    const afterUnderEvalClick = tenderStatusCountQueryKey(
      new URLSearchParams({
        date: "today",
        status: "under_evaluation",
        page: "1",
      }),
    );
    expect(scrapedToday).toBe(afterUnderEvalClick);
  });

  it("models Total card as clearing only status", () => {
    const before = new URLSearchParams({
      date: "today",
      city: "Delhi",
      status: "verify",
      page: "2",
    });
    before.delete("status");
    before.set("page", "1");
    expect(tenderStatusCountQueryKey(before)).toBe(
      tenderStatusCountQueryKey(
        new URLSearchParams({ date: "today", city: "Delhi" }),
      ),
    );
    expect(before.get("date")).toBe("today");
    expect(before.get("city")).toBe("Delhi");
    expect(before.get("status")).toBeNull();
  });
});

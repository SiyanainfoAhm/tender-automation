import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTenderSearchOrFilter,
  createRequestSerial,
  effectiveTenderSearchQuery,
  MIN_TENDER_SEARCH_LENGTH,
  nextSearchQueryParam,
  shouldRunTenderSearch,
  tenderSearchHint,
  TENDER_SEARCH_DEBOUNCE_MS,
  trimTenderSearchInput,
} from "@/lib/tender-search";

describe("tender search helpers", () => {
  it("requires at least 3 characters after trim", () => {
    expect(MIN_TENDER_SEARCH_LENGTH).toBe(3);
    expect(shouldRunTenderSearch("u")).toBe(false);
    expect(shouldRunTenderSearch("un")).toBe(false);
    expect(shouldRunTenderSearch("und")).toBe(true);
    expect(shouldRunTenderSearch("  und  ")).toBe(true);
  });

  it("ignores whitespace-only input", () => {
    expect(trimTenderSearchInput("   ")).toBe("");
    expect(shouldRunTenderSearch("   ")).toBe(false);
    expect(effectiveTenderSearchQuery("   ")).toBeUndefined();
    expect(nextSearchQueryParam("   ", undefined)).toEqual({ action: "none" });
  });

  it("does not commit one or two character searches to the URL", () => {
    expect(effectiveTenderSearchQuery("u")).toBeUndefined();
    expect(effectiveTenderSearchQuery("un")).toBeUndefined();
    expect(effectiveTenderSearchQuery("unde")).toBe("unde");
    expect(nextSearchQueryParam("u", undefined)).toEqual({ action: "none" });
    expect(nextSearchQueryParam("un", undefined)).toEqual({ action: "none" });
    expect(nextSearchQueryParam("und", undefined)).toEqual({
      action: "search",
      q: "und",
    });
  });

  it("clears the server search immediately when input drops below 3 chars", () => {
    expect(nextSearchQueryParam("", "unde")).toEqual({ action: "clear" });
    expect(nextSearchQueryParam("un", "unde")).toEqual({ action: "clear" });
    expect(nextSearchQueryParam("  ", "unde")).toEqual({ action: "clear" });
  });

  it("shows a helper for short typed input", () => {
    expect(tenderSearchHint("")).toBeNull();
    expect(tenderSearchHint("u")).toBe("Type at least 3 characters");
    expect(tenderSearchHint("un")).toBe("Type at least 3 characters");
    expect(tenderSearchHint("und")).toBeNull();
  });

  it("waits about a second before searching so typing can finish", () => {
    expect(TENDER_SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(900);
    expect(TENDER_SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(1200);
  });

  it("searches only useful indexed fields", () => {
    const clause = buildTenderSearchOrFilter("unde");
    expect(clause).toContain("title.ilike.%unde%");
    expect(clause).toContain("source_tender_id.ilike.%unde%");
    expect(clause).toContain("reference_no.ilike.%unde%");
    expect(clause).toContain("organization.ilike.%unde%");
    expect(clause).toContain("authority.ilike.%unde%");
    expect(clause).not.toContain("department");
    expect(clause).not.toContain("raw_metadata");
    expect(clause).not.toContain("city.ilike");
  });
});

describe("stale-request protection", () => {
  it("accepts only the latest request id", () => {
    const serial = createRequestSerial();
    const first = serial.next();
    const second = serial.next();
    expect(serial.isLatest(first)).toBe(false);
    expect(serial.isLatest(second)).toBe(true);
  });
});

describe("search debounce coalescing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs only one debounced commit when typing unde quickly", () => {
    const commits: string[] = [];
    let local = "";
    let urlQ: string | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (nextLocal: string) => {
      local = nextLocal;
      if (timer) clearTimeout(timer);
      const decision = nextSearchQueryParam(local, urlQ);
      if (decision.action === "clear") {
        urlQ = undefined;
        commits.push("");
        return;
      }
      if (decision.action !== "search") return;
      timer = setTimeout(() => {
        const latest = nextSearchQueryParam(local, urlQ);
        if (latest.action === "search" && latest.q) {
          urlQ = latest.q;
          commits.push(latest.q);
        }
      }, TENDER_SEARCH_DEBOUNCE_MS);
    };

    schedule("u");
    schedule("un");
    schedule("und");
    schedule("unde");
    vi.advanceTimersByTime(TENDER_SEARCH_DEBOUNCE_MS - 1);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual(["unde"]);
  });

  it("clears search without waiting for debounce", () => {
    const commits: string[] = [];
    let urlQ: string | undefined = "unde";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onChange = (nextLocal: string) => {
      if (timer) clearTimeout(timer);
      const decision = nextSearchQueryParam(nextLocal, urlQ);
      if (decision.action === "clear") {
        urlQ = undefined;
        commits.push("cleared");
        return;
      }
      if (decision.action !== "search") return;
      timer = setTimeout(() => {
        commits.push(decision.q!);
      }, TENDER_SEARCH_DEBOUNCE_MS);
    };

    onChange("");
    expect(commits).toEqual(["cleared"]);
    expect(urlQ).toBeUndefined();
    vi.advanceTimersByTime(TENDER_SEARCH_DEBOUNCE_MS);
    expect(commits).toEqual(["cleared"]);
  });
});

describe("loading / empty / error mutual exclusion", () => {
  function resolveViewState(input: {
    isInitialLoading: boolean;
    hasResolvedData: boolean;
    isTableRefreshing: boolean;
    listError: string | null;
    rows: unknown[];
  }) {
    const showSkeleton = input.isInitialLoading && !input.hasResolvedData;
    const showEmpty =
      !showSkeleton &&
      !input.isTableRefreshing &&
      !input.listError &&
      input.rows.length === 0;
    const showErrorBanner = Boolean(input.listError && input.hasResolvedData);
    const showTable =
      !showEmpty && (input.rows.length > 0 || showSkeleton || input.isTableRefreshing);
    return { showSkeleton, showEmpty, showErrorBanner, showTable };
  }

  it("keeps previous rows visible while the table refreshes", () => {
    const state = resolveViewState({
      isInitialLoading: false,
      hasResolvedData: true,
      isTableRefreshing: true,
      listError: null,
      rows: [{ id: "1" }],
    });
    expect(state.showEmpty).toBe(false);
    expect(state.showSkeleton).toBe(false);
    expect(state.showTable).toBe(true);
  });

  it("does not show empty while a date filter request is in flight", () => {
    const state = resolveViewState({
      isInitialLoading: false,
      hasResolvedData: true,
      isTableRefreshing: true,
      listError: null,
      rows: [],
    });
    expect(state.showEmpty).toBe(false);
  });

  it("shows empty only after a successful zero-result response", () => {
    const state = resolveViewState({
      isInitialLoading: false,
      hasResolvedData: true,
      isTableRefreshing: false,
      listError: null,
      rows: [],
    });
    expect(state.showEmpty).toBe(true);
    expect(state.showErrorBanner).toBe(false);
  });

  it("retains results and surfaces error separately on failure", () => {
    const state = resolveViewState({
      isInitialLoading: false,
      hasResolvedData: true,
      isTableRefreshing: false,
      listError: "Failed to load tenders",
      rows: [{ id: "1" }],
    });
    expect(state.showEmpty).toBe(false);
    expect(state.showErrorBanner).toBe(true);
    expect(state.showTable).toBe(true);
  });
});

describe("combined filter query key behaviour", () => {
  it("resets page when search or filters change via nextSearchQueryParam consumers", () => {
    const decision = nextSearchQueryParam("bridge", "old");
    expect(decision).toEqual({ action: "search", q: "bridge" });
  });

  it("preserves unrelated filters when only search clears", () => {
    const params = new URLSearchParams(
      "date=yesterday&status=GO&city=Delhi&q=unde&page=2",
    );
    params.delete("q");
    params.set("page", "1");
    expect(params.get("date")).toBe("yesterday");
    expect(params.get("status")).toBe("GO");
    expect(params.get("city")).toBe("Delhi");
    expect(params.get("q")).toBeNull();
    expect(params.get("page")).toBe("1");
  });
});

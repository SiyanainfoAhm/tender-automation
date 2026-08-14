import { describe, expect, it } from "vitest";

import {
  nextSortState,
  normalizeSortKeyForUi,
  resolveTenderSortColumn,
  TENDER_SORT_COLUMNS,
} from "@/lib/tender-sort";
import { tenderFiltersSchema } from "@/lib/validations";

describe("tender sort whitelist", () => {
  it("maps URL-friendly keys to DB columns", () => {
    expect(resolveTenderSortColumn("value")).toBe("tender_value");
    expect(resolveTenderSortColumn("emd")).toBe("emd_amount");
    expect(resolveTenderSortColumn("closing")).toBe("closing_date");
    expect(resolveTenderSortColumn("source")).toBe("source_portal");
    expect(resolveTenderSortColumn("status")).toBe(
      "effective_qualification_status",
    );
    expect(resolveTenderSortColumn("match")).toBe("confidence");
    expect(resolveTenderSortColumn("confidence")).toBe("confidence");
  });

  it("falls back unknown sort keys to updated_at", () => {
    expect(resolveTenderSortColumn("hacked_column")).toBe("updated_at");
    expect(resolveTenderSortColumn(undefined)).toBe("updated_at");
  });

  it("cycles asc → desc → reset", () => {
    expect(
      nextSortState({
        currentSortBy: "updated_at",
        currentSortDir: "desc",
        clicked: "value",
      }),
    ).toEqual({ sortBy: "value", sortDir: "asc" });

    expect(
      nextSortState({
        currentSortBy: "value",
        currentSortDir: "asc",
        clicked: "value",
      }),
    ).toEqual({ sortBy: "value", sortDir: "desc" });

    expect(
      nextSortState({
        currentSortBy: "tender_value",
        currentSortDir: "desc",
        clicked: "value",
      }),
    ).toEqual({ reset: true });
  });

  it("normalizes legacy keys for UI active state", () => {
    expect(normalizeSortKeyForUi("tender_value")).toBe("value");
    expect(normalizeSortKeyForUi("updated_at")).toBeNull();
  });

  it("never exposes arbitrary keys in whitelist", () => {
    expect("raw_metadata" in TENDER_SORT_COLUMNS).toBe(false);
  });
});

describe("tender filter URL params", () => {
  it("accepts sort + direction aliases", () => {
    const parsed = tenderFiltersSchema.parse({
      sort: "value",
      direction: "desc",
      source: "bidassist",
      status: "NO_GO",
      valueBand: "GT_5CR",
      emdBand: "LT_1L",
      closingPreset: "closing_7",
    });
    expect(parsed.sortBy).toBe("value");
    expect(parsed.sortDir).toBe("desc");
    expect(parsed.source).toBe("BIDASSIST");
    expect(parsed.valueBand).toBe("GT_5CR");
    expect(parsed.emdBand).toBe("LT_1L");
    expect(parsed.quickDate).toBe("closing_7");
  });

  it("rejects unknown sort into default", () => {
    const parsed = tenderFiltersSchema.parse({ sort: "drop_table" });
    expect(parsed.sortBy).toBe("updated_at");
    expect(parsed.sortDir).toBe("desc");
  });

  it("normalizes lowercase source query params", () => {
    expect(tenderFiltersSchema.parse({ source: "tender247" }).source).toBe(
      "TENDER247",
    );
  });
});

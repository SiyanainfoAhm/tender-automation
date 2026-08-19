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

  it("falls back unknown sort keys to scraped_date", () => {
    expect(resolveTenderSortColumn("hacked_column")).toBe("scraped_date");
    expect(resolveTenderSortColumn(undefined)).toBe("scraped_date");
  });

  it("cycles desc → asc → reset for value", () => {
    expect(
      nextSortState({
        currentSortBy: "scraped_date",
        currentSortDir: "desc",
        clicked: "value",
      }),
    ).toEqual({ sortBy: "value", sortDir: "desc" });

    expect(
      nextSortState({
        currentSortBy: "value",
        currentSortDir: "desc",
        clicked: "value",
      }),
    ).toEqual({ sortBy: "value", sortDir: "asc" });

    expect(
      nextSortState({
        currentSortBy: "tender_value",
        currentSortDir: "asc",
        clicked: "value",
      }),
    ).toEqual({ reset: true });
  });

  it("normalizes legacy keys for UI active state", () => {
    expect(normalizeSortKeyForUi("tender_value")).toBe("value");
    expect(normalizeSortKeyForUi("scraped_date")).toBe("scraped");
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
    expect(parsed.sortBy).toBe("scraped_date");
    expect(parsed.sortDir).toBe("desc");
  });

  it("normalizes lowercase source query params", () => {
    expect(tenderFiltersSchema.parse({ date: "this-week" }).date).toBe(
      "this_week",
    );
    expect(tenderFiltersSchema.parse({ date: "yesterday" }).date).toBe(
      "yesterday",
    );
    const custom = tenderFiltersSchema.parse({
      date: "custom",
      selectedDate: "2026-08-17",
      status: "screening",
      order: "desc",
    });
    expect(custom.selectedDate).toBe("2026-08-17");
    expect(custom.status).toBe("screening");
    expect(custom.sortDir).toBe("desc");
  });
});

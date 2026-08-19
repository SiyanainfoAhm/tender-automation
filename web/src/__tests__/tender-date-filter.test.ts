import { describe, expect, it } from "vitest";

import {
  formatCompactAppDate,
  normalizeDatePreset,
  resolveScrapedDateFilter,
} from "@/lib/tender-date-filter";

describe("scraped date presets (Asia/Kolkata)", () => {
  const now = new Date("2026-08-19T18:12:00+05:30");

  it("normalizes hyphenated URL presets", () => {
    expect(normalizeDatePreset("this-week")).toBe("this_week");
    expect(normalizeDatePreset("last-month")).toBe("last_month");
    expect(normalizeDatePreset("custom")).toBe("custom");
  });

  it("resolves today as an equality on the IST calendar date", () => {
    expect(resolveScrapedDateFilter({ preset: "today", now })).toEqual({
      mode: "eq",
      value: "2026-08-19",
    });
  });

  it("resolves yesterday", () => {
    expect(resolveScrapedDateFilter({ preset: "yesterday", now })).toEqual({
      mode: "eq",
      value: "2026-08-18",
    });
  });

  it("resolves this week from Monday through today", () => {
    expect(resolveScrapedDateFilter({ preset: "this-week", now })).toEqual({
      mode: "range",
      gte: "2026-08-17",
      lte: "2026-08-19",
    });
  });

  it("resolves last week as previous Monday–Sunday", () => {
    expect(resolveScrapedDateFilter({ preset: "last_week", now })).toEqual({
      mode: "range",
      gte: "2026-08-10",
      lte: "2026-08-16",
    });
  });

  it("resolves this month from the 1st through today", () => {
    expect(resolveScrapedDateFilter({ preset: "this_month", now })).toEqual({
      mode: "range",
      gte: "2026-08-01",
      lte: "2026-08-19",
    });
  });

  it("resolves last month as the full previous calendar month", () => {
    expect(resolveScrapedDateFilter({ preset: "last_month", now })).toEqual({
      mode: "range",
      gte: "2026-07-01",
      lte: "2026-07-31",
    });
  });

  it("resolves a custom selected calendar date with eq", () => {
    expect(
      resolveScrapedDateFilter({
        preset: "custom",
        selectedDate: "2026-08-17",
        now,
      }),
    ).toEqual({
      mode: "eq",
      value: "2026-08-17",
    });
  });

  it("formats date-only values without timezone shift", () => {
    expect(formatCompactAppDate("2026-08-17")).toBe("17 Aug 2026");
  });
});

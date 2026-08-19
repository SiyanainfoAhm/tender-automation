import { describe, expect, it } from "vitest";

import {
  resolveCreatedDateRange,
  formatCompactAppDate,
} from "@/lib/tender-date-filter";

describe("created date presets (Asia/Kolkata)", () => {
  const now = new Date("2026-08-19T18:12:00+05:30");

  it("resolves today as the IST calendar day", () => {
    expect(resolveCreatedDateRange({ preset: "today", now })).toEqual({
      from: "2026-08-19T00:00:00.000+05:30",
      to: "2026-08-19T23:59:59.999+05:30",
    });
  });

  it("resolves yesterday", () => {
    expect(resolveCreatedDateRange({ preset: "yesterday", now })).toEqual({
      from: "2026-08-18T00:00:00.000+05:30",
      to: "2026-08-18T23:59:59.999+05:30",
    });
  });

  it("resolves this week from Monday through now", () => {
    const range = resolveCreatedDateRange({ preset: "this_week", now });
    expect(range?.from).toBe("2026-08-17T00:00:00.000+05:30");
    expect(range?.to).toBe(now.toISOString());
  });

  it("resolves last week as previous Monday–Sunday", () => {
    expect(resolveCreatedDateRange({ preset: "last_week", now })).toEqual({
      from: "2026-08-10T00:00:00.000+05:30",
      to: "2026-08-16T23:59:59.999+05:30",
    });
  });

  it("resolves this month from the 1st through now", () => {
    const range = resolveCreatedDateRange({ preset: "this_month", now });
    expect(range?.from).toBe("2026-08-01T00:00:00.000+05:30");
    expect(range?.to).toBe(now.toISOString());
  });

  it("resolves last month as the full previous calendar month", () => {
    expect(resolveCreatedDateRange({ preset: "last_month", now })).toEqual({
      from: "2026-07-01T00:00:00.000+05:30",
      to: "2026-07-31T23:59:59.999+05:30",
    });
  });

  it("resolves a custom selected calendar date", () => {
    expect(
      resolveCreatedDateRange({
        preset: "custom",
        selectedDate: "2026-08-17",
        now,
      }),
    ).toEqual({
      from: "2026-08-17T00:00:00.000+05:30",
      to: "2026-08-17T23:59:59.999+05:30",
    });
  });

  it("formats compact created dates in IST", () => {
    expect(formatCompactAppDate("2026-08-19T04:30:00.000Z")).toBe("19 Aug 2026");
  });
});

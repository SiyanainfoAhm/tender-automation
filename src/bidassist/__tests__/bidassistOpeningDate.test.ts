import assert from "node:assert/strict";
import test from "node:test";
import {
  isMutedDayClassName,
  monthStepsBetween,
  parseBidassistTargetDate,
  parseCalendarHeading,
} from "../bidassistFilters.js";

test("parseBidassistTargetDate handles display and ISO formats", () => {
  for (const input of ["05 Aug 2026", "5 Aug 2026", "2026-08-05"]) {
    const parsed = parseBidassistTargetDate(input);
    assert.deepEqual(
      { day: parsed.day, month: parsed.month, year: parsed.year },
      { day: 5, month: 8, year: 2026 },
      `failed for ${input}`,
    );
    assert.equal(parsed.monthName, "August");
  }
});

test("parseBidassistTargetDate accepts full month names", () => {
  const parsed = parseBidassistTargetDate("05 August 2026");
  assert.equal(parsed.month, 8);
  assert.equal(parsed.day, 5);
});

test("parseBidassistTargetDate rejects unusable input", () => {
  assert.throws(() => parseBidassistTargetDate("not a date"));
  assert.throws(() => parseBidassistTargetDate("2026-13-05"));
});

test("parseCalendarHeading reads full and short month headings", () => {
  assert.deepEqual(parseCalendarHeading("August 2026"), {
    month: 8,
    year: 2026,
  });
  assert.deepEqual(parseCalendarHeading("Aug 2026"), { month: 8, year: 2026 });
  assert.equal(parseCalendarHeading("Select Date"), null);
});

test("monthStepsBetween returns signed month distance", () => {
  const target = { month: 8, year: 2026 };
  assert.equal(monthStepsBetween({ month: 8, year: 2026 }, target), 0);
  assert.equal(monthStepsBetween({ month: 6, year: 2026 }, target), 2);
  assert.equal(monthStepsBetween({ month: 10, year: 2026 }, target), -2);
  assert.equal(monthStepsBetween({ month: 8, year: 2025 }, target), 12);
});

test("isMutedDayClassName skips adjacent-month and disabled cells", () => {
  assert.equal(isMutedDayClassName("day outside-month"), true);
  assert.equal(isMutedDayClassName("rdp-day_disabled"), true);
  assert.equal(isMutedDayClassName("datepicker-day old"), true);
  assert.equal(isMutedDayClassName("datepicker-day new"), true);
  assert.equal(isMutedDayClassName("calendar-day selected"), false);
});

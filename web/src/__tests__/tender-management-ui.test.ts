import { describe, expect, it } from "vitest";

import { categoryCapsuleClass } from "@/lib/tender-category-style";
import {
  confidenceToPercent,
  getDeadlineMeta,
  matchScoreClass,
} from "@/lib/tender-deadline";

describe("categoryCapsuleClass", () => {
  it("maps normalized project categories to pastel classes", () => {
    expect(categoryCapsuleClass("Website / Web Portal")).toContain("sky");
    expect(categoryCapsuleClass("IT Infrastructure")).toContain("orange");
    expect(categoryCapsuleClass("Cybersecurity")).toContain("rose");
    expect(categoryCapsuleClass("Cloud System / SaaS")).toContain("teal");
    expect(categoryCapsuleClass("Software License / Subscription")).toContain(
      "amber",
    );
    expect(categoryCapsuleClass("Support / AMC / Maintenance")).toContain(
      "amber",
    );
  });

  it("falls back for unknown labels", () => {
    expect(categoryCapsuleClass("Uncategorized")).toContain("background-200");
  });
});

describe("getDeadlineMeta", () => {
  const now = new Date("2026-08-14T10:00:00");

  it("formats the date and remaining days", () => {
    const meta = getDeadlineMeta("2026-08-18", now);
    expect(meta.dateLabel).toBe("18 Aug 2026");
    expect(meta.relativeLabel).toBe("4 Days Left");
    expect(meta.relativeClassName).toContain("amber");
    expect(meta.isClosed).toBe(false);
  });

  it("marks past deadlines as expired", () => {
    const meta = getDeadlineMeta("2026-08-10", now);
    expect(meta.relativeLabel).toBe("Expired");
    expect(meta.isClosed).toBe(true);
  });

  it("uses muted styling beyond 7 days", () => {
    const meta = getDeadlineMeta("2026-08-24", now);
    expect(meta.relativeLabel).toBe("10 Days Left");
    expect(meta.relativeClassName).toContain("foreground-500");
  });

  it("uses rose urgency within 3 days", () => {
    const meta = getDeadlineMeta("2026-08-16", now);
    expect(meta.relativeLabel).toBe("2 Days Left");
    expect(meta.relativeClassName).toContain("rose");
  });
});

describe("confidenceToPercent", () => {
  it("treats 0-1 values as fractions", () => {
    expect(confidenceToPercent(0.88)).toBe(88);
    expect(matchScoreClass(88)).toContain("emerald");
  });

  it("passes through already-percent values", () => {
    expect(confidenceToPercent(64)).toBe(64);
    expect(matchScoreClass(64)).toContain("amber");
  });

  it("returns null when missing", () => {
    expect(confidenceToPercent(null)).toBeNull();
  });
});

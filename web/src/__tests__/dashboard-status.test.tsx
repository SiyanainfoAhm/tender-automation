/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { FileText } from "lucide-react";

import { MetricCard, metricIconVariants } from "@/components/dashboard/metric-card";
import { decisionChartStatusKeys } from "@/components/dashboard/qualification-chart";
import { aggregateStatusCounts } from "@/lib/analytics/aggregates";
import {
  ACTIONABLE_STATUSES,
  filterRecentlyActionableRows,
  filterRecentlyQualifiedRows,
  isQualifiedStatus,
  QUALIFIED_STATUSES,
  TENDER_STATUSES,
} from "@/lib/tender-status";

const sampleRows = [
  {
    id: "1",
    effective_qualification_status: "GO",
    qualified_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "2",
    effective_qualification_status: "NO_GO",
    qualified_at: "2026-08-02T00:00:00Z",
  },
  {
    id: "3",
    effective_qualification_status: "VERIFY",
    qualified_at: "2026-08-03T00:00:00Z",
  },
  {
    id: "4",
    effective_qualification_status: "CONDITIONAL_GO",
    qualified_at: "2026-08-04T00:00:00Z",
  },
  {
    id: "5",
    effective_qualification_status: "PARTNER_BID",
    qualified_at: "2026-08-05T00:00:00Z",
  },
];

describe("Recently qualified filter", () => {
  it("1. returns only GO tenders", () => {
    const result = filterRecentlyQualifiedRows(sampleRows);
    expect(result).toHaveLength(1);
    expect(result[0]?.effective_qualification_status).toBe("GO");
  });

  it("2. excludes NO_GO", () => {
    const result = filterRecentlyQualifiedRows(sampleRows);
    expect(
      result.some((r) => r.effective_qualification_status === "NO_GO"),
    ).toBe(false);
  });

  it("3. excludes VERIFY", () => {
    const result = filterRecentlyQualifiedRows(sampleRows);
    expect(
      result.some((r) => r.effective_qualification_status === "VERIFY"),
    ).toBe(false);
  });

  it("4. excludes CONDITIONAL_GO", () => {
    const result = filterRecentlyQualifiedRows(sampleRows);
    expect(
      result.some((r) => r.effective_qualification_status === "CONDITIONAL_GO"),
    ).toBe(false);
  });

  it("5. excludes PARTNER_BID", () => {
    const result = filterRecentlyQualifiedRows(sampleRows);
    expect(
      result.some((r) => r.effective_qualification_status === "PARTNER_BID"),
    ).toBe(false);
  });

  it("excludes rows without qualified_at", () => {
    const result = filterRecentlyQualifiedRows([
      { effective_qualification_status: "GO", qualified_at: null },
    ]);
    expect(result).toHaveLength(0);
  });
});

describe("Recently actionable filter", () => {
  it("6. includes GO, CONDITIONAL_GO and PARTNER_BID", () => {
    const result = filterRecentlyActionableRows(sampleRows);
    const statuses = result.map((r) => r.effective_qualification_status);
    expect(statuses).toContain("GO");
    expect(statuses).toContain("CONDITIONAL_GO");
    expect(statuses).toContain("PARTNER_BID");
    expect(statuses).not.toContain("NO_GO");
    expect(statuses).not.toContain("VERIFY");
  });

  it("ACTIONABLE_STATUSES matches spec", () => {
    expect([...ACTIONABLE_STATUSES]).toEqual([
      "GO",
      "CONDITIONAL_GO",
      "PARTNER_BID",
    ]);
  });
});

describe("GO KPI semantics", () => {
  it("7. isQualifiedStatus is true only for GO", () => {
    expect(isQualifiedStatus("GO")).toBe(true);
    expect(isQualifiedStatus("NO_GO")).toBe(false);
    expect(isQualifiedStatus("VERIFY")).toBe(false);
    expect(QUALIFIED_STATUSES).toEqual(["GO"]);
  });
});

describe("Decision distribution chart", () => {
  it("8. can include all five decision statuses", () => {
    expect(decisionChartStatusKeys()).toEqual([...TENDER_STATUSES]);
    const counts = aggregateStatusCounts(
      sampleRows.map((r) => ({
        effective_qualification_status: r.effective_qualification_status,
      })),
    );
    expect(counts.GO).toBe(1);
    expect(counts.NO_GO).toBe(1);
    expect(counts.VERIFY).toBe(1);
    expect(counts.CONDITIONAL_GO).toBe(1);
    expect(counts.PARTNER_BID).toBe(1);
  });
});

describe("Metric icon variants", () => {
  it("9. light-theme icon containers use light backgrounds", () => {
    for (const iconContainer of Object.values(metricIconVariants)) {
      expect(iconContainer).toMatch(
        /bg-(blue|emerald|orange|sky|violet)-100/,
      );
      expect(iconContainer).not.toMatch(/bg-slate-8/);
      expect(iconContainer).not.toContain("text-white");
    }
  });

  it("10. dark-theme variants are scoped with dark:", () => {
    expect(metricIconVariants.total).toContain("dark:bg-blue-500/15");
    expect(metricIconVariants.go).toContain("dark:text-emerald-300");
  });

  it("11. KPI card uses white background without unconditional dark bg", () => {
    const { container } = render(
      <MetricCard
        label="Total tenders"
        value={42}
        icon={FileText}
        variant="total"
      />,
    );
    const card = container.firstElementChild;
    expect(card?.className).toContain("metric-card");
    expect(card?.className).toContain("bg-white");
    expect(card?.className).toContain("text-slate-950");
    expect(card?.className).toContain("dark:bg-slate-900");
    expect(card?.className).not.toMatch(/(?<!\S)bg-slate-900(?!\S)/);
    expect(card?.className).not.toMatch(/(?<!\S)bg-slate-950(?!\S)/);
  });

  it("12. light-mode KPI text uses readable kpi-* classes", () => {
    const { container } = render(
      <MetricCard
        label="Total tenders"
        value={42}
        hint="Across all sources"
        icon={FileText}
        variant="total"
      />,
    );
    expect(container.querySelector(".kpi-value")).toBeTruthy();
    expect(container.querySelector(".kpi-label")?.textContent).toBe(
      "Total tenders",
    );
    expect(container.querySelector(".kpi-hint")?.textContent).toBe(
      "Across all sources",
    );
  });

  it("13. zero KPI values remain visible and are not faded", () => {
    const { container } = render(
      <MetricCard
        label="Total tenders"
        value={0}
        icon={FileText}
        variant="total"
      />,
    );
    const value = container.querySelector(".kpi-value");
    expect(value?.className).toContain("opacity-100");
    expect(value?.className).not.toMatch(/\bopacity-(10|20|30|40)\b/);
    expect(value?.textContent).toBe("0");
  });

  it("variant colors affect only the icon container", () => {
    const { container } = render(
      <MetricCard
        label="GO opportunities"
        value={5}
        icon={FileText}
        variant="go"
      />,
    );
    const iconWrap = container.querySelector(".size-8.rounded-lg");
    expect(iconWrap?.className).toContain("bg-emerald-100");
    const value = container.querySelector(".kpi-value");
    expect(value?.className).not.toContain("bg-emerald");
    expect(value?.className).not.toContain("text-emerald");
  });

  it("loading styles use pulse only while loading", () => {
    const { container, rerender } = render(
      <MetricCard
        label="Total tenders"
        value={0}
        icon={FileText}
        variant="total"
        loading
      />,
    );
    expect(container.querySelector(".kpi-value")?.className).toContain(
      "animate-pulse",
    );
    rerender(
      <MetricCard
        label="Total tenders"
        value={0}
        icon={FileText}
        variant="total"
        loading={false}
      />,
    );
    expect(container.querySelector(".kpi-value")?.className).not.toContain(
      "animate-pulse",
    );
  });
});

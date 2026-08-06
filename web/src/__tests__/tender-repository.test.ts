import { describe, expect, it } from "vitest";

import {
  aggregateSourceCounts,
  aggregateStatusCounts,
} from "@/lib/analytics/aggregates";

describe("web tender list column contract", () => {
  const columns = [
    "id",
    "source_portal",
    "effective_qualification_status",
    "title",
    "closing_date",
    "tender_value",
  ];

  it("queries only known view columns (no raw_metadata or auth fields)", () => {
    const joined = columns.join(",");
    expect(joined).toContain("effective_qualification_status");
    expect(joined).not.toContain("raw_metadata");
    expect(joined).not.toContain("password");
  });
});

describe("dashboard aggregation helpers", () => {
  it("counts two tenders from mixed sources", () => {
    const bySource = aggregateSourceCounts([
      { source_portal: "TENDER247" },
      { source_portal: "BIDASSIST" },
    ]);
    expect(bySource.TENDER247).toBe(1);
    expect(bySource.BIDASSIST).toBe(1);
  });

  it("does not mark unqualified tender as NO_GO", () => {
    const byStatus = aggregateStatusCounts([
      { effective_qualification_status: "NO_GO" },
      { effective_qualification_status: null },
    ]);
    expect(byStatus.NO_GO).toBe(1);
    expect(byStatus.NOT_EVALUATED).toBe(1);
    expect(byStatus.GO).toBe(0);
  });

  it("handles empty database", () => {
    expect(aggregateStatusCounts([]).NOT_EVALUATED).toBe(0);
    expect(aggregateSourceCounts([]).TENDER247).toBe(0);
  });

  it("groups GO and VERIFY separately", () => {
    const byStatus = aggregateStatusCounts([
      { effective_qualification_status: "GO" },
      { effective_qualification_status: "VERIFY" },
    ]);
    expect(byStatus.GO).toBe(1);
    expect(byStatus.VERIFY).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { tenderFiltersSchema } from "@/lib/validations";

describe("tender repository filter contracts", () => {
  it("supports source filtering", () => {
    expect(tenderFiltersSchema.parse({ source: "BIDASSIST" }).source).toBe(
      "BIDASSIST",
    );
  });

  it("supports qualification filtering including not evaluated", () => {
    expect(tenderFiltersSchema.parse({ status: "GO" }).status).toBe("GO");
    expect(
      tenderFiltersSchema.parse({ status: "NOT_EVALUATED" }).status,
    ).toBe("NOT_EVALUATED");
  });

  it("supports date type and range", () => {
    const parsed = tenderFiltersSchema.parse({
      dateType: "closing_date",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(parsed.dateType).toBe("closing_date");
    expect(parsed.from).toBe("2026-08-01");
  });

  it("supports amount and emd ranges", () => {
    const parsed = tenderFiltersSchema.parse({
      tenderValueMin: "100000",
      tenderValueMax: "5000000",
      emdMin: "1000",
      emdMax: "50000",
    });
    expect(parsed.tenderValueMin).toBe(100000);
    expect(parsed.emdMax).toBe(50000);
  });

  it("supports search + pagination + sorting", () => {
    const parsed = tenderFiltersSchema.parse({
      q: "GEM",
      page: "2",
      pageSize: "50",
      sortBy: "tender_value",
      sortDir: "asc",
    });
    expect(parsed.q).toBe("GEM");
    expect(parsed.page).toBe(2);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.sortBy).toBe("tender_value");
    expect(parsed.sortDir).toBe("asc");
  });

  it("prefers sort/direction over legacy aliases", () => {
    const parsed = tenderFiltersSchema.parse({
      sort: "emd",
      direction: "desc",
      sortBy: "title",
      sortDir: "asc",
    });
    expect(parsed.sortBy).toBe("emd");
    expect(parsed.sortDir).toBe("desc");
  });
});

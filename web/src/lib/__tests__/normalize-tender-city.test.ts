import { describe, expect, it } from "vitest";
import {
  normalizeCityString,
  normalizeTenderCity,
  stripLocationDecorators,
  uniqueNormalizedCities,
} from "@/lib/normalize-tender-city";

describe("normalize-tender-city", () => {
  it("strips leading colons", () => {
    expect(stripLocationDecorators(": Chennai")).toBe("Chennai");
    expect(normalizeCityString(": Chennai")).toBe("Chennai");
  });

  it("cleans Products : pollution", () => {
    expect(normalizeCityString("Hyderabad Products : PROCESSOR i5")).toBe(
      "Hyderabad",
    );
    expect(normalizeCityString("Leh Ladakh Products : Computer")).toBe(
      "Leh Ladakh",
    );
    expect(normalizeCityString("Madhya Pradesh Products : Laptop")).toBeNull();
  });

  it("extracts district and rejects orgs", () => {
    expect(
      normalizeCityString(
        "Ichalkaranji Division B Subdivision District: Kolhapur Products : CONTRACT",
      ),
    ).toBe("Kolhapur");
    expect(normalizeCityString("Jawaharlal Nehru Custom House")).toBeNull();
  });

  it("dedupes cities case-insensitively", () => {
    expect(
      uniqueNormalizedCities(["NEW DELHI", "new delhi", "New Delhi "]),
    ).toEqual(["New Delhi"]);
  });

  it("prefers explicit city field", () => {
    expect(
      normalizeTenderCity({
        city: "Bengaluru",
        location_text: "Some Office Name",
      }),
    ).toBe("Bengaluru");
  });
});

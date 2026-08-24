import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeCityString,
  normalizeTenderCity,
  stripLocationDecorators,
  uniqueNormalizedCities,
} from "../normalizeTenderCity.js";

describe("normalizeTenderCity", () => {
  it("strips leading colons and location labels", () => {
    assert.equal(stripLocationDecorators(": Hyderabad"), "Hyderabad");
    assert.equal(stripLocationDecorators("Location : Pune"), "Pune");
    assert.equal(normalizeCityString(": Mumbai"), "Mumbai");
  });

  it("extracts city before Products : suffix", () => {
    assert.equal(
      normalizeCityString("Hyderabad Products : PROCESSOR i5"),
      "Hyderabad",
    );
    assert.equal(
      normalizeCityString("Leh Ladakh Products : Computer"),
      "Leh Ladakh",
    );
    assert.equal(
      normalizeCityString("Madhya Pradesh Products : Laptop"),
      null,
    );
  });

  it("prefers district when present in scraped blobs", () => {
    assert.equal(
      normalizeCityString(
        "Ichalkaranji Division B Subdivision District: Kolhapur Products : CONTRACT FOR MONTHLY MOBILE APP",
      ),
      "Kolhapur",
    );
  });

  it("rejects organization / office / institute strings", () => {
    assert.equal(normalizeCityString("Mahisagar District Police"), "Mahisagar");
    assert.equal(
      normalizeCityString("Jawaharlal Nehru Custom House"),
      null,
    );
    assert.equal(
      normalizeCityString("Icar-central Institute For Research On Goats"),
      null,
    );
    assert.equal(
      normalizeCityString("Kerala State Data Center-1"),
      null,
    );
    assert.equal(normalizeCityString("Khalsiani Mahavidyalaya"), null);
    assert.equal(
      normalizeCityString(
        "Kondatarai (Sub-Division) under the office of the Executive Engineer (O&M) DN",
      ),
      null,
    );
  });

  it("accepts clean cities and dedupes case", () => {
    assert.equal(normalizeCityString("HYDERABAD"), "Hyderabad");
    assert.equal(normalizeCityString("New Delhi "), "New Delhi");
    assert.equal(normalizeCityString("Lucknow, Uttar Pradesh"), "Lucknow");
    assert.deepEqual(
      uniqueNormalizedCities([
        "hyderabad",
        "HYDERABAD",
        "Hyderabad ",
        "Pune",
        null,
        "Products : Laptop",
      ]),
      ["Hyderabad", "Pune"],
    );
  });

  it("uses structured field priority", () => {
    assert.equal(
      normalizeTenderCity({
        city: "Hyderabad",
        location_text: "Office of Executive Engineer",
        state: "Telangana",
      }),
      "Hyderabad",
    );
    assert.equal(
      normalizeTenderCity({
        city: null,
        location_text: "Pune, Maharashtra",
      }),
      "Pune",
    );
    assert.equal(
      normalizeTenderCity({
        city: "Products : Computer",
        organization: "Should never be used" as unknown as string,
      } as { city: string }),
      null,
    );
  });
});

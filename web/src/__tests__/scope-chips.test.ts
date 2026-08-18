import { describe, expect, it } from "vitest";

import {
  addAndSelectOption,
  DEFAULT_EXCLUDED_SCOPE_SUGGESTIONS,
  findScopeMatch,
  mergeScopeOptions,
  parseStoredScopeList,
  removeSelectedScope,
} from "@/lib/company/scope-chips";

describe("parseStoredScopeList", () => {
  it("parses arrays, newline/comma text, and JSON strings", () => {
    expect(parseStoredScopeList(["NON-IT", " Hardware "])).toEqual([
      "NON-IT",
      "Hardware",
    ]);
    expect(parseStoredScopeList("NON-IT")).toEqual(["NON-IT"]);
    expect(parseStoredScopeList("NON-IT\nHardware Only")).toEqual([
      "NON-IT",
      "Hardware Only",
    ]);
    expect(parseStoredScopeList("NON-IT, Hardware Only")).toEqual([
      "NON-IT",
      "Hardware Only",
    ]);
    expect(parseStoredScopeList('["NON-IT","Hardware Only"]')).toEqual([
      "NON-IT",
      "Hardware Only",
    ]);
  });

  it("dedupes case-insensitively", () => {
    expect(parseStoredScopeList(["NON-IT", "non-it", "Non-It"])).toEqual([
      "NON-IT",
    ]);
  });
});

describe("addAndSelectOption", () => {
  it("creates and immediately selects a custom value", () => {
    const result = addAndSelectOption(
      "  Scanning Work  ",
      [...DEFAULT_EXCLUDED_SCOPE_SUGGESTIONS],
      ["NON-IT"],
    );
    expect(result.selected).toContain("Scanning Work");
    expect(result.options).toContain("Scanning Work");
  });

  it("selects an existing option without duplicating case variants", () => {
    const result = addAndSelectOption("non-it", ["NON-IT", "Hardware Only"], []);
    expect(result.selected).toEqual(["NON-IT"]);
    expect(result.options).toEqual(["NON-IT", "Hardware Only"]);
  });

  it("ignores blank input", () => {
    const result = addAndSelectOption("   ", ["NON-IT"], ["NON-IT"]);
    expect(result.selected).toEqual(["NON-IT"]);
    expect(result.options).toEqual(["NON-IT"]);
  });
});

describe("removeSelectedScope", () => {
  it("removes the selected value but keeps option identity", () => {
    const selected = removeSelectedScope("non-it", ["NON-IT", "Hardware Only"]);
    expect(selected).toEqual(["Hardware Only"]);
    expect(findScopeMatch("NON-IT", DEFAULT_EXCLUDED_SCOPE_SUGGESTIONS)).toBe(
      "NON-IT",
    );
  });
});

describe("mergeScopeOptions", () => {
  it("keeps saved custom values in the option list", () => {
    expect(
      mergeScopeOptions(["NON-IT"], ["NON-IT", "Telecom Tower Works"]),
    ).toEqual(["NON-IT", "Telecom Tower Works"]);
  });
});

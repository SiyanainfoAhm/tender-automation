/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BidPreferencesForm } from "@/components/company/bid-preferences-form";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/server/actions/company", () => ({
  updateBidPreferencesAction: async () => ({}),
}));

afterEach(() => {
  cleanup();
});

const initial = {
  maxEmdInr: "1500000",
  minTenderValueInr: "",
  maxTenderValueInr: "50000000",
  serviceScope: ["Information Technology"],
  excludedScope: ["NON-IT"],
};

describe("BidPreferencesForm scope chips", () => {
  it("renders existing excluded scope as a selected chip, not a textarea", () => {
    render(<BidPreferencesForm canEdit initial={initial} />);
    expect(screen.queryByRole("textbox", { name: /excluded/i })).toBeNull();
    expect(screen.queryByPlaceholderText("One exclusion per line")).toBeNull();
    expect(screen.getByText("NON-IT")).toBeTruthy();
    expect(screen.getByDisplayValue("NON-IT")).toBeTruthy();
  });

  it("selects an excluded suggestion immediately", async () => {
    const user = userEvent.setup();
    render(<BidPreferencesForm canEdit initial={initial} />);
    await user.click(screen.getByRole("button", { name: "+ Hardware Only" }));
    expect(screen.getByLabelText("Remove Hardware Only")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "+ Hardware Only" }),
    ).toBeNull();
  });

  it("auto-selects a custom excluded scope on Add and Enter", async () => {
    const user = userEvent.setup();
    render(<BidPreferencesForm canEdit initial={initial} />);
    const input = screen.getByPlaceholderText("Add custom excluded scope");
    await user.type(input, "Scanning Work");
    await user.click(screen.getAllByRole("button", { name: "Add" })[1]!);
    expect(screen.getByLabelText("Remove Scanning Work")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");

    await user.type(input, "Telecom Tower Works{Enter}");
    expect(screen.getByLabelText("Remove Telecom Tower Works")).toBeTruthy();
  });

  it("does not create a duplicate excluded chip", async () => {
    const user = userEvent.setup();
    render(<BidPreferencesForm canEdit initial={initial} />);
    const input = screen.getByPlaceholderText("Add custom excluded scope");
    await user.type(input, "non-it");
    await user.click(screen.getAllByRole("button", { name: "Add" })[1]!);
    expect(screen.getAllByText("NON-IT")).toHaveLength(1);
  });

  it("removes a selected excluded chip and returns it to suggestions", async () => {
    const user = userEvent.setup();
    render(<BidPreferencesForm canEdit initial={initial} />);
    await user.click(screen.getByLabelText("Remove NON-IT"));
    expect(screen.queryByLabelText("Remove NON-IT")).toBeNull();
    expect(screen.getByRole("button", { name: "+ NON-IT" })).toBeTruthy();
  });

  it("auto-selects a custom service scope immediately", async () => {
    const user = userEvent.setup();
    render(<BidPreferencesForm canEdit initial={initial} />);
    const input = screen.getByPlaceholderText("Add custom service");
    await user.type(input, "GIS Applications");
    await user.click(screen.getAllByRole("button", { name: "Add" })[0]!);
    expect(screen.getByLabelText("Remove GIS Applications")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "+ Information Technology" }),
    ).toBeNull();
  });
});

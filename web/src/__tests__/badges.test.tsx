/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "@/components/status/qualification-badge";
import { SourceBadge } from "@/components/status/source-badge";

describe("status badges", () => {
  it("renders GO with accessible text", () => {
    render(<StatusBadge status="GO" />);
    expect(screen.getByText(/GO/i)).toBeTruthy();
  });

  it("renders NO-GO label", () => {
    render(<StatusBadge status="NO_GO" />);
    expect(screen.getByText("NO-GO")).toBeTruthy();
  });
});

describe("source badges", () => {
  it("renders Tender247 and BidAssist", () => {
    const { rerender } = render(<SourceBadge source="TENDER247" />);
    expect(screen.getByText(/Tender247|TENDER247/i)).toBeTruthy();
    rerender(<SourceBadge source="BIDASSIST" />);
    expect(screen.getByText(/BidAssist|BIDASSIST/i)).toBeTruthy();
  });
});

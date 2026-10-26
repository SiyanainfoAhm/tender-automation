// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TenderDecisionPreview } from "@/components/tenders/tender-decision-preview";

afterEach(cleanup);

const comment = "CONDITIONAL GO — supported custom software scope: FIT, BUSINESS APP, FIT\n" +
  "Detailed eligibility and delivery conditions. ".repeat(30) + "Final stored decision sentence.";

describe("TenderDecisionPreview", () => {
  it("keeps the complete stored comment and expands and collapses independently of row navigation", () => {
    const navigate = vi.fn();
    render(<div onClick={navigate} onKeyDown={navigate}><TenderDecisionPreview comment={comment} /></div>);
    const toggle = screen.getByRole("button", { name: "Show full decision" });
    const content = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(content.textContent).toBe(`ChatGPT: ${comment}`);
    expect(content.className).toContain("line-clamp-3");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(content.className).not.toContain("line-clamp-3");
    expect(content.textContent).toContain("Final stored decision sentence.");
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(content.className).toContain("line-clamp-3");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not render an empty comment", () => {
    const { container } = render(<TenderDecisionPreview comment="   " />);
    expect(container.childElementCount).toBe(0);
  });

  it("expands only the selected tender", () => {
    render(<><TenderDecisionPreview comment={comment} /><TenderDecisionPreview comment="Another decision" /></>);
    const toggles = screen.getAllByRole("button", { name: "Show full decision" });
    fireEvent.click(toggles[0]);
    expect(toggles[0].getAttribute("aria-expanded")).toBe("true");
    expect(toggles[1].getAttribute("aria-expanded")).toBe("false");
    expect(toggles[0].getAttribute("aria-controls")).not.toBe(toggles[1].getAttribute("aria-controls"));
  });
});

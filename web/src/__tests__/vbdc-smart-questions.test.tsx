import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AskAiComposer } from "@/components/tenders/ask-ai/ask-ai-composer";
import { ASK_AI_SMART_QUESTIONS } from "@/lib/ai/ask-ai-actions";

describe("VBDC smart questions", () => {
  it("defines the ten labels with explicit V2 category mappings and real questions", () => {
    expect(ASK_AI_SMART_QUESTIONS).toHaveLength(10);
    expect(ASK_AI_SMART_QUESTIONS.map(({ label, category }) => [label, category])).toEqual([
      ["Tender Summary", "GENERAL_TENDER_INFO"],
      ["Scope of Work", "SCOPE_OF_WORK"],
      ["EMD Details", "EMD"],
      ["Do We Qualify?", "DO_WE_QUALIFY"],
      ["Required Documents", "REQUIRED_DOCUMENTS"],
      ["Turnover Check", "TURNOVER"],
      ["Experience Check", "EXPERIENCE"],
      ["Certifications", "CERTIFICATIONS"],
      ["Project Cost & Profit", "PROJECT_COST"],
      ["Submission Readiness", "SUBMISSION_READINESS"],
    ]);
    expect(ASK_AI_SMART_QUESTIONS.every((item) => item.question.length > 20)).toBe(true);
  });

  it("sends the selected question and category through the existing composer", () => {
    const onSmartQuestion = vi.fn();
    render(
      <AskAiComposer
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onSmartQuestion={onSmartQuestion}
        busy={false}
      />,
    );
    for (const item of ASK_AI_SMART_QUESTIONS) {
      fireEvent.click(screen.getByRole("button", { name: item.label }));
      expect(onSmartQuestion).toHaveBeenLastCalledWith(item.question, item.category);
    }
  });

  it("disables all keyword buttons while a request is processing", () => {
    render(
      <AskAiComposer
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onSmartQuestion={() => undefined}
        busy
      />,
    );
    for (const item of ASK_AI_SMART_QUESTIONS) {
      expect(screen.getByRole("button", { name: item.label })).toBeDisabled();
    }
  });
});

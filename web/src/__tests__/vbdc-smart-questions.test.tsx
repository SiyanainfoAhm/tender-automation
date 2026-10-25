/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AskAiComposer } from "@/components/tenders/ask-ai/ask-ai-composer";
import { fetchAskAiUiConfig, type AskAiSmartQuestion } from "@/lib/ai/ask-ai-client";

const smartQuestions: AskAiSmartQuestion[] = [
  { label: "Tender Summary", category: "GENERAL_TENDER_INFO", question: "Summarize this tender, including its estimated value, our eligibility, key requirements and scope of work." },
  { label: "Scope of Work", category: "SCOPE_OF_WORK", question: "Explain the complete scope of work and what we must actually develop, implement, deliver and maintain." },
  { label: "EMD Details", category: "EMD", question: "What is the EMD amount, payable amount, applicable exemption and impact on our bidding eligibility?" },
  { label: "Do We Qualify?", category: "DO_WE_QUALIFY", question: "Evaluate every mandatory pre-qualification condition against our company documents and explain whether we qualify." },
  { label: "Required Documents", category: "REQUIRED_DOCUMENTS", question: "List every mandatory document required to submit this tender and compare it with our available company documents and checklist." },
  { label: "Turnover Check", category: "TURNOVER", question: "Do our audited financial statements satisfy the tender's turnover and financial eligibility requirements?" },
  { label: "Experience Check", category: "EXPERIENCE", question: "Do our past projects and completion certificates satisfy the tender's similar-work experience criteria?" },
  { label: "Certifications", category: "CERTIFICATIONS", question: "Do we possess all mandatory certifications, registrations and authorizations required by this tender?" },
  { label: "Project Cost & Profit", category: "PROJECT_COST", question: "Estimate the cost to deliver this tender, suggest a realistic bid price and calculate our expected profit." },
  { label: "Submission Readiness", category: "SUBMISSION_READINESS", question: "Are we ready to submit this tender? Check every mandatory document, checklist item, signing requirement and submission blocker." },
];

afterEach(() => vi.unstubAllGlobals());

describe("VBDC V2 smart questions", () => {
  it("loads the question catalog from the authenticated V2 UI config route", async () => {
    const payload = { title: "VBDC Tender Assistant", subtitle: "Ask questions about this tender", smart_questions: smartQuestions };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAskAiUiConfig("tender-123");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tenders/tender-123/ask-ai/config",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(result.smart_questions).toEqual(smartQuestions);
  });

  it("renders all ten V2-configured categories and sends their question/category unchanged", () => {
    expect(smartQuestions).toHaveLength(10);
    const onSmartQuestion = vi.fn();
    render(
      <AskAiComposer
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onSmartQuestion={onSmartQuestion}
        smartQuestions={smartQuestions}
        smartQuestionsStatus="ready"
        busy={false}
      />,
    );
    for (const item of smartQuestions) {
      fireEvent.click(screen.getByRole("button", { name: item.label }));
      expect(onSmartQuestion).toHaveBeenLastCalledWith(item.question, item.category);
    }
  });

  it("disables every chip while a response is processing", () => {
    render(
      <AskAiComposer
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onSmartQuestion={() => undefined}
        smartQuestions={smartQuestions}
        smartQuestionsStatus="ready"
        busy
      />,
    );
    for (const item of smartQuestions) {
      expect((screen.getByRole("button", { name: item.label }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("keeps the free-text composer available when V2 suggestions fail to load", () => {
    render(
      <AskAiComposer
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onSmartQuestion={() => undefined}
        smartQuestions={[]}
        smartQuestionsStatus="error"
        busy={false}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("You can still type a question.");
    expect((screen.getByRole("textbox", { name: "Ask AI message" }) as HTMLTextAreaElement).disabled).toBe(false);
  });
});

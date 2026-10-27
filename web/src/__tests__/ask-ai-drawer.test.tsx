/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const streamAskAiRequest = vi.fn();
const questions = Array.from({length:10}, (_, i) => ({label:`Question ${i+1}`, category:`CATEGORY_${String.fromCharCode(65+i)}`, question:`Full configured question ${i+1}?`}));

vi.mock("@/lib/ai/ask-ai-client", () => ({
  streamAskAiRequest: (...args: unknown[]) => streamAskAiRequest(...args),
  fetchAskAiSessions: vi.fn(async () => ({ sessions: [], total: 0 })),
  createAskAiSession: vi.fn(async () => ({ session: { id: "session-1", title: "Test", createdAt: "2026-01-01", updatedAt: "2026-01-01", lastMessageAt: "2026-01-01" } })),
  fetchAskAiSessionMessages: vi.fn(async () => ({ messages: [] })),
  saveAskAiMessage: vi.fn(async () => ({ id: "message-1" })),
  renameAskAiSession: vi.fn(async () => undefined),
  deleteAskAiSession: vi.fn(async () => undefined),
}));

vi.mock("@/server/actions/ai-reindex", () => ({
  reindexAiKnowledgeAction: vi.fn(async () => ({ ok: true, results: [] })),
}));

import { TenderAskAiDrawer } from "@/components/tenders/tender-ask-ai-drawer";
import { AskAiMarkdown } from "@/components/tenders/ask-ai/ask-ai-markdown";
import { AskAiSources } from "@/components/tenders/ask-ai/ask-ai-sources";
import { AskAiEmptyState } from "@/components/tenders/ask-ai/ask-ai-empty-state";
import { humanizeAskAiWarning } from "@/components/tenders/ask-ai/types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({smart_questions:questions})));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});

describe("Ask AI empty state", () => {
  it("renders the ten configured labels and sends full question/category", () => {
    const onSelect = vi.fn();
    render(<AskAiEmptyState questions={questions} onSelect={onSelect} />);
    expect(screen.getAllByRole("button")).toHaveLength(10);
    fireEvent.click(screen.getByText("Question 3"));
    expect(onSelect).toHaveBeenCalledWith(questions[2]);
  });
  it("does not invent fallback questions", () => {
    render(<AskAiEmptyState onSelect={vi.fn()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("AskAiMarkdown", () => {
  it("renders tables without crashing on incomplete markdown", () => {
    expect(() =>
      render(<AskAiMarkdown content={"**Turn\n| Col |\n[T"} />),
    ).not.toThrow();
    expect(() =>
      render(
        <AskAiMarkdown content={"| A | B |\n| --- | --- |\n| 1 | 2 |"} />,
      ),
    ).not.toThrow();
    expect(screen.getByText("1")).toBeTruthy();
  });
});

describe("AskAiSources", () => {
  it("expands/collapses and hides null page / missing URL", async () => {
    const user = userEvent.setup();
    render(
      <AskAiSources
        sources={[
          {
            id: "T1",
            fileName: "RFP.pdf",
            documentName: "RFP.pdf",
            pageCount: null,
            pageNumber: null,
            section: "Eligibility",
            excerpt: "Average annual turnover of five crore required.",
            documentUrl: undefined,
            sourceType: "TENDER_DOCUMENT",
          },
          {
            id: "C1",
            fileName: "Turnover.pdf",
            documentName: "Turnover.pdf",
            pageCount: null,
            pageNumber: 14,
            excerpt: "FY 2024-25 certified turnover.",
            documentUrl: "https://example.com/doc",
            sourceType: "COMPANY_DOCUMENT",
          },
        ]}
      />,
    );

    expect(screen.getByText("Sources (2)")).toBeTruthy();
    expect(screen.queryByText("RFP.pdf")).toBeNull();

    await user.click(screen.getByText("Sources (2)"));
    expect(screen.getByText("RFP.pdf")).toBeTruthy();
    expect(screen.queryByText(/^Page /)).toBeTruthy();
    expect(screen.getByText("Page 14")).toBeTruthy();
    // Only one Open document (second source)
    expect(screen.getAllByText("Open document")).toHaveLength(1);
  });
});

describe("TenderAskAiDrawer panel controls", () => {
  it("opens with tender context and collapsible history, then preserves the draft when reopened", async () => {
    const user = userEvent.setup();
    render(<TenderAskAiDrawer tenderId="tender-context" tenderTitle="Website development" />);
    await user.click(screen.getByRole("button", {name:"Ask AI about Website development"}));
    expect(screen.getByText("Tender assistant · VBDC V2")).toBeTruthy();
    expect(screen.getByRole("button", {name:"Conversation history"}).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("complementary", {name:"Tender conversation history"})).toBeNull();
    await user.click(screen.getByRole("button", {name:"Conversation history"}));
    expect(screen.getByRole("complementary", {name:"Tender conversation history"})).toBeTruthy();
    await user.click(screen.getByRole("button", {name:"Close conversation history"}));
    await user.type(screen.getByRole("textbox", {name:"Ask AI message"}), "Check this tender PQ");
    await user.click(screen.getByRole("button", {name:"Close Ask AI"}));
    await user.click(screen.getByRole("button", {name:"Ask AI about Website development"}));
    expect((screen.getByRole("textbox", {name:"Ask AI message"}) as HTMLTextAreaElement).value).toBe("Check this tender PQ");
  });
});

describe("TenderAskAiDrawer streaming UX", () => {
  it("sends message immediately and streams deltas with stop/retry/copy", async () => {
    const user = userEvent.setup();
    let handlers: {
      onStatus?: (m: string, s: "retrieving" | "generating") => void;
      onDelta?: (t: string) => void;
      onSources?: (s: unknown[], w: string[]) => void;
      onDone?: () => void;
      onError?: (e: { code: string; message: string; retryable: boolean }) => void;
    } = {};

    streamAskAiRequest.mockImplementation(async (options: { handlers: typeof handlers; signal?: AbortSignal }) => {
      handlers = options.handlers;
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          options.handlers.onError?.({
            code: "REQUEST_CANCELLED",
            message: "Request cancelled.",
            retryable: false,
          });
          resolve();
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        // keep pending until abort or external resolve via handlers usage in test
        (globalThis as { __askAiResolve?: () => void }).__askAiResolve = () => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        (globalThis as { __askAiReject?: (err: Error) => void }).__askAiReject = reject;
      });
    });

    render(
      <TenderAskAiDrawer
        tenderId="tender-1"
        tenderTitle="Very Long Tender Title For Outsourcing Maintenance Of Networks Across Multiple Locations"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Ask AI about/i }));
    expect(screen.getByTestId("ask-ai-empty-state")).toBeTruthy();

    await user.click(await screen.findByText("Question 1"));

    await waitFor(() => {
      expect(screen.getByTestId("ask-ai-user-message").textContent).toContain(
        "Full configured question 1?",
      );
    });
    expect(screen.queryByTestId("ask-ai-empty-state")).toBeNull();
    expect(
      screen.getByText(/Searching indexed evidence/i),
    ).toBeTruthy();

    expect(streamAskAiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenderId: "tender-1",
        action: undefined,
        questionCategory: "CATEGORY_A",
        sessionId: "session-1",
        message:
          "Full configured question 1?",
      }),
    );

    handlers.onStatus?.("Preparing grounded answer...", "generating");
    handlers.onDelta?.("## Eligibility\n");
    handlers.onDelta?.("Turnover is required.");

    await waitFor(() => {
      expect(screen.getByText(/Turnover is required/i)).toBeTruthy();
    });

    // Stop mid-stream
    await user.click(screen.getByTestId("ask-ai-stop"));
    await waitFor(() => {
      expect(screen.getByText(/Generation stopped/i)).toBeTruthy();
    });

    // Retry
    streamAskAiRequest.mockClear();
    let secondHandlers = handlers;
    streamAskAiRequest.mockImplementation(async (options: { handlers: typeof handlers }) => {
      secondHandlers = options.handlers;
      secondHandlers.onStatus?.("Checking eligibility requirements...", "retrieving");
      secondHandlers.onDelta?.("Full eligibility answer [T1].");
      secondHandlers.onSources?.(
        [
          {
            id: "T1",
            fileName: "RFP.pdf",
            pageCount: null,
            documentName: "RFP.pdf",
            excerpt: "Eligibility clause",
          },
        ],
        ["Some tender documents are not fully indexed yet."],
      );
      secondHandlers.onDone?.();
    });

    await user.click(screen.getByRole("button", { name: /Retry response/i }));
    await waitFor(() => {
      expect(screen.getByText(/Full eligibility answer/i)).toBeTruthy();
    });
    expect(streamAskAiRequest).toHaveBeenCalledTimes(1);
    // User message not duplicated
    expect(screen.getAllByTestId("ask-ai-user-message")).toHaveLength(1);

    expect(screen.getByTestId("ask-ai-warning").textContent).toMatch(
      /not fully indexed/i,
    );

    await user.click(screen.getByText("Sources (1)"));
    expect(screen.getByText("RFP.pdf")).toBeTruthy();

    const copyBtn = screen.getByRole("button", { name: /Copy response/i });
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeTruthy();
    });
  });

  it("sends the configured full question through the existing stream", async () => {
    const user = userEvent.setup();
    streamAskAiRequest.mockImplementation(async (options: {
      action?: string;
      message: string;
      handlers: {
        onStatus?: (m: string, s: "retrieving" | "generating") => void;
        onDelta?: (t: string) => void;
        onSources?: (s: unknown[], w: string[]) => void;
        onDone?: () => void;
      };
    }) => {
      expect(options.action).toBeUndefined();
      expect(options.message).toBe("Full configured question 2?");
      expect(options.message).not.toBe("Turnover");
      options.handlers.onStatus?.(
        "Checking financial eligibility...",
        "retrieving",
      );
      options.handlers.onDelta?.("## Status\nNeeds Verification [T1]");
      options.handlers.onSources?.(
        [
          {
            id: "T1",
            fileName: "RFP.pdf",
            pageCount: null,
            excerpt: "Average annual turnover",
          },
        ],
        [],
      );
      options.handlers.onDone?.();
    });

    render(
      <TenderAskAiDrawer tenderId="tender-1" tenderTitle="Sample Tender" />,
    );
    await user.click(screen.getByRole("button", { name: /Ask AI about/i }));
    await user.click(await screen.findByText("Question 2"));

    await waitFor(() => {
      expect(screen.getByText(/Needs Verification/i)).toBeTruthy();
    });
    expect(streamAskAiRequest).toHaveBeenCalledTimes(1);
  });

  it("follow-up after quick action still streams without action id (M)", async () => {
    const user = userEvent.setup();
    streamAskAiRequest
      .mockImplementationOnce(async (options: {
        handlers: {
          onDelta?: (t: string) => void;
          onDone?: () => void;
        };
      }) => {
        options.handlers.onDelta?.("Turnover analysis [T1].");
        options.handlers.onDone?.();
      })
      .mockImplementationOnce(async (options: {
        action?: string;
        message: string;
        conversation: unknown[];
        handlers: {
          onDelta?: (t: string) => void;
          onDone?: () => void;
        };
      }) => {
        expect(options.action).toBeUndefined();
        expect(options.message).toMatch(/certificate/i);
        expect(options.conversation.length).toBeGreaterThan(0);
        options.handlers.onDelta?.("CA certificate is required [T2].");
        options.handlers.onDone?.();
      });

    render(
      <TenderAskAiDrawer tenderId="tender-1" tenderTitle="Sample Tender" />,
    );
    await user.click(screen.getByRole("button", { name: /Ask AI about/i }));
    await user.click(await screen.findByText("Question 2"));
    await waitFor(() => {
      expect(screen.getByText(/Turnover analysis/i)).toBeTruthy();
    });

    const textarea = screen.getByLabelText("Ask AI message");
    await user.type(textarea, "What certificate do we need for this?");
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(screen.getByText(/CA certificate is required/i)).toBeTruthy();
    });
    expect(streamAskAiRequest).toHaveBeenCalledTimes(2);
  });

  it("disables empty send and supports Enter / Shift+Enter", async () => {
    const user = userEvent.setup();
    streamAskAiRequest.mockResolvedValue(undefined);

    render(
      <TenderAskAiDrawer tenderId="tender-1" tenderTitle="Tender" />,
    );
    await user.click(screen.getByRole("button", { name: /Ask AI about/i }));

    const send = screen.getByTestId("ask-ai-send");
    expect(send.hasAttribute("disabled")).toBe(true);

    const textarea = screen.getByLabelText("Ask AI message");
    await user.type(textarea, "Hello");
    expect(send.hasAttribute("disabled")).toBe(false);

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(streamAskAiRequest).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(streamAskAiRequest).toHaveBeenCalled());
  });

  it("prevents duplicate send while generating", async () => {
    const user = userEvent.setup();
    streamAskAiRequest.mockImplementation(
      () => new Promise(() => undefined),
    );

    render(
      <TenderAskAiDrawer tenderId="tender-1" tenderTitle="Tender" />,
    );
    await user.click(screen.getByRole("button", { name: /Ask AI about/i }));
    await user.click(await screen.findByText("Question 3"));

    await waitFor(() => expect(streamAskAiRequest).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("ask-ai-stop")).toBeTruthy();
    expect(screen.queryByTestId("ask-ai-send")).toBeNull();
  });
});

describe("warning humanize", () => {
  it("maps index readiness to non-technical copy", () => {
    expect(
      humanizeAskAiWarning(
        "AI knowledge for this tender has not been indexed yet.",
      ),
    ).toBe("Preparing AI knowledge for this tender. This is required only once.");
  });
});

describe("long tender title", () => {
  it("renders truncated title in header", async () => {
    const user = userEvent.setup();
    render(
      <TenderAskAiDrawer
        tenderId="t"
        tenderTitle={"Network maintenance ".repeat(12)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Ask AI about/i }));
    const header = screen
      .getAllByText(/Network maintenance/)
      .find((el) => el.className.includes("line-clamp-2"));
    expect(header).toBeTruthy();
  });
});

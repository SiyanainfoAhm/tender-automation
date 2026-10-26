/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskAiFeedback } from "@/components/tenders/ask-ai/ask-ai-feedback";
import { feedbackStatusText } from "@/lib/ai/chat-feedback";
const props = {tenderId:"tender",messageId:"message",answer:"Original answer [R1]."};
afterEach(() => {cleanup();vi.unstubAllGlobals();});
describe("answer feedback", () => {
  it("records helpful feedback once and waits for server confirmation", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({feedback:{id:"f",kind:"HELPFUL",status:"RECORDED"}}));
    vi.stubGlobal("fetch",fetch);render(<AskAiFeedback {...props} />);
    fireEvent.click(screen.getByRole("button",{name:"Helpful"}));
    fireEvent.click(screen.getByRole("button",{name:"Helpful"}));
    await screen.findByText(/marked helpful/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({message_id:"message",feedback_type:"HELPFUL"});
  });
  it("opens an editable correction and queues it without claiming learning", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({feedback:{id:"f",kind:"CORRECTION",status:"QUEUED"}}));
    vi.stubGlobal("fetch",fetch);render(<AskAiFeedback {...props} />);
    fireEvent.click(screen.getByRole("button",{name:"Needs improvement"}));
    expect((screen.getByLabelText("Edit the proposed answer") as HTMLTextAreaElement).value).toBe(props.answer);
    fireEvent.change(screen.getByLabelText("What should change?"),{target:{value:"The value is wrong; see RFP page 4."}});
    fireEvent.change(screen.getByLabelText("Edit the proposed answer"),{target:{value:"Correct value per page 4."}});
    fireEvent.click(screen.getByRole("button",{name:"Save correction"}));
    await screen.findByText(/has not been learned yet/);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({feedback_type:"CORRECTION",corrected_answer:"Correct value per page 4."});
    expect(props.answer).toBe("Original answer [R1].");
  });
  it("retains the same request ID after a failed submission", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("Connection failed")).mockResolvedValueOnce(Response.json({feedback:{id:"f",kind:"HELPFUL",status:"RECORDED"}}));
    vi.stubGlobal("fetch",fetch);render(<AskAiFeedback {...props} />);
    fireEvent.click(screen.getByRole("button",{name:"Helpful"}));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button",{name:"Helpful"}));
    await screen.findByText(/marked helpful/);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).request_id).toBe(JSON.parse(fetch.mock.calls[1][1].body).request_id);
  });
  it("restores queued status and only reports learning after verification", async () => {
    vi.stubGlobal("fetch",vi.fn(async (_url: string, _init?: RequestInit) => Response.json({feedback:{id:"f",kind:"CORRECTION",status:"VERIFIED"}})));
    render(<AskAiFeedback {...props} initialFeedback={{id:"f",kind:"CORRECTION",status:"QUEUED"}} />);
    fireEvent.click(screen.getByRole("button",{name:"Check status"}));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Correction verified against documents"));
    expect(feedbackStatusText({id:"f",kind:"CORRECTION",status:"INSUFFICIENT_EVIDENCE"})).toContain("More document evidence");
  });
});


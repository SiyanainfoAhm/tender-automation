// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ChecklistItemRow } from "@/server/repositories/bidChecklistRepository";
const mocks=vi.hoisted(()=>({generate:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("@/server/actions/bid-workspace",()=>({generateChecklistDocumentAction:mocks.generate}));
import { ChecklistItemAiChat } from "../checklist-item-ai-chat";
const item={id:"item1",requirementKey:"TECHNICAL_APPROACH",requirementName:"Technical Approach",generationAllowed:true,
  documents:[{id:"doc1",source:"TENDER",hasFile:true,fileName:"plan.docx",title:"Plan"}]} as ChecklistItemRow;
const result={ok:true,documentId:"doc2",fileName:"plan-v2.docx",title:"Plan v2",versionLabel:"v2",missingInformation:["Confirm timeline"],warnings:[]};
function open() {fireEvent.click(screen.getByRole("button",{name:/Ask AI about checklist/}));}
function submit(prompt="Expand the testing plan") {fireEvent.change(screen.getByLabelText("Instructions for checklist document"),{target:{value:prompt}});fireEvent.click(screen.getByRole("button",{name:"Send & save draft"}));}
beforeEach(()=>{vi.clearAllMocks();mocks.generate.mockResolvedValue(result);Element.prototype.scrollIntoView=vi.fn();});
afterEach(cleanup);
describe("checklist item document chat",()=>{
  it("waits for a prompt, modifies the selected attachment and uses the saved version for follow-ups",async()=>{
    render(<ChecklistItemAiChat tenderId="tender1" item={item}/>);open();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(screen.getByRole("button",{name:"Send & save draft"})).toBeDisabled();
    submit();
    await screen.findByRole("link",{name:"Open draft: plan-v2.docx"});
    expect(mocks.generate).toHaveBeenCalledWith({tenderId:"tender1",requirementId:"item1",customInstructions:"Expand the testing plan",documentChat:{mode:"modify",sourceDocument:{id:"doc1",source:"TENDER"}}});
    expect(screen.getByText("Confirm timeline")).toBeVisible();
    submit("Make the introduction shorter");
    await waitFor(()=>expect(mocks.generate).toHaveBeenCalledTimes(2));
    expect(mocks.generate.mock.calls[1][0].documentChat.sourceDocument.id).toBe("doc2");
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("recreates from RFP without sending the existing attachment",async()=>{
    render(<ChecklistItemAiChat tenderId="tender1" item={item}/>);open();
    fireEvent.change(screen.getByLabelText("Document AI action"),{target:{value:"recreate"}});submit("Use a phased implementation plan");
    await waitFor(()=>expect(mocks.generate).toHaveBeenCalledTimes(1));
    expect(mocks.generate.mock.calls[0][0].documentChat).toEqual({mode:"recreate",sourceDocument:undefined});
  });
  it("blocks modification without an attachment, but permits recreation",()=>{
    render(<ChecklistItemAiChat tenderId="tender1" item={{...item,documents:[]}}/>);open();
    fireEvent.change(screen.getByLabelText("Document AI action"),{target:{value:"modify"}});
    submit();expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("shows failures and keeps the prompt and original source for retry",async()=>{
    mocks.generate.mockResolvedValue({ok:false,error:"Your session expired"});
    render(<ChecklistItemAiChat tenderId="tender1" item={item}/>);open();submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session expired");
    expect(screen.getByLabelText("Instructions for checklist document")).toHaveValue("Expand the testing plan");
    expect(screen.getByLabelText("Attachment to edit")).toHaveValue("TENDER:doc1");
    expect(screen.queryByRole("link",{name:/Open draft/})).not.toBeInTheDocument();
  });
  it("prevents simultaneous requests and disables editing without permission",async()=>{
    mocks.generate.mockReturnValue(new Promise(()=>{}));
    const {unmount}=render(<ChecklistItemAiChat tenderId="tender1" item={item}/>);open();submit();
    fireEvent.click(screen.getByRole("button",{name:"Working…"}));expect(mocks.generate).toHaveBeenCalledTimes(1);
    unmount();render(<ChecklistItemAiChat tenderId="tender1" item={item} disabled/>);
    expect(screen.getByRole("button",{name:/Ask AI about checklist/})).toBeDisabled();
  });
  it("does not fabricate external evidence even if a bad flag says generation allowed",()=>{
    render(<ChecklistItemAiChat tenderId="tender1" item={{...item,requirementKey:"GST_REGISTRATION",requirementName:"GST Registration Certificate"}}/>);open();
    expect(screen.getByRole("status")).toHaveTextContent("genuine external evidence");
    expect(screen.getByRole("button",{name:"Send & save draft"})).toBeDisabled();
  });
});

import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({from:vi.fn(),workspaceRead:vi.fn(),companyRead:vi.fn(),extract:vi.fn(),queries:[] as Array<{table:string;filters:unknown[][]}>}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/db/server",()=>({getServerSupabase:()=>({from:mocks.from})}));
vi.mock("@/server/storage/tenderAutomationDocumentFunctions",()=>({invokeDocumentRead:mocks.companyRead,invokeWorkspaceDocumentRead:mocks.workspaceRead}));
vi.mock("@/server/ingestion/extractFiles",()=>({ingestDocumentBytes:mocks.extract}));
import {readChecklistAttachment} from "@/server/generation/checklistAttachment";
const options={companyId:"company-a",workspaceId:"workspace-a",requirementId:"item-a",sourceDocument:{id:"doc-a",source:"TENDER" as const}};
let responses:unknown[]=[];
beforeEach(()=>{vi.clearAllMocks();mocks.queries.length=0;responses=[{data:{matched_workspace_document_id:"doc-a"}},{data:{id:"doc-a",checklist_item_id:"item-a",file_name:"plan.docx"}}];
  mocks.from.mockImplementation(table=>{const entry={table,filters:[] as unknown[][]};mocks.queries.push(entry);const q={select:()=>q,eq:(...args:unknown[])=>{entry.filters.push(args);return q;},maybeSingle:async()=>responses.shift()};return q;});
  mocks.workspaceRead.mockResolvedValue(new Response("file bytes"));mocks.extract.mockResolvedValue([{text:"Original implementation plan"}]);
});
describe("attachment authorization and extraction",()=>{
  it("scopes item and document to company and workspace before reading",async()=>{
    await expect(readChecklistAttachment(options)).resolves.toEqual({name:"plan.docx",text:"Original implementation plan"});
    expect(mocks.workspaceRead).toHaveBeenCalledWith("doc-a");
    for(const query of mocks.queries) {expect(query.filters).toContainEqual(["company_id","company-a"]);expect(query.filters).toContainEqual(["workspace_id","workspace-a"]);}
  });
  it("rejects another company's/missing document and unrelated item attachments",async()=>{
    responses=[{data:{matched_workspace_document_id:null}},{data:null}];
    await expect(readChecklistAttachment(options)).rejects.toThrow("not attached");expect(mocks.workspaceRead).not.toHaveBeenCalled();
    responses=[{data:{matched_workspace_document_id:null}},{data:{checklist_item_id:"other-item",file_name:"plan.docx"}}];
    await expect(readChecklistAttachment(options)).rejects.toThrow("not attached");
  });
  it("does not read unrelated company documents",async()=>{
    responses=[{data:{matched_company_document_id:"other-doc"}}];
    await expect(readChecklistAttachment({...options,sourceDocument:{id:"doc-a",source:"COMPANY"}})).rejects.toThrow("not attached");expect(mocks.companyRead).not.toHaveBeenCalled();
  });
  it("fails closed on unreadable or oversized content instead of modifying incomplete text",async()=>{
    mocks.extract.mockResolvedValue([{text:""}]);await expect(readChecklistAttachment(options)).rejects.toThrow("No readable text");
    responses=[{data:{matched_workspace_document_id:"doc-a"}},{data:{file_name:"plan.docx",checklist_item_id:"item-a"}}];
    mocks.extract.mockResolvedValue([{text:"x".repeat(60001)}]);await expect(readChecklistAttachment(options)).rejects.toThrow("too long");
  });
});

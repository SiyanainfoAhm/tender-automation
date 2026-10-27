import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({permission:vi.fn(),detail:vi.fn(),workspace:vi.fn(),from:vi.fn(),generate:vi.fn(),activity:vi.fn(),template:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/server/auth/permissions",()=>({requirePermissionStrict:mocks.permission}));
vi.mock("@/server/tenders/load-tender-detail",()=>({loadTenderDetail:mocks.detail}));
vi.mock("@/server/repositories/bidWorkspaceRepository",()=>({getOrCreateWorkspace:mocks.workspace}));
vi.mock("@/lib/db/server",()=>({getServerSupabase:()=>({from:mocks.from})}));
vi.mock("@/server/generation/generateChecklistDocument",()=>({generateChecklistDocument:mocks.generate}));
vi.mock("@/server/repositories/tenderActivityRepository",()=>({insertTenderActivity:mocks.activity}));
vi.mock("@/server/repositories/bidAiPromptRepository",()=>({resolveEffectivePromptTemplate:mocks.template}));
import {generateChecklistDocumentAction} from "@/server/actions/bid-workspace";
const input={tenderId:"tender1",requirementId:"item1",customInstructions:"Expand test plan",documentChat:{mode:"recreate" as const}};
beforeEach(()=>{vi.clearAllMocks();mocks.permission.mockResolvedValue({companyId:"company1",user:{id:"user1"}});mocks.detail.mockResolvedValue({id:"tender1",qualificationStatus:"GO",submitted:false});mocks.workspace.mockResolvedValue({workspaceId:"workspace1"});
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:"item1",category:"TECHNICAL"},error:null})};mocks.from.mockReturnValue(q);mocks.template.mockResolvedValue({template:"Use the RFP"});mocks.generate.mockResolvedValue({documentId:"new-doc",fileName:"plan.docx",missingInformation:[],warnings:[]});});
describe("checklist document action permissions",()=>{
  it("requires bids.edit before any document operation",async()=>{mocks.permission.mockRejectedValue(new Error("Missing permission: bids.edit"));expect(await generateChecklistDocumentAction(input)).toMatchObject({ok:false});expect(mocks.generate).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled();});
  it("blocks submitted/no-bid workspaces",async()=>{mocks.detail.mockResolvedValue({id:"tender1",qualificationStatus:"GO",submitted:true});expect(await generateChecklistDocumentAction(input)).toMatchObject({ok:false,error:expect.stringContaining("submitted")});expect(mocks.generate).not.toHaveBeenCalled();});
  it("uses server identity, scopes the item and checks permission again before save",async()=>{
    mocks.generate.mockImplementation(async options=>{expect(options.companyId).toBe("company1");expect(options.userId).toBe("user1");await options.authorizeBeforeSave();return {documentId:"new-doc",fileName:"plan.docx",missingInformation:[],warnings:[]};});
    expect(await generateChecklistDocumentAction({...input,companyId:"attacker",userId:"attacker"} as typeof input)).toMatchObject({ok:true});
    expect(mocks.permission).toHaveBeenNthCalledWith(1,"bids.edit");expect(mocks.permission).toHaveBeenNthCalledWith(2,"bids.edit");
  });
  it("does not save if session expires while generating",async()=>{
    mocks.permission.mockResolvedValueOnce({companyId:"company1",user:{id:"user1"}}).mockRejectedValueOnce(new Error("Session expired"));
    mocks.generate.mockImplementation(async options=>{await options.authorizeBeforeSave();throw Error("should not reach save");});
    expect(await generateChecklistDocumentAction(input)).toMatchObject({ok:false,error:"Session expired"});expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("validates prompts and source values before generation",async()=>{
    expect(await generateChecklistDocumentAction({...input,customInstructions:"x".repeat(6001)})).toMatchObject({ok:false});
    expect(await generateChecklistDocumentAction({...input,documentChat:{mode:"bad" as "recreate"}})).toMatchObject({ok:false});expect(mocks.generate).not.toHaveBeenCalled();
  });
});

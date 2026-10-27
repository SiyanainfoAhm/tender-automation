import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({from:vi.fn(),source:vi.fn(),read:vi.fn(),filters:[] as unknown[][]}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/db/server",()=>({getServerSupabase:()=>({from:mocks.from})}));
vi.mock("@/server/ingestion/extractFiles",()=>({ingestDocumentBytes:vi.fn()}));
vi.mock("@/server/ingestion/resolveTenderSourceDocuments",()=>({resolveTenderSourceDocuments:mocks.source}));
vi.mock("@/server/storage/tenderAutomationDocumentFunctions",()=>({invokeBlobRead:mocks.read}));
vi.mock("@/server/repositories/companyRepository",()=>({getCompanyById:async()=>({name:"Our Company"}),getCompanyBidPreferences:async()=>({serviceScope:[]})}));
vi.mock("@/server/repositories/documentRepository",()=>({listCompanyDocuments:async()=>[]}));
vi.mock("@/server/repositories/experienceRepository",()=>({listCompanyExperience:async()=>[]}));
import {buildGenerationContext} from "@/server/generation/buildContext";
let chunks:unknown[]=[];
beforeEach(()=>{vi.clearAllMocks();mocks.filters.length=0;chunks=[{content:"The scope requires discovery, development and testing with UAT and a go-live milestone in one month.",document_name:"rfp.pdf",page_number:11,chunk_index:1}];
  mocks.from.mockImplementation(table=>{const q={select:()=>q,eq:()=>q,or:(...args:unknown[])=>{mocks.filters.push(args);return q;},order:()=>q,limit:async()=>({data:chunks,error:null}),maybeSingle:async()=>({data:table==="agenttender_bid_checklist_items"?{id:"item1",requirement_key:"PROJECT_PLAN",requirement_name:"Project implementation plan",generation_allowed:true,source_text:"Deliver within one month"}:table==="agenttender_tenders"?{id:"tender1",title:"App tender"}:null}),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};return q;});});
describe("interactive V2 RFP retrieval",()=>{
  it("reuses company-scoped indexed RFP text instead of downloading tender ZIPs for each edit",async()=>{
    const context=await buildGenerationContext({companyId:"company1",workspaceId:"workspace1",tenderId:"tender1",requirementId:"item1",preferIndexedRfp:true});
    expect(context.rfpContextText).toContain("go-live milestone");expect(context.sourceDocumentNames).toContain("rfp.pdf");
    expect(mocks.filters).toContainEqual(["company_id.is.null,company_id.eq.company1"]);expect(mocks.source).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();
  });
  it("discloses incomplete evidence rather than silently implying full RFP access",async()=>{
    chunks=[];const context=await buildGenerationContext({companyId:"company1",workspaceId:"workspace1",tenderId:"tender1",requirementId:"item1",preferIndexedRfp:true});
    expect(context.evidenceWarnings?.[0]).toContain("not indexed");expect(context.rfpContextText).toContain("Deliver within one month");expect(mocks.source).not.toHaveBeenCalled();
  });
});

import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({cookie:vi.fn(),permission:vi.fn(),db:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({get:mocks.cookie})}));
vi.mock("@/server/auth/permissions",()=>({requirePermissionStrict:mocks.permission}));
vi.mock("@/server/auth/company-access",()=>({CompanyAccessError:class extends Error{}}));
vi.mock("@/lib/db/server",()=>({getServerSupabase:mocks.db}));
import {POST,GET} from "../route";
const tender="027872ad-0ab5-4b3f-aa30-ddd281cef1f6",message="a8a0ca6f-07d4-42f9-ae76-979133778cf2",requestId="e477af8c-b1f9-43bc-9727-7f10f6c32ef6";
const context={params:Promise.resolve({id:tender})};
const fetch=vi.fn();
function request(extra={}){return new Request("https://app.example/api/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message_id:message,request_id:requestId,feedback_type:"HELPFUL",company_id:"forged",user_id:"forged",...extra})});}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("SUPABASE_URL","https://project.supabase.co");vi.stubGlobal("fetch",fetch);mocks.cookie.mockReturnValue({value:"private-session"});mocks.permission.mockResolvedValue({companyId:"real-company",user:{id:"real-user"}});fetch.mockResolvedValue(Response.json({ok:true,feedback:{id:"receipt",status:"RECORDED"}}));});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("authenticated answer feedback",()=>{
 it("forwards only the validated user session and server company",async()=>{
  const response=await POST(request(),context);expect(response.status).toBe(200);
  expect(await response.json()).toEqual({feedback:{id:"receipt",status:"RECORDED",kind:"HELPFUL"}});
  const [url,init]=fetch.mock.calls[0];expect(url).toContain("agenttender-orch-v2-chat");expect(new Headers(init.headers).get("x-agenttender-session")).toBe("private-session");
  expect(new Headers(init.headers).has("Authorization")).toBe(false);
  expect(JSON.parse(init.body)).toMatchObject({operation:"SUBMIT_FEEDBACK",company_id:"real-company",tender_id:tender,message_id:message,request_id:requestId});expect(JSON.parse(init.body).user_id).toBeUndefined();
 });
 it("requires authentication",async()=>{mocks.cookie.mockReturnValue(undefined);expect((await POST(request(),context)).status).toBe(401);expect(fetch).not.toHaveBeenCalled();});
 it("requires a correction reason and answer",async()=>{expect((await POST(request({feedback_type:"CORRECTION",corrected_answer:"Correction"}),context)).status).toBe(400);expect(fetch).not.toHaveBeenCalled();});
 it("rejects oversized corrections",async()=>{expect((await POST(request({feedback_type:"CORRECTION",corrected_answer:"x".repeat(8001),correction_reason:"reason"}),context)).status).toBe(400);});
 it("does not claim success when V2 rejects feedback",async()=>{fetch.mockResolvedValue(Response.json({ok:false},{status:403}));expect((await POST(request(),context)).status).toBe(403);});
 it("limits feedback status to the current user/company/tender",async()=>{
  const chain:any={};for(const key of ["select","eq","order","limit"])chain[key]=vi.fn(()=>chain);chain.maybeSingle=vi.fn(async()=>({data:{id:"f",verification_status:"VERIFIED",feedback_type:"CORRECTION"},error:null}));mocks.db.mockReturnValue({from:()=>chain});
  const response=await GET(new Request(`https://app.example/api/feedback?message_id=${message}`),context);
  expect(response.status).toBe(200);expect(chain.eq).toHaveBeenCalledWith("user_id","real-user");expect(chain.eq).toHaveBeenCalledWith("company_id","real-company");expect(chain.eq).toHaveBeenCalledWith("tender_id",tender);expect(response.headers.get("Cache-Control")).toContain("no-store");
 });
});


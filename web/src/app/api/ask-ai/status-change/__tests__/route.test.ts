import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),hasPermission:vi.fn(),tender:vi.fn(),update:vi.fn(),workspace:vi.fn(),search:vi.fn(),companyFilters:[] as unknown[]}));
vi.mock('@/server/auth/session',()=>({getSession:mocks.session}));
vi.mock('@/server/auth/permissions',()=>({requirePermissionStrict:mocks.permission,sessionHasPermission:mocks.hasPermission}));
vi.mock('@/server/auth/company-access',()=>({CompanyAccessError:class extends Error{}}));
vi.mock('@/server/repositories/tenderRepository',()=>({getTenderById:mocks.tender,escapePostgrestSearchTerm:(q:string)=>q.replace(/[%_,.()\\]/g,' ').trim()}));
vi.mock('@/server/actions/tender-update',()=>({updateTenderStatusAction:mocks.update}));
vi.mock('@/lib/db/server',()=>({getServerSupabase:()=>({from:(table:string)=>{
 const query={select:()=>query,eq:(key:string,value:unknown)=>{if(key==='company_id')mocks.companyFilters.push(value);return query;},or:()=>query,order:()=>query,limit:mocks.search,maybeSingle:mocks.workspace};
 if(!['agenttender_bid_workspaces','agenttender_tenders'].includes(table))throw Error('Unexpected table');return query;
}})}));
import {GET,POST} from '../route';
import {TENDER_STATUSES} from '@/lib/tender-status';
const id='10000000-0000-0000-0000-000000000001';
const get=(query:string)=>new Request('https://tender.example/api/ask-ai/status-change?'+query);
const post=(patch:Record<string,unknown>={},origin='https://tender.example')=>new Request('https://tender.example/api/ask-ai/status-change',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify({tender_id:id,status:'CONDITIONAL_GO',expected_status:'VERIFY',reason:'Reviewed eligibility evidence',confirm:true,...patch})});
beforeEach(()=>{
 vi.clearAllMocks();mocks.companyFilters.length=0;
 mocks.session.mockResolvedValue({user:{id:'actor',companyId:'actual-company',mustChangePassword:false}});
 mocks.permission.mockResolvedValue({companyId:'actual-company',user:{id:'actor',role:'ADMIN'}});mocks.hasPermission.mockReturnValue(true);
 mocks.tender.mockResolvedValue({tender:{id,title:'Website tender',qualification_status:'VERIFY',tender_value:null}});
 mocks.workspace.mockResolvedValue({data:{submission_status:'not_submitted'},error:null});mocks.search.mockResolvedValue({data:[{id,title:'Website tender'}],error:null});
 mocks.update.mockResolvedValue({ok:true,message:'Saved'});
});
describe('chat status change authorization and confirmation',()=>{
 it('shows every configured status in one response after checking edit permission',async()=>{
  const r=await GET(get('tender_id='+id));const data=await r.json();expect(r.status).toBe(200);
  expect(data.tender.options.map((x:{value:string})=>x.value)).toEqual([...TENDER_STATUSES]);
  expect(mocks.permission).toHaveBeenCalledWith('tenders.edit');expect(mocks.companyFilters).toContain('actual-company');expect(mocks.update).not.toHaveBeenCalled();
 });
 it('returns the server-derived capability and rejects sessions without edit permission',async()=>{
  mocks.hasPermission.mockReturnValue(false);expect((await (await GET(get('capability=1'))).json()).can_change_status).toBe(false);
  const {CompanyAccessError}=await import('@/server/auth/company-access');mocks.permission.mockRejectedValue(new CompanyAccessError('FORBIDDEN','denied'));
  expect((await GET(get('tender_id='+id))).status).toBe(403);expect((await POST(post())).status).toBe(403);expect(mocks.update).not.toHaveBeenCalled();
 });
 it('rejects expired authentication, missing confirmation and empty comments',async()=>{
  mocks.session.mockResolvedValueOnce(null);expect((await POST(post())).status).toBe(401);
  expect((await POST(post({confirm:false}))).status).toBe(400);expect((await POST(post({reason:''}))).status).toBe(400);expect(mocks.update).not.toHaveBeenCalled();
 });
 it('executes the existing human action only after explicit confirmation and ignores client identity',async()=>{
  const r=await POST(post({user_id:'attacker',company_id:'different-company'}));expect(r.status).toBe(200);
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith({tenderId:id,status:'CONDITIONAL_GO',reason:'Reviewed eligibility evidence'});
 });
 it('rejects stale selections, invalid statuses and existing lifecycle restrictions',async()=>{
  expect((await POST(post({expected_status:'GO'}))).status).toBe(409);
  expect((await POST(post({status:'INVENTED'}))).status).toBe(400);
  mocks.tender.mockResolvedValue({tender:{id,title:'Submitted tender',qualification_status:'SUBMITTED'}});
  const data=await (await GET(get('tender_id='+id))).json();expect(data.tender.options.find((o:{value:string})=>o.value==='GO').allowed).toBe(false);
  expect((await POST(post({status:'GO',expected_status:'SUBMITTED'}))).status).toBe(409);expect(mocks.update).not.toHaveBeenCalled();
 });
 it('does not bypass the award workflow for Won',async()=>{
  const r=await POST(post({status:'WON'}));expect((await r.json()).requires_award_details).toBe(true);expect(mocks.update).not.toHaveBeenCalled();
 });
 it('denies cross-origin writes and propagates failures without reporting success',async()=>{
  expect((await POST(post({},'https://evil.example'))).status).toBe(403);
  mocks.update.mockResolvedValue({ok:false,error:'Permission changed'});expect((await POST(post())).status).toBe(409);
 });
 it('fails closed if company submission state is unavailable and can search authorized metadata',async()=>{
  mocks.workspace.mockResolvedValueOnce({data:null,error:{message:'unavailable'}});expect((await POST(post())).status).toBe(503);expect(mocks.update).not.toHaveBeenCalled();
  const r=await GET(get('q=Website'));expect((await r.json()).tenders).toEqual([{id,title:'Website tender'}]);
 });
});

import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),token:vi.fn(),permission:vi.fn(),fetch:vi.fn()}));
vi.mock('@/server/auth/session',()=>({getSession:mocks.session,getCurrentSessionToken:mocks.token}));
vi.mock('@/server/auth/permissions',()=>({requirePermissionStrict:mocks.permission}));
vi.mock('@/server/auth/company-access',()=>({CompanyAccessError:class extends Error{}}));
import {POST} from '../route';
const request=(body:unknown,origin?:string)=>new Request('https://tender.example/api/ask-ai',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)});
beforeEach(()=>{vi.stubGlobal('fetch',mocks.fetch);vi.stubEnv('SUPABASE_URL','https://project.supabase.co');vi.stubEnv('VERCEL_GIT_COMMIT_SHA','tested-sha');mocks.session.mockReset().mockResolvedValue({user:{id:'user',companyId:'company',mustChangePassword:false}});mocks.token.mockReset().mockResolvedValue('server-session');mocks.permission.mockReset().mockResolvedValue({});mocks.fetch.mockReset().mockResolvedValue({ok:true,status:200,json:async()=>({answer:'Live answer',session_id:'chat'})});});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('Global Ask AI API',()=>{
 it('uses the server session, strips client identities and does not require a tender',async()=>{
  const result=await POST(request({message:'Status counts?',user_id:'evil',company_id:'other'}));
  expect(result.status).toBe(200);expect(result.headers.get('x-vbdc-commit')).toBe('tested-sha');
  const [url,options]=mocks.fetch.mock.calls[0];expect(url).toContain('agenttender-orch-v2-global-chat');
  expect(options.headers['x-agenttender-session']).toBe('server-session');
  expect(JSON.parse(options.body)).toEqual({message:'Status counts?',operation:'chat'});
 });
 it('returns 401 for missing/expired sessions without contacting the backend',async()=>{
  mocks.session.mockResolvedValue(null);const result=await POST(request({message:'Counts?'}));
  expect(result.status).toBe(401);expect(mocks.fetch).not.toHaveBeenCalled();expect(result.headers.get('cache-control')).toBe('no-store');
 });
 it('denies cross-origin submissions',async()=>{
  const result=await POST(request({message:'Counts?'},'https://evil.example'));expect(result.status).toBe(403);expect(mocks.fetch).not.toHaveBeenCalled();
 });
 it('presents a controlled error when the upstream service fails',async()=>{
  mocks.fetch.mockRejectedValue(new Error('sensitive infrastructure details'));const result=await POST(request({message:'Counts?'}));
  expect(result.status).toBe(503);expect(JSON.stringify(await result.json())).not.toContain('sensitive');
 });
});

it('forwards streaming bodies without buffering and keeps server credentials private',async()=>{
 const upstream=new Response('data: {"type":"status","message":"Searching…"}\n\n',{headers:{'Content-Type':'text/event-stream'}});
 mocks.fetch.mockResolvedValue(upstream);
 const result=await POST(request({message:'Best tenders?',stream:true,user_id:'evil'}));
 expect(result.headers.get('content-type')).toContain('text/event-stream');
 expect(result.headers.get('cache-control')).toContain('no-transform');
 expect(result.body).toBe(upstream.body);
 expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({message:'Best tenders?',operation:'chat',stream:true});
 expect(await result.text()).not.toContain('server-session');
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GlobalChat } from '../global-chat';
import { GLOBAL_QUESTIONS } from '@/lib/ai/global-chat';

vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/components/won-tenders/mark-as-won-dialog", () => ({MarkAsWonDialog: () => null}));
vi.mock('next/link',()=>({default:({href,children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a href={href} {...props}>{children}</a>}));
const fetchMock=vi.fn();
const presentation={summary:'Two active tenders.',details:'Verified live records.',references:[{id:'abc',title:'AI procurement',status:'GO',href:'/tenders/abc'}],followups:['Check the first tender PQ?','What is missing?','When does it close?']};
function ok(data:unknown){return Promise.resolve({ok:true,status:200,json:async()=>data});}
beforeEach(()=>{vi.stubGlobal('fetch',fetchMock);Element.prototype.scrollIntoView=vi.fn();fetchMock.mockReset();fetchMock.mockImplementation((_url,options)=>{const body=JSON.parse(options.body);return ok(body.operation==='sessions'?{sessions:[]}:{session_id:'session-1',answer:'Answer',presentation});});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('Global Ask AI',()=>{
 it('shows all ten live-question buttons and automatically sends a global request',async()=>{
  render(<GlobalChat/>);
  for(const question of GLOBAL_QUESTIONS)expect(screen.getByRole('button',{name:question})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:GLOBAL_QUESTIONS[0]}));
  await screen.findByText('Two active tenders.');
  const requests=fetchMock.mock.calls.map(c=>JSON.parse(c[1]?.body||'{}'));
  expect(requests.some(r=>r.message===GLOBAL_QUESTIONS[0]&&!('tender_id' in r))).toBe(true);
  expect(screen.getByRole('link',{name:/AI procurement/}).getAttribute('href')).toBe('/tenders/abc');
 });
 it('uses the returned session for follow-up questions and supports New Chat',async()=>{
  render(<GlobalChat/>);fireEvent.click(screen.getByRole('button',{name:GLOBAL_QUESTIONS[0]}));
  await screen.findByText('Two active tenders.');
  fireEvent.click(screen.getByRole('button',{name:'Check the first tender PQ?'}));
  await waitFor(()=>expect(fetchMock.mock.calls.map(c=>JSON.parse(c[1]?.body||'{}')).some(r=>r.message==='Check the first tender PQ?'&&r.session_id==='session-1')).toBe(true));
  await waitFor(()=>expect((screen.getByRole('button',{name:'New Chat'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'New Chat'}));
  expect(screen.getByText('What should we explore?')).toBeTruthy();
 });
 it('preserves the question on errors and offers sign-in on expired sessions',async()=>{
  fetchMock.mockImplementation((_url,options)=>JSON.parse(options.body).operation==='sessions'?ok({sessions:[]}):Promise.resolve({ok:false,status:401,json:async()=>({error:'Your session has expired. Please sign in again.'})}));
  render(<GlobalChat/>);fireEvent.click(screen.getByRole('button',{name:GLOBAL_QUESTIONS[1]}));
  await screen.findByRole('alert');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(GLOBAL_QUESTIONS[1]);
  expect(screen.getByRole('link',{name:'Sign in'})).toBeTruthy();
 });
 it('opens and closes the mobile conversation panel',()=>{
  render(<GlobalChat/>);const toggle=screen.getByRole('button',{name:'History'});
  expect(toggle.getAttribute('aria-expanded')).toBe('false');fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');fireEvent.click(screen.getByRole('button',{name:'Close history'}));
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
 });
});

it('opens one explicit status form without sending the command to the AI engine', async()=>{
 const id='10000000-0000-0000-0000-000000000001';
 fetchMock.mockImplementation((url,options)=>{
  if(String(url).includes('capability=1'))return ok({can_change_status:true});
  if(String(url).includes('status-change?tender_id='))return ok({tender:{id,title:'Website tender',current_status:'VERIFY',display_status:'VERIFY',options:[{value:'CONDITIONAL_GO',label:'May Bid (Conditional GO)',allowed:true}]}});
  const body=JSON.parse(options?.body||'{}');return ok(body.operation==='sessions'?{sessions:[]}:{answer:'Unexpected AI call'});
 });
 render(<GlobalChat/>);
 for(let i=0;i<2;i++){
  fireEvent.change(screen.getByRole('textbox',{name:'Ask a question about your tenders'}),{target:{value:'Please change status of '+id}});
  fireEvent.click(screen.getByRole('button',{name:'Send'}));
  await screen.findByRole('radio',{name:'May Bid (Conditional GO)'});
  expect(screen.getAllByRole('region',{name:'Change tender status'})).toHaveLength(1);
 }
 expect(fetchMock.mock.calls.some(([url,o])=>url==='/api/ask-ai'&&JSON.parse(o?.body||'{}').message)).toBe(false);
});

it('renders partial answer before completion, then adds references and follow-ups',async()=>{
 let controller!:ReadableStreamDefaultController<Uint8Array>;
 const encoder=new TextEncoder();
 const emit=(event:unknown)=>controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));
 fetchMock.mockImplementation((url,options)=>{
  if(url!=='/api/ask-ai')return ok({can_change_status:false});
  if(JSON.parse(options.body).operation==='sessions')return ok({sessions:[]});
  return Promise.resolve(new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'Content-Type':'text/event-stream'}}));
 });
 render(<GlobalChat/>);fireEvent.click(screen.getByRole('button',{name:GLOBAL_QUESTIONS[1]}));
 await waitFor(()=>expect(controller).toBeTruthy());
 emit({type:'status',message:'Reviewing evidence…'});
 emit({type:'partial',summary:'First words arriving',details:''});
 await screen.findByText('First words arriving');
 expect(screen.queryByRole('link',{name:/AI procurement/})).toBeNull();
 expect((screen.getByRole('button',{name:'New Chat'}) as HTMLButtonElement).disabled).toBe(true);
 emit({type:'done',session_id:'stream-session',answer:'Answer',presentation});controller.close();
 await screen.findByText('Two active tenders.');
 expect(screen.queryByText('First words arriving')).toBeNull();
 expect(screen.getByRole('link',{name:/AI procurement/})).toBeTruthy();
});
it('restores input after a truncated stream and removes unfinished text',async()=>{
 fetchMock.mockImplementation((url,options)=>{
  if(url!=='/api/ask-ai')return ok({can_change_status:false});
  if(JSON.parse(options.body).operation==='sessions')return ok({sessions:[]});
  return Promise.resolve(new Response('data: {"type":"partial","summary":"Incomplete","details":""}\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 });
 render(<GlobalChat/>);fireEvent.click(screen.getByRole('button',{name:GLOBAL_QUESTIONS[1]}));
 await screen.findByRole('alert');
 expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(GLOBAL_QUESTIONS[1]);
 expect(screen.queryByText('Incomplete')).toBeNull();
});

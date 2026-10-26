// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GlobalChat } from '../global-chat';
import { GLOBAL_QUESTIONS } from '@/lib/ai/global-chat';

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
  const requests=fetchMock.mock.calls.map(c=>JSON.parse(c[1].body));
  expect(requests.some(r=>r.message===GLOBAL_QUESTIONS[0]&&!('tender_id' in r))).toBe(true);
  expect(screen.getByRole('link',{name:/AI procurement/}).getAttribute('href')).toBe('/tenders/abc');
 });
 it('uses the returned session for follow-up questions and supports New Chat',async()=>{
  render(<GlobalChat/>);fireEvent.click(screen.getByRole('button',{name:GLOBAL_QUESTIONS[0]}));
  await screen.findByText('Two active tenders.');
  fireEvent.click(screen.getByRole('button',{name:'Check the first tender PQ?'}));
  await waitFor(()=>expect(fetchMock.mock.calls.map(c=>JSON.parse(c[1].body)).some(r=>r.message==='Check the first tender PQ?'&&r.session_id==='session-1')).toBe(true));
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

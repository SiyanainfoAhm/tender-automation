// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {TENDER_STATUSES} from '@/lib/tender-status';
import {chatStatusLabel,isStatusChangeRequest} from '@/lib/ai/status-change';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),refresh:vi.fn(),invalidate:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock('@/lib/tenders/list-cache',()=>({invalidateTenderListCaches:mocks.invalidate}));
vi.mock('@/components/won-tenders/mark-as-won-dialog',()=>({MarkAsWonDialog:({open,initialNotes}:{open:boolean;initialNotes?:string})=>open?<div role="dialog" aria-label="Award details">{initialNotes}</div>:null}));
import {ChatStatusChange} from '../chat-status-change';
const id='10000000-0000-0000-0000-000000000001';
const tender={id,title:'Website tender',current_status:'VERIFY',display_status:'VERIFY',tender_value:null,options:TENDER_STATUSES.map(value=>({value,label:chatStatusLabel(value),allowed:true}))};
const response=(data:unknown,status=200)=>({ok:status<400,status,json:async()=>data});
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',mocks.fetch);mocks.fetch.mockImplementation((_url,options)=>Promise.resolve(options?.method==='POST'?response({ok:true,message:'Status changed to May Bid (Conditional GO).'}):response({tender})));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('one-message status chooser',()=>{
 it('shows all statuses together and writes only after the explicit button click',async()=>{
  render(<ChatStatusChange tenderId={id} onDismiss={vi.fn()}/>);
  await screen.findByRole('radio',{name:'May Bid (Conditional GO)'});
  expect(screen.getAllByRole('radio')).toHaveLength(TENDER_STATUSES.length);
  expect(screen.getAllByRole('region',{name:'Change tender status'})).toHaveLength(1);
  fireEvent.click(screen.getByRole('radio',{name:'May Bid (Conditional GO)'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Comment (required)'}),{target:{value:'Reviewed the eligibility criteria'}});
  expect(mocks.fetch.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'Change Status'}));
  await screen.findByText('Status changed to May Bid (Conditional GO).');
  const writes=mocks.fetch.mock.calls.filter(([,o])=>o?.method==='POST');expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1].body)).toEqual({tender_id:id,status:'CONDITIONAL_GO',expected_status:'VERIFY',reason:'Reviewed the eligibility criteria',confirm:true});
  expect(mocks.refresh).toHaveBeenCalled();
 });
 it('shows no choices when permission is denied',async()=>{
  mocks.fetch.mockResolvedValue(response({error:'You do not have permission to change tender status.'},403));
  render(<ChatStatusChange tenderId={id} onDismiss={vi.fn()}/>);await screen.findByRole('alert');expect(screen.queryAllByRole('radio')).toHaveLength(0);expect(screen.queryByRole('button',{name:'Change Status'})).toBeNull();
 });
 it('does not write when cancelled, and preserves the error if permission expires',async()=>{
  const dismiss=vi.fn();render(<ChatStatusChange tenderId={id} onDismiss={dismiss}/>);
  await screen.findByRole('radio',{name:'May Bid (Conditional GO)'});fireEvent.click(screen.getByRole('button',{name:'Dismiss status change'}));expect(dismiss).toHaveBeenCalled();expect(mocks.fetch.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(0);
  mocks.fetch.mockImplementation((_url,o)=>Promise.resolve(o?.method==='POST'?response({error:'Please sign in again.'},401):response({tender})));
  fireEvent.click(screen.getByRole('radio',{name:'May Bid (Conditional GO)'}));fireEvent.change(screen.getByRole('textbox'),{target:{value:'Reviewed'}});fireEvent.click(screen.getByRole('button',{name:'Change Status'}));
  await screen.findByText('Please sign in again.');expect(mocks.refresh).not.toHaveBeenCalled();
 });
 it('blocks double submission and continues Won to the existing award form',async()=>{
  let finish:(data:unknown)=>void=()=>{};mocks.fetch.mockImplementation((_url,o)=>o?.method==='POST'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(response({tender})));
  render(<ChatStatusChange tenderId={id} onDismiss={vi.fn()}/>);await screen.findByRole('radio',{name:'Won'});fireEvent.click(screen.getByRole('radio',{name:'Won'}));fireEvent.change(screen.getByRole('textbox'),{target:{value:'Award received'}});
  const button=screen.getByRole('button',{name:'Change Status'});fireEvent.click(button);fireEvent.click(button);
  expect(mocks.fetch.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(1);
  finish(response({ok:true,requires_award_details:true}));await screen.findByRole('dialog',{name:'Award details'});expect(screen.getByRole('dialog',{name:'Award details'}).textContent).toContain('Award received');expect(mocks.refresh).not.toHaveBeenCalled();
 });
 it('requires an explicit tender selection in global chat',async()=>{
  mocks.fetch.mockImplementation((url)=>Promise.resolve(String(url).includes('capability=1')?response({can_change_status:true}):response({tender})));
  render(<ChatStatusChange candidates={[{id,title:'Website tender'}]} onDismiss={vi.fn()}/>);
  await screen.findByRole('combobox',{name:'Tender to change'});expect(screen.queryAllByRole('radio')).toHaveLength(0);
  fireEvent.change(screen.getByRole('combobox'),{target:{value:id}});await screen.findByRole('radio',{name:'May Bid (Conditional GO)'});
  await waitFor(()=>expect(mocks.fetch.mock.calls.some(([url])=>String(url).includes('tender_id='+id))).toBe(true));
 });
});
describe('user request routing',()=>{
 it('opens only explicit change requests, never recommendations or negatives',()=>{
  for(const q of ['Change status','Please move this tender to conditionalgo','Can you change it to GO?','I want to update the tender status'])expect(isStatusChangeRequest(q)).toBe(true);
  for(const q of ['Which Conditional Go tenders should move to GO?','What status is this tender?','Do not change the status','Please do not change status','Show all status counts'])expect(isStatusChangeRequest(q)).toBe(false);
 });
});

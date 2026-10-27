// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useState} from 'react';
import {GlobalChatLauncher} from '../global-chat-launcher';

vi.mock('../global-chat',()=>({GlobalChat:({embedded}:{embedded:boolean})=>{
 const [value,setValue]=useState('');
 return <textarea aria-label={embedded?'Global chat message':'Full-page chat'} value={value} onChange={event=>setValue(event.target.value)}/>;
}}));
afterEach(cleanup);
describe('floating global Ask AI',()=>{
 it('loads the existing global chatbot only when the corner icon is clicked',()=>{
  render(<GlobalChatLauncher/>);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Open global Ask AI'}));
  expect(screen.getByRole('dialog',{name:'Global AI assistant'})).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'Global chat message'}));
 });
 it('minimizes without unmounting the conversation and restores keyboard focus',()=>{
  render(<GlobalChatLauncher/>);
  fireEvent.click(screen.getByRole('button',{name:'Open global Ask AI'}));
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Which tenders need attention?'}});
  fireEvent.click(screen.getByRole('button',{name:'Minimize Ask AI'}));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Open global Ask AI'}));
  fireEvent.click(screen.getByRole('button',{name:'Open global Ask AI'}));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Which tenders need attention?');
 });
 it('supports Escape and preserves state across parent rerenders',()=>{
  const view=render(<GlobalChatLauncher/>);
  fireEvent.click(screen.getByRole('button',{name:'Open global Ask AI'}));
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Follow-up question'}});
  view.rerender(<GlobalChatLauncher/>);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Follow-up question');
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull();
 });
});

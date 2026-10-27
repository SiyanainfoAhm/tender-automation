import {test} from 'node:test';
import assert from 'node:assert/strict';
import {partialPresentation,readModelStream} from './stream.mjs';
test('all partial token boundaries handle escaped quotes, newlines and Unicode',()=>{
 const answer={summary:'Hello "buyer"\nहिन्दी 😀',details:'A \\ B\tline',tender_ids:[]};
 const raw=JSON.stringify(answer);
 for(let i=0;i<=raw.length;i++){
  const p=partialPresentation(raw.slice(0,i));
  assert.ok(answer.summary.startsWith(p.summary));assert.ok(answer.details.startsWith(p.details));
 }
 assert.deepEqual(partialPresentation(raw),{summary:answer.summary,details:answer.details});
 assert.equal(partialPresentation('{"summary":"a\\u263').summary,'a');
 assert.equal(partialPresentation('{"summary":"a\\u263a').summary,'a☺');
});
test('model content streams progressively before completion across byte boundaries',async()=>{
 const value={summary:'Live tenders हिन्दी',details:'Detailed analysis',tender_ids:[]};
 const frames=[...JSON.stringify(value)].map(content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\r\n\r\n').join('')+'data: [DONE]\n\n';
 const bytes=new TextEncoder().encode(frames);
 const updates=[];
 const response=new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}));
 assert.deepEqual(await readModelStream(response,p=>updates.push(p)),value);
 assert.ok(updates.some(p=>p.summary==='Live'&&p.details===''));
 assert.ok(updates.some(p=>p.details==='Detailed'));
 assert.ok(updates.every(p=>!('tender_ids' in p)));
});
test('truncated model streams fail instead of claiming completion',async()=>{
 const response=new Response('data: '+JSON.stringify({choices:[{delta:{content:'{"summary":"Partial'}}]})+'\n\n');
 await assert.rejects(readModelStream(response,()=>{}),/INTERRUPTED/);
});

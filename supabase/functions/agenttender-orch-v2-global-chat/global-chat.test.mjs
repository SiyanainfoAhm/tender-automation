import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QUESTIONS,knownPlan,cleanPlan,safeAnswer} from './plan.mjs';
import {boundedMemory} from './memory.mjs';

test('all ten questions resolve to distinct read-only retrieval intents',()=>{
 assert.equal(QUESTIONS.length,10);
 assert.equal(new Set(QUESTIONS.map(q=>knownPlan(q).intent)).size,10);
 assert.equal(knownPlan(QUESTIONS[4]).region,'GLOBAL');
 assert.equal(knownPlan(QUESTIONS[4]).country,'USA');
});
test('planner cannot inject SQL, arbitrary IDs, statuses, or identity',()=>{
 const plan=cleanPlan({intent:'DELETE',status:'GO; DROP TABLE',region:'PRIVATE',ids:['other-company','allowed'],company_id:'evil',sql:'delete from tenders'},['allowed']);
 assert.deepEqual(plan,{intent:'search',search:'',status:'',region:'',country:'',ids:['allowed']});
});
test('references are built solely from current authorized retrieval, with safe local links',()=>{
 const p=safeAnswer({summary:'Answer',details:'[bad](https://evil.example) <script>bad</script>',tender_ids:['unknown','ok','ok'],followups:[]},[{id:'ok',title:'Tender',qualification_status:'GO'}]);
 assert.equal(p.references.length,1);assert.equal(p.references[0].href,'/tenders/ok');
 assert.equal(p.followups.length,3);assert.ok(!p.details.includes('https://'));assert.ok(!p.details.includes('<script>'));
});
test('malformed or empty AI responses fail safely',()=>{
 assert.throws(()=>safeAnswer({summary:'',details:'{}'},[]));
 assert.throws(()=>safeAnswer(null,[]));
});
test('database-owned memory preserves user/assistant order and follow-up context',()=>{
 const rows=[{id:'1',role:'user',content:'Show Conditional Go tenders',created_at:'2026-10-26T10:00:00.000Z'},{id:'2',role:'assistant',content:'First: Tender A. Second: Tender B.',created_at:'2026-10-26T10:00:00.001Z'}];
 const memory=boundedMemory(rows,'Check the first one');
 assert.equal(memory.conversation[0].role,'user');assert.match(memory.conversation[1].content,/Tender A/);
 assert.equal(memory.source,'AUTHORIZED_DATABASE_HISTORY');
});

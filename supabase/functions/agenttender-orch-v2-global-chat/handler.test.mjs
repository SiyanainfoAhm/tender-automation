import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {boundedMemory} from './memory.mjs';
import {knownPlan,cleanPlan,safeAnswer,QUESTIONS} from './plan.mjs';

const company='a1b2c3d4-e5f6-7890-abcd-ef1234567890',user='6ef50315-d7ef-42ca-9b10-15fbdb9e1049';
function fixture(options={}) {
 const tables={
  agenttender_user_sessions:[{user_id:user,token_hash:createHash('sha256').update('test-session').digest('hex'),expires_at:options.expired?'2020-01-01':'2099-01-01',revoked_at:null}],
  agenttender_users:[{id:user,company_id:company,is_active:true}],
  agenttender_company_memberships:options.noMembership?[]:[{user_id:user,company_id:company,status:'active',role:'ADMIN'}],
  agenttender_role_permissions:[{role:'ADMIN',agenttender_permissions:{key:'tenders.view'}}],
  agenttender_ai_chat_sessions:[],agenttender_ai_chat_messages:[],
 };
 const reads=[];
 function query(table) {
  const filters=[];let single=false;let mutation=null,change,limit=1000,descending=false;
  const q={select(){return q;},eq(k,v){filters.push(row=>row[k]===v);return q;},is(k,v){filters.push(row=>(row[k]??null)===v);return q;},gte(k,v){filters.push(row=>row[k]>=v);return q;},maybeSingle(){single=true;return q;},order(k,o){descending=o?.ascending===false;return q;},limit(n){limit=n;return q;},insert(v){mutation='insert';change=v;return q;},update(v){mutation='update';change=v;return q;},then(resolve,reject){
   reads.push(table);
   if(options.dbError)return Promise.resolve({error:{message:'failed'}}).then(resolve,reject);
   let rows=(tables[table]||[]).filter(row=>filters.every(f=>f(row)));
   if(mutation==='insert'){tables[table].push(...(Array.isArray(change)?change:[change]).map(row=>({is_archived:false,...row})));rows=[];}
   if(mutation==='update')rows.forEach(row=>Object.assign(row,change));
   rows=rows.slice();if(descending)rows.reverse();rows=rows.slice(0,limit);
   return Promise.resolve({data:single?rows[0]||null:rows,error:null}).then(resolve,reject);
  }};return q;
 }
 let handler;
 const sandbox={console:{error(){}},Request,Response,AbortSignal,TextEncoder,crypto,Date,JSON,Set,Number,String,Promise,
  Deno:{env:{get:key=>key==='DEEPSEEK_API_KEY'?'test-ai':''},serve:fn=>{handler=fn;}},
  createClient:()=>({from:query,rpc:async()=>({data:{total:7,status_counts:{GO:2,VERIFY:5},recorded_status_counts:{UNSET:7},tenders:[],matching_total:0},error:null})}),
  boundedMemory,knownPlan,cleanPlan,safeAnswer,expandedQuery:q=>q,retrieve:async()=>({tender:[],company:[],warnings:[]}),
  fetch:async()=>{throw Error('AI unavailable');},
 };
 const source=readFileSync(new URL('./index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 new vm.Script(stripTypeScriptTypes(source)).runInNewContext(sandbox);
 return {tables,reads,call:async(body={},token='test-session')=>handler(new Request('https://local.test',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'x-agenttender-session':token}:{})},body:JSON.stringify(body)}))};
}
test('missing, invalid and expired authentication are rejected before tender retrieval',async()=>{
 for(const [f,token] of [[fixture(),null],[fixture(),'invalid'],[fixture({expired:true}),'test-session']]){
  const r=await f.call({message:QUESTIONS[0]},token);assert.equal(r.status,401);assert.ok(!f.reads.includes('agenttender_tenders'));
 }
});
test('active membership is mandatory and client identity cannot cross companies',async()=>{
 assert.equal((await fixture({noMembership:true}).call({message:QUESTIONS[0]})).status,403);
 assert.equal((await fixture().call({message:QUESTIONS[0],company_id:'other-company'})).status,403);
 assert.equal((await fixture().call({message:QUESTIONS[0],user_id:'other-user'})).status,403);
});
test('global count question needs no tender_id or AI and persists in shared history infrastructure',async()=>{
 const f=fixture();const r=await f.call({message:QUESTIONS[0]});assert.equal(r.status,200);
 const result=await r.json();assert.match(result.answer,/7 tenders/);assert.match(result.answer,/\| GO \| 2 \|/);
 assert.equal(f.tables.agenttender_ai_chat_sessions.length,1);assert.equal(f.tables.agenttender_ai_chat_sessions[0].tender_id,null);
 const messages=f.tables.agenttender_ai_chat_messages;assert.equal(messages.length,2);assert.ok(messages[0].created_at<messages[1].created_at);
 const history=await f.call({operation:'messages',session_id:result.session_id});assert.equal((await history.json()).messages.length,2);
});
test('global history cannot open another user/company session or tender-specific history',async()=>{
 const f=fixture();const id='10000000-0000-0000-0000-000000000001';
 for(const scope of [{user_id:'other',company_id:company,tender_id:null},{user_id:user,company_id:'other',tender_id:null},{user_id:user,company_id:company,tender_id:'tender'}]){
  f.tables.agenttender_ai_chat_sessions=[{id,is_archived:false,...scope}];
  assert.equal((await f.call({operation:'messages',session_id:id})).status,404);
 }
});
test('bad inputs, unsupported actions and unavailable AI fail without business mutations',async()=>{
 const f=fixture();assert.equal((await f.call({message:''})).status,400);
 assert.equal((await f.call({operation:'DELETE_TENDER'})).status,400);
 assert.equal((await f.call({message:'an analytical question'})).status,503);
 assert.equal(f.tables.agenttender_ai_chat_messages.length,0);
});

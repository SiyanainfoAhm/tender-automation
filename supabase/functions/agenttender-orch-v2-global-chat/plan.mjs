export const QUESTIONS = [
 'How many tenders are in each status?',
 'Which 10 tenders have the highest chance of winning?',
 'Show tenders where we meet all PQ requirements.',
 'Which Conditional Go tenders should move to GO?',
 'Find the best USA AI and workflow projects.',
 'Why are tenders stuck in Verify?',
 'Which Will Bid tenders have missing documents?',
 'Show tenders closing in the next seven days.',
 'Which tenders were added today?',
 'What should we prioritize today?',
];
export function knownPlan(question) {
 const i=QUESTIONS.indexOf(question.trim());
 const intent=['counts','ranking','pq','conditional','usa_ai','verify','missing','closing','today','priorities'][i];
 return intent ? {intent,...(intent==='usa_ai'?{region:'GLOBAL',search:'AI OR "artificial intelligence" OR workflow OR automation OR application OR software',country:'USA'}:{})} : null;
}
export function cleanPlan(value,allowedIds=[]) {
 const intents=['counts','ranking','pq','conditional','usa_ai','verify','missing','closing','today','priorities','search'];
 const statuses=['GO','NO_GO','VERIFY','REVIEW','CONDITIONAL_GO','MAY_BID','WILL_BID','SUBMITTED','WON','DUPLICATE','LOST','PARTNER_BID'];
 const ids=Array.isArray(value?.ids)?value.ids.filter(id=>allowedIds.includes(id)).slice(0,10):[];
 // A resolved conversation reference is the retrieval scope. Analytical words
 // such as "PQ" or "country" must not become extra full-text filters on it.
 if(ids.length)return {intent:'search',search:'',status:'',region:'',country:'',ids};
 return {intent:intents.includes(value?.intent)?value.intent:'search',search:String(value?.search||'').slice(0,200),status:statuses.includes(value?.status)?value.status:'',region:['INDIAN','GLOBAL'].includes(value?.region)?value.region:'',country:value?.country==='USA'?'USA':'',ids:Array.isArray(value?.ids)?value.ids.filter(id=>allowedIds.includes(id)).slice(0,10):[]};
}
export function safeAnswer(value,tenders) {
 if(!value||typeof value.summary!=='string'||typeof value.details!=='string'||!value.summary.trim()||!value.details.trim())throw new Error('Invalid AI answer');
 const ids=new Set(tenders.map(t=>t.id));
 const references=[...new Set(Array.isArray(value.tender_ids)?value.tender_ids.filter(id=>ids.has(id)):[])].map(id=>{const t=tenders.find(t=>t.id===id);return {id,title:t.title,status:t.qualification_status||'NOT_EVALUATED',href:'/tenders/'+id};});
 const clean=text=>String(text).replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'').replace(/<[^>]*>/g,'').trim();
 const followups=Array.isArray(value.followups)?value.followups.filter(q=>typeof q==='string'&&q.trim().length>5).slice(0,3):[];
 for(const q of QUESTIONS)if(followups.length<3&&!followups.includes(q))followups.push(q);
 return {summary:clean(value.summary).slice(0,1400),details:clean(value.details).slice(0,16000),references,followups};
}

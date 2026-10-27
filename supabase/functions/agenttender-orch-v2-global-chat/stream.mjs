// Decode only user-facing JSON string fields, including incomplete token boundaries.
export function partialPresentation(json) {
 const result={summary:'',details:''};
 for(const field of ['summary','details']) {
  const match=new RegExp('"'+field+'"\\s*:\\s*"').exec(json);
  if(!match)continue;
  let raw='';
  for(let i=match.index+match[0].length;i<json.length;i++) {
   const ch=json[i];
   if(ch==='"')break;
   if(ch==='\\') {
    const next=json[i+1];
    if(!next)break;
    if(next==='u') {
     const hex=json.slice(i+2,i+6);
     if(!/^[0-9a-f]{4}$/i.test(hex))break;
     raw+=json.slice(i,i+6);i+=5;
    } else {raw+=ch+next;i++;}
   } else raw+=ch;
  }
  try{result[field]=JSON.parse('"'+raw+'"');}catch{/* Wait for a complete escape. */}
 }
 return result;
}
export async function readModelStream(response,onPartial) {
 if(!response.body)throw new Error('AI_UNAVAILABLE');
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer='',content='',done=false,last='';
 function line(value) {
  if(!value.startsWith('data:'))return;
  const data=value.slice(5).trim();
  if(!data)return;
  if(data==='[DONE]'){done=true;return;}
  const chunk=JSON.parse(data);
  if(chunk.error)throw new Error('AI_UNAVAILABLE');
  const text=chunk.choices?.[0]?.delta?.content;
  if(typeof text!=='string')return;
  content+=text;
  const partial=partialPresentation(content),key=JSON.stringify(partial);
  if(key!==last){last=key;onPartial(partial);}
 }
 try {
  while(true) {
   const next=await reader.read();
   buffer+=decoder.decode(next.value,{stream:!next.done});
   let end;
   while((end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end).replace(/\r$/,''));buffer=buffer.slice(end+1);}
   if(next.done)break;
  }
  if(buffer.trim())line(buffer);
  if(!done)throw new Error('AI_STREAM_INTERRUPTED');
  return JSON.parse(content);
 } finally {reader.releaseLock();}
}

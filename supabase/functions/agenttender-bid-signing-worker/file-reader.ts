import {unzipSync,strFromU8} from 'npm:fflate@0.8.2';
import {getDocumentProxy} from 'npm:unpdf@0.12.1';
import {byteHash} from './source-files.ts';
const ok=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data};
const pick=(...names:string[])=>names.map(n=>Deno.env.get(n)?.trim()).find(Boolean)||'';
const xmlText=(s:string)=>s.replace(/<\/(?:w:p|a:p|row)>/g,'\n').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
export async function nativeText(bytes:Uint8Array):Promise<any>{
 if(bytes[0]===37&&bytes[1]===80){
  const pdf=await getDocumentProxy(bytes.slice());try{if(pdf.numPages>300)throw Error('DOCUMENT_TOO_LARGE_FOR_AUTOMATED_CONTENT_REVIEW');const pages=[];
  for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n),tc=await p.getTextContent();pages.push({page:n,text:tc.items.map((x:any)=>x.str||'').join(' ')});}
  return {kind:'pdf',text:pages.map(x=>x.text).join('\n\n'),pages:pdf.numPages,page_text:pages,ocr_needed:pages.some(x=>x.text.replace(/\s/g,'').length<40)};
  }finally{await pdf.destroy();}
 }
 if(bytes[0]===80&&bytes[1]===75){const z=unzipSync(bytes);let kind='',parts:string[]=[];
  if(z['word/document.xml']){kind='docx';parts=['word/document.xml'];}
  else if(z['ppt/presentation.xml']){kind='pptx';parts=Object.keys(z).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)?.[1])-Number(b.match(/slide(\d+)/)?.[1]));}
  else if(z['xl/workbook.xml']){kind='xlsx';parts=Object.keys(z).filter(n=>/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(n));}
  else throw Error('UNSUPPORTED_SOURCE_FORMAT: unknown Office ZIP package');
  return {kind,text:parts.map(n=>xmlText(strFromU8(z[n]))).join('\n\n'),pages:kind==='pptx'?parts.length:null,ocr_needed:false};
 }
 if((bytes[0]===137&&bytes[1]===80)||(bytes[0]===255&&bytes[1]===216))return {kind:bytes[0]===137?'png':'jpg',text:'',pages:1,ocr_needed:true};
 throw Error('UNSUPPORTED_SOURCE_FORMAT');
}
export async function inspectedText(db:any,d:any,bytes:Uint8Array):Promise<any>{
 const hash=await byteHash(bytes),company=d.company_id;
 const cached=ok(await db.from('agenttender_signing_file_cache').select('*').eq('company_id',company).eq('file_hash',hash).maybeSingle());
 if(cached?.parser_version==='FILE_READER_V4'&&cached.parsed)return cached.parsed;
 const native=await nativeText(bytes);
 let parsed=native;
 if(native.ocr_needed){
  let endpoint=pick('AZURE_DI_ENDPOINT','AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT','AZURE_FORM_RECOGNIZER_ENDPOINT','DOCUMENT_INTELLIGENCE_ENDPOINT','AZURE_OCR_ENDPOINT','AZURE_ENDPOINT').replace(/\/+$/,'');
  let secret=pick('AZURE_DI_KEY','AZURE_DOCUMENT_INTELLIGENCE_KEY','AZURE_FORM_RECOGNIZER_KEY','DOCUMENT_INTELLIGENCE_KEY','AZURE_OCR_KEY','AZURE_KEY','AZURE_DI_API_KEY');
  if(!/^https:\/\//.test(endpoint)&&/^https:\/\//.test(secret))[endpoint,secret]=[secret.replace(/\/+$/,''),endpoint];
  if(!/^https:\/\//.test(endpoint)||!secret)throw Error('SOURCE_CONTENT_OCR_REQUIRED: OCR provider unavailable');
  let operation=cached?.ocr_operation_url;
  if(!operation){
   const mime=native.kind==='pdf'?'application/pdf':native.kind==='png'?'image/png':'image/jpeg';
   const r=await fetch(endpoint+'/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30',{method:'POST',headers:{'Ocp-Apim-Subscription-Key':secret,'Content-Type':mime},body:bytes,signal:AbortSignal.timeout(30000)});
   if(r.status!==202)throw Error('OCR_SUBMIT_HTTP_'+r.status);
   operation=r.headers.get('operation-location');if(!operation||new URL(operation).origin!==new URL(endpoint).origin)throw Error('INVALID_OCR_OPERATION_URL');
   ok(await db.from('agenttender_signing_file_cache').upsert({company_id:company,file_hash:hash,ocr_operation_url:operation,ocr_started_at:new Date().toISOString(),updated_at:new Date().toISOString()}));
  }
  if(new URL(operation).origin!==new URL(endpoint).origin)throw Error('INVALID_OCR_OPERATION_ORIGIN');
  let result:any=null;
  for(let n=0;n<5;n++){
   const r=await fetch(operation,{headers:{'Ocp-Apim-Subscription-Key':secret},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('OCR_POLL_HTTP_'+r.status);const j=await r.json();
   if(j.status==='succeeded'){result=j.analyzeResult;break;}
   if(j.status==='failed')throw Error('OCR_FAILED: '+String(j.error?.code||'provider error'));
   await new Promise(resolve=>setTimeout(resolve,1200));
  }
  if(!result)throw Error('OCR_PENDING: saved operation will resume automatically');
  const pages=(result.pages||[]).map((p:any)=>({page:p.pageNumber,text:(p.lines||[]).map((l:any)=>l.content).join('\n')}));
  if(native.pages&&pages.length!==native.pages)throw Error('OCR_INCOMPLETE_PAGE_COVERAGE');
  if(!result.content||result.content.replace(/\s/g,'').length<20)throw Error('SOURCE_CONTENT_UNREADABLE_AFTER_OCR');
  parsed={...native,text:String(result.content),page_text:pages,ocr_needed:false,ocr_used:true,ocr_source_hash:hash};
 }
 ok(await db.from('agenttender_signing_file_cache').upsert({company_id:company,file_hash:hash,parser_version:'FILE_READER_V4',parsed,updated_at:new Date().toISOString()}));
 return parsed;
}


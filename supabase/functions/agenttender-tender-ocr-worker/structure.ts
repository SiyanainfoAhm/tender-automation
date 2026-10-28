
export const PARSER_VERSION = "structure-v3";
export function pdfLayout(items:any[]) {
 const lines:any[]=[]; let line:any=null;
 for(const x of items){if(typeof x.str!=="string"||!x.str.trim())continue;
  const y=Number(x.transform?.[5]||0),left=Number(x.transform?.[4]||0),height=Math.abs(Number(x.height||x.transform?.[3]||10));
  if(!line||Math.abs(y-line.y)>Math.max(2,height*.35)){line={y,height,cells:[]};lines.push(line);}
  line.cells.push({text:x.str,left,right:left+Number(x.width||0),height});
  if(x.hasEOL)line=null;
 }
 let previous:any=null;
 const text=lines.map(l=>{let right:number|null=null;let table=false;const cells=l.cells.map((c:any)=>{const gap=right===null?0:c.left-right;right=c.right;if(gap>Math.max(14,c.height*1.5)){table=true;return "\t"+c.text;}return (gap>1?" ":"")+c.text;});
 const blank=previous&&Math.abs(previous.y-l.y)>Math.max(previous.height,l.height)*1.65?"\n":"";previous=l;
 return blank+cells.join("").trim();}).join("\n");
 return {text,layout:"pdf-text-coordinates",table_detection:"heuristic",line_count:lines.length};
}
export function sectionFor(s:string):string{
 if(/\bEMD\b|earnest money|bid security/i.test(s))return "EMD";
 if(/eligib|qualif|experience|turnover|pre.?qualification/i.test(s))return "eligibility";
 if(/financial|payment|price|pricing|cost|bill of quantities|\bBOQ\b/i.test(s))return "financial";
 if(/scope|specification|deliverable|statement of work/i.test(s))return "scope";
 return "other";
}
export function structuredChunks(text:string,extraction:any={},error:string|null=null):any[]{
 const marks=[...text.matchAll(/(?:--- PAGE (\d+) ---|-- (\d+) of \d+ --)/g)];
 const pages=marks.length?marks.map((m,i)=>({n:Number(m[1]||m[2]),text:text.slice(m.index!+m[0].length,marks[i+1]?.index??text.length)})):[{n:null,text}];
 if(marks.length&&text.slice(0,marks[0].index).trim())pages.unshift({n:null as any,text:text.slice(0,marks[0].index)});
 const out:any[]=[],seen=new Map<string,any>();let heading="",section="other",clause:string|null=null;
 for(const p of pages){
  const lines=p.text.replace(/\r\n?/g,"\n").split("\n");let buffer="",tableHeader="",table=false,refs=new Set<string>(),oversize=false;
  const emit=(force=false)=>{let content=buffer.trim();if(!content)return;if(content.replace(/\s/g,"").length<=20){if(!force)return;content=`[Extracted document text; page ${p.n??"unknown"}]\n${content}`;}buffer="";
   const key=content.normalize("NFKC").replace(/\s+/g," ").trim();
   if(seen.has(key)){const old=seen.get(key);old.metadata.duplicate_page_references.push(p.n);refs.clear();return;}
   const piece={content,page_number:p.n,page_start:p.n,page_end:p.n,section,
    metadata:{parser:PARSER_VERSION,heading:heading||null,clause_references:[...refs],page_references:p.n===null?[]:[p.n],duplicate_page_references:[],
     table_header:tableHeader||null,oversize_row:oversize,extraction_quality:extraction,extraction_warning:error,legacy_structure:extraction.parser!==PARSER_VERSION}};
   seen.set(key,piece);out.push(piece);refs.clear();oversize=false;
  };
  for(let i=0;i<lines.length;i++){
   const s=lines[i].trimEnd(),t=s.trim();if(!t){if(buffer.length>2500)emit();else if(buffer)buffer+="\n";table=false;tableHeader="";continue;}
   const isTable=/\t|\|/.test(s);
   const cm=!isTable?t.match(/^(?:(?:clause|section)\s+)?(\d+(?:\.\d+)*[.)]?)\s+\S/i):null;
   const isHeading=!isTable&&t.length<180&&(/^(?:#{1,6}\s|(?:section|chapter|part|annexure|appendix)\s)/i.test(t)||(/^[A-Z\d\s:()&/.,-]+$/.test(t)&&/[A-Z]{3}/.test(t))||!!cm);
   if(isHeading){emit();heading=t;const detected=sectionFor(t);if(detected!=="other"||!cm)section=detected;clause=cm?.[1]||null;}
   if(isTable&&!table){emit();tableHeader=t;table=true;}
   if(!isTable&&table){emit();table=false;tableHeader="";}
   if(buffer.length+s.length+1>3500){const tail=!isTable?buffer.trim().split(/\n\s*\n/).at(-1)||"":"";emit();if(isTable&&tableHeader&&t!==tableHeader)buffer=tableHeader+"\n";else if(tail&&tail.length<=300&&tail.length+s.length+1<=3500)buffer=tail+"\n";}
   if(clause)refs.add(clause);
   if(s.length>3500&&!isTable){let rest=s;while(rest.length>3500){let cut=rest.lastIndexOf(" ",3500);if(cut<1)cut=3500;buffer+=rest.slice(0,cut);emit();rest=rest.slice(cut).trimStart();if(clause)refs.add(clause);}buffer+=rest+"\n";}
   else {oversize ||=s.length>3500;buffer+=s+"\n";}
  }emit(true);
 }
 return out;
}

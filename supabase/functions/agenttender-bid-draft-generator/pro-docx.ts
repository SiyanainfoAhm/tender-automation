// Professional DOCX renderer for bid documents.
// Section content conventions: lines containing " | " in consecutive runs become a table (first row = header);
// lines starting with "- " or "* " become bullets; "## " starts a sub-heading; everything else is a paragraph.
import {Document,Packer,Paragraph,TextRun,HeadingLevel,AlignmentType,Table,TableRow,TableCell,WidthType,BorderStyle,ShadingType,Footer,Header,PageNumber,LevelFormat} from "npm:docx@9.5.1";
const NAVY="1F3864",GREY="BFBFBF",FONT="Calibri";
const run=(t:string,o:any={})=>new TextRun({text:t,font:FONT,size:o.size||21,bold:o.bold,color:o.color,italics:o.italics});
function inline(text:string,o:any={}){const parts=String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);return parts.map(p=>p.startsWith("**")&&p.endsWith("**")?run(p.slice(2,-2),{...o,bold:true}):run(p,o));}
function table(rows:string[][]){
 const cols=Math.max(...rows.map(r=>r.length));const border={style:BorderStyle.SINGLE,size:4,color:GREY};
 const borders={top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border};
 return new Table({width:{size:100,type:WidthType.PERCENTAGE},borders,rows:rows.map((r,ri)=>new TableRow({tableHeader:ri===0,children:Array.from({length:cols},(_,ci)=>new TableCell({
  shading:ri===0?{type:ShadingType.CLEAR,color:"auto",fill:NAVY}:(ri%2===0?{type:ShadingType.CLEAR,color:"auto",fill:"F2F5FA"}:undefined),
  margins:{top:60,bottom:60,left:90,right:90},
  children:[new Paragraph({spacing:{before:0,after:0},children:inline(r[ci]??"",ri===0?{bold:true,color:"FFFFFF",size:19}:{size:19})})]}))}))});
}
export function renderBlocks(content:string){
 const out:any[]=[];const lines=String(content||"").split(/\r?\n/);let buf:string[][]=[];
 const flush=()=>{if(buf.length){out.push(table(buf));out.push(new Paragraph({spacing:{after:80},children:[]}));buf=[];}};
 for(const raw of lines){const l=raw.trim();
  if(l.includes(" | ")||/^\|.*\|$/.test(l)){const cells=l.replace(/^\||\|$/g,"").split("|").map(x=>x.trim());if(cells.every(c=>/^:?-{2,}:?$/.test(c)))continue;buf.push(cells);continue;}
  flush();if(!l){continue;}
  if(/^##\s+/.test(l)){out.push(new Paragraph({spacing:{before:160,after:60},children:[run(l.replace(/^##\s+/,""),{bold:true,color:NAVY,size:22})]}));continue;}
  if(/^[-*•]\s+/.test(l)){out.push(new Paragraph({numbering:{reference:"bul",level:0},spacing:{after:40},children:inline(l.replace(/^[-*•]\s+/,""))}));continue;}
  out.push(new Paragraph({spacing:{after:100},alignment:AlignmentType.JUSTIFIED,children:inline(l)}));
 }
 flush();return out;
}
export async function proDocx(title:string,sections:any[],profile:any,subtitle?:string){
 const company=profile.legal_name||"Siyana Info Solutions Private Limited";
 const children:any[]=[
  new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:120,after:60},children:[run(title,{bold:true,size:32,color:NAVY})]}),
 ];
 if(subtitle)children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:240},children:[run(subtitle,{italics:true,size:20,color:"404040"})]}));
 sections.forEach((s:any,n:number)=>{
  children.push(new Paragraph({spacing:{before:240,after:100},border:{bottom:{style:BorderStyle.SINGLE,size:6,color:NAVY,space:2}},children:[run(profile.preserve_rfp_format?String(s.heading||""):`${n+1}. ${String(s.heading||"")}`,{bold:true,size:25,color:NAVY})]}));
  children.push(...renderBlocks(String(s.content||"")));
 });
 const header=new Header({children:[
  new Paragraph({spacing:{after:0},children:[run(company,{bold:true,size:24,color:NAVY})]}),
  new Paragraph({spacing:{after:0},children:[run(profile.registered_office||"",{size:16,color:"595959"})]}),
  new Paragraph({spacing:{after:120},border:{bottom:{style:BorderStyle.SINGLE,size:8,color:NAVY,space:4}},children:[run(["CIN: "+(profile.cin||""),"GSTIN: "+(profile.gstin||""),"PAN: "+(profile.pan||"")].join("   |   "),{size:16,color:"595959"})]})]});
 const footer=new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,border:{top:{style:BorderStyle.SINGLE,size:4,color:GREY,space:4}},children:[run(company+"  |  "+title+"  |  Page ",{size:16,color:"7F7F7F"}),new TextRun({children:[PageNumber.CURRENT],font:FONT,size:16,color:"7F7F7F"}),run(" of ",{size:16,color:"7F7F7F"}),new TextRun({children:[PageNumber.TOTAL_PAGES],font:FONT,size:16,color:"7F7F7F"})]})]});
 const doc=new Document({
  styles:{default:{document:{run:{font:FONT,size:21}}}},
  numbering:{config:[{reference:"bul",levels:[{level:0,format:LevelFormat.BULLET,text:"•",alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:540,hanging:270}}}}]}]},
  sections:[{properties:{page:{margin:{top:1300,bottom:1100,left:1080,right:1080,header:500,footer:500}}},headers:{default:header},footers:{default:footer},children}]});
 return new Uint8Array(await Packer.toBuffer(doc));
}


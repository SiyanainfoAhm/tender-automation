import pptxgen from 'npm:pptxgenjs@3.12.0';
export async function makePresentation(title:string,sections:any[],profile:any){
 const deck=new pptxgen();deck.layout='LAYOUT_WIDE';deck.author=profile.legal_name||'';deck.subject=title;deck.title=title;deck.company=profile.legal_name||'';deck.lang='en-IN';
 deck.theme={headFontFace:'Arial',bodyFontFace:'Arial',lang:'en-IN'};
 const pages:any[]=[];
 for(const s of sections){const words=String(s.content||'').split(/\s+/);let buf='';for(const word of words){if((buf+' '+word).length>800){pages.push({heading:String(s.heading||title),content:buf});buf='';}buf+=(buf?' ':'')+word;}if(buf)pages.push({heading:String(s.heading||title),content:buf});}
 for(let n=0;n<pages.length;n++){const p=pages[n],slide=deck.addSlide();slide.background={color:'FFFFFF'};
  slide.addText(p.heading,{x:0.65,y:0.45,w:12,h:0.8,fontSize:25,bold:true,color:'17263C',margin:0,breakLine:false,fit:'shrink'});
  slide.addText(p.content,{x:0.65,y:1.6,w:12,h:4.7,fontSize:21,color:'222222',margin:0,breakLine:false,fit:'shrink',valign:'top'});
  slide.addText(String(profile.legal_name||'')+' | '+(n+1)+' / '+pages.length,{x:0.65,y:6.8,w:12,h:0.3,fontSize:10,color:'555555',margin:0});
 }
 if(!pages.length)throw Error('EMPTY_PRESENTATION');return new Uint8Array(await deck.write({outputType:'arraybuffer'}) as ArrayBuffer);
}


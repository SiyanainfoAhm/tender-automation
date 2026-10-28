
export const readable=s=>String(s||"").replace(/\s/g,"").length>40&&(String(s||"").match(/�/g)||[]).length/Math.max(String(s||"").length,1)<0.03;
// Azure already OCR'd these pages (and was paid); re-running won't change drawings, photos or blank pages.
// Keep whatever text came back and mark low-text pages visibly so the evaluator knows they were not readable.
export function mergeOcrPages(native,output,pages){
 const requested=new Set(pages);
 const returned=new Map((output.pages||[]).map(p=>[p.pageNumber,(p.lines||[]).map(l=>l.content||"").join("\n")]));
 return native.map(p=>{
  if(!requested.has(p.page))return p;
  const got=String(returned.get(p.page)||"").trim();
  return {...p,text:readable(got)?got:(got?got+"\n":"")+"[OCR: page "+p.page+" has little or no readable text (drawing, photo, stamp or blank page). Its content has NOT been reviewed.]"};
 });
}
export function ocrBudget(value){const n=Number(value);return Math.min(100,Math.max(1,Number.isFinite(n)&&n>0?Math.floor(n):5));}

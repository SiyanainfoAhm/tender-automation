/** Download and store BidAssist AOC files using the Tender247 SharePoint path. */
import path from "node:path";
import fs from "node:fs";
import type { Page } from "playwright";
import { extractZipArchive, listFilesRecursive } from "../chatgptQualification/extractZip.js";
import { ensureDir } from "../fileUtils.js";
import type { Logger } from "../logger.js";
import { getTodayIsoDate } from "../dateUtils.js";
import { isSafeZipEntryName, sanitizeWindowsFileName } from "./bidassistDownload.js";
import type { BidassistConfig } from "./bidassistConfig.js";
import type { ResultDocument } from "./bidassistResultStore.js";

const SAFE_FILE = /\.(pdf|html?|docx?|xlsx?|xls|csv|txt|zip|png|jpe?g)$/i;
function mimeType(fileName:string){const ext=path.extname(fileName).toLowerCase();return ext===".pdf"?"application/pdf":ext===".html"||ext===".htm"?"text/html":ext===".zip"?"application/zip":"application/octet-stream";}

type FileSnapshot = Map<string, { size: number; mtimeMs: number }>;

function snapshotDownloadDirectory(dir: string): FileSnapshot {
 const snapshot: FileSnapshot = new Map();
 if (!fs.existsSync(dir)) return snapshot;
 for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const file = path.join(dir, entry.name);
  const stat = fs.statSync(file);
  snapshot.set(file, { size: stat.size, mtimeMs: stat.mtimeMs });
 }
 return snapshot;
}

/** A browser crash can invalidate Playwright's Download object after Chrome has
 * already finished writing the file. Recover only a new, stable, non-partial
 * file from this tender's private staging directory. */
async function recoverCompletedStagedDownload(dir: string, before: FileSnapshot): Promise<string | null> {
 for (let pass = 0; pass < 2; pass += 1) {
  const candidates = Array.from(snapshotDownloadDirectory(dir).entries())
   .filter(([file, stat]) => {
    const old = before.get(file);
    return !/\.crdownload$/i.test(file) && stat.size > 0 &&
      (!old || old.size !== stat.size || old.mtimeMs !== stat.mtimeMs);
   })
   .sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
  if (candidates.length) {
   const [file, initial] = candidates[0]!;
   await new Promise<void>((resolve) => setTimeout(resolve, 750));
   const settled = fs.statSync(file, { throwIfNoEntry: false });
   if (settled && settled.isFile() && settled.size === initial.size && settled.size > 0) return file;
  }
 }
 return null;
}

/** CLI counterpart of Tender Details' create-direct-upload → Graph PUT →
 * complete-direct-upload flow. The artifact endpoint rejects these non-archive
 * source files (403); this uses the established TenderDocs upload protocol. */
async function uploadTenderDocumentFile(options:{tenderId:string;awardId:string;filePath:string;fileName:string}){
 const base=process.env.SUPABASE_URL?.replace(/\/$/,"");const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)return{ok:false,storageUrl:null,error:"Document storage is not configured"};
 const companyId=process.env.COMPANY_ID||process.env.SIYANA_COMPANY_ID||"a1b2c3d4-e5f6-7890-abcd-ef1234567890";const bytes=fs.readFileSync(options.filePath);const common={Authorization:`Bearer ${key}`,apikey:key,"x-agenttender-internal-company":companyId};
 const create=await fetch(`${base}/functions/v1/tender-automation-company-documents`,{method:"POST",headers:{...common,"Content-Type":"application/json"},body:JSON.stringify({action:"create-direct-upload",tenderId:options.tenderId,section:"tender",fileName:options.fileName,originalFileName:options.fileName,documentName:options.fileName,mimeType:mimeType(options.fileName),fileSizeBytes:bytes.length,tenderArtifactPortal:"BIDASSIST",tenderArtifactId:options.awardId,tenderArtifactDate:getTodayIsoDate()})});
 const created=await create.json().catch(()=>({})) as {success?:boolean;error?:string;documentId?:string;uploadUrl?:string;blobPath?:string;blobName?:string;duplicate?:boolean;storageUrl?:string};if(!create.ok||!created.success||!created.documentId)return{ok:false,storageUrl:null,error:created.error||`create HTTP ${create.status}`};
 if(!created.duplicate){if(!created.uploadUrl)return{ok:false,storageUrl:null,error:"SharePoint upload session missing"};const put=await fetch(created.uploadUrl,{method:"PUT",headers:{"Content-Range":`bytes 0-${Math.max(0,bytes.length-1)}/${bytes.length}`},body:bytes});if(![200,201,202].includes(put.status))return{ok:false,storageUrl:null,error:`SharePoint PUT HTTP ${put.status}`};}
 const complete=await fetch(`${base}/functions/v1/tender-automation-company-documents`,{method:"POST",headers:{...common,"Content-Type":"application/json"},body:JSON.stringify({action:"complete-direct-upload",tenderId:options.tenderId,section:"tender",documentId:created.documentId,blobPath:created.blobPath||created.blobName||"",fileName:options.fileName,originalFileName:options.fileName,mimeType:mimeType(options.fileName),fileSizeBytes:bytes.length})});const done=await complete.json().catch(()=>({})) as {success?:boolean;error?:string;storageUrl?:string};return done.success?{ok:true,storageUrl:done.storageUrl||created.storageUrl||null,error:null}:{ok:false,storageUrl:null,error:done.error||`complete HTTP ${complete.status}`};
}

export async function downloadAndStoreBidassistAoc(options:{
 page:Page; tenderId:string; awardId:string; detailUrl:string; config:BidassistConfig; logger:Logger; documents:ResultDocument[]; downloadStagingDir:string;
}):Promise<ResultDocument[]>{
 const {page,tenderId,awardId,detailUrl,config,logger,downloadStagingDir}=options;
 const control=page.getByRole("button",{name:/download all/i}).or(page.getByRole("link",{name:/download all/i})).or(page.getByText(/download all/i)).last();
 if(!await control.isVisible().catch(()=>false)) return options.documents.map(d=>({...d,sourceUrl:d.sourceUrl===detailUrl?null:d.sourceUrl,downloadStatus:"SOURCE_RESTRICTED"}));
 logger.info(`[BidAssist] Download All control: ${await control.evaluate((el)=>JSON.stringify({tag:el.tagName,href:el.getAttribute("href"),onclick:el.getAttribute("onclick"),html:el.outerHTML.slice(0,600)})).catch(()=>"unavailable")}`);
 const root=path.resolve(config.downloadRoot,getTodayIsoDate(),"BidAssist","results",tenderId);
 // Each result refresh is a complete AOC snapshot. Keeping the previous ZIP
 // or extracted directory made old files appear in the next upload.
 const resultsRoot=path.resolve(config.downloadRoot,getTodayIsoDate(),"BidAssist","results");
 const relativeRoot=path.relative(resultsRoot,root);
 if(!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)){
   throw new Error(`Unsafe AOC download directory: ${root}`);
 }
 if(fs.existsSync(root)) fs.rmSync(root,{recursive:true,force:true});
 ensureDir(root);
 // Playwright event promises alone do not keep Node's event loop alive. Keep
 // the CLI process alive through saveAs so its outer finally cannot close the
 // persistent context between the browser download event and disk persistence.
 const keepAlive=setInterval(()=>undefined,1000);
 let zipName:string;
 let zipPath:string;
 try {
   const stagingBefore=snapshotDownloadDirectory(downloadStagingDir);
   const event=page.waitForEvent("download",{timeout:config.downloadTimeoutMs}).catch(()=>null);
   await control.click({timeout:15000});
   const download=await event;
   if(!download) return options.documents.map(d=>({...d,sourceUrl:d.sourceUrl===detailUrl?null:d.sourceUrl,downloadStatus:"DOWNLOAD_FAILED"}));
   zipName=sanitizeWindowsFileName(download.suggestedFilename()||`${awardId}.zip`);
   zipPath=path.join(root,zipName);
   try { await download.saveAs(zipPath); } catch (error) {
     // With the persistent downloadsPath above, a completed download can still
     // be recovered even when BidAssist closes/navigates its triggering page.
     const capturedPath=await download.path().catch(()=>null);
     const recoveredPath=capturedPath&&fs.existsSync(capturedPath)
      ? capturedPath
      : await recoverCompletedStagedDownload(downloadStagingDir,stagingBefore);
     if(!recoveredPath) throw error;
     fs.copyFileSync(recoveredPath,zipPath);
     logger.warn(`[BidAssist] recovered completed download after Playwright disconnect: ${path.basename(recoveredPath)}`);
   }
 } finally {
   // Never leave a timer alive when Playwright reports a closed browser or a
   // failed download. A leaked timer otherwise keeps a failed agent running.
   clearInterval(keepAlive);
 }
 logger.info(`[BidAssist] AOC download captured: ${zipName!}`);
 const files:string[]=[];
 if(/\.zip$/i.test(zipName!)){
   const extracted=path.join(root,"extracted");ensureDir(extracted);await extractZipArchive(zipPath,extracted);
   for(const file of listFilesRecursive(extracted)){const rel=path.relative(extracted,file);if(isSafeZipEntryName(rel)&&SAFE_FILE.test(file))files.push(file);}
 }else if(SAFE_FILE.test(zipPath!)) files.push(zipPath!);
 logger.info(`[BidAssist] AOC extracted files: ${files.length}`);
 const stored:ResultDocument[]=[];
 for(const file of files){const fileName=path.basename(file);const upload=await uploadTenderDocumentFile({tenderId,awardId,filePath:file,fileName});stored.push({name:fileName,fileName,type:path.extname(fileName).slice(1).toUpperCase()||null,mimeType:mimeType(fileName),sourceUrl:null,storageUrl:upload.storageUrl,downloadStatus:upload.ok?"DOWNLOADED":"DOWNLOAD_FAILED",raw:{sourcePageUrl:detailUrl,sourceZip:zipName!,localFile:fileName,uploadError:upload.error}});logger.info(`[BidAssist] SharePoint upload ${upload.ok?"success":"failed"}: ${fileName}`);}
 return stored.length?stored:options.documents.map(d=>({...d,sourceUrl:d.sourceUrl===detailUrl?null:d.sourceUrl,downloadStatus:"DOWNLOAD_FAILED"}));
}

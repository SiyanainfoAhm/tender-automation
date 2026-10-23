const test=require("node:test");
const assert=require("node:assert/strict");
const {manifestEntry,normalizeManifest}=require("./manifest");
const {createGateway,sanitizedMessage,UpstreamLimiter,expectedSourceSize,parsedContentRange}=require("./server");
const {StageStore}=require("./staging");
const {Readable}=require("node:stream");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");

const env={GATEWAY_SECRET:"gateway-test-secret",TENDER247_TOKEN:"upstream-test-token",TENDER247_BASE_URL:"https://partnersdataapi.tender247.com/T247Data/api",TENDER247_UPSTREAM_CONTRACT_STATUS:"COMPATIBILITY_UNVERIFIED"};
const stageIdentity="a".repeat(64);
async function gatewayRequest(axiosClient,{headers={},route="/api/tender247/document-links/abcdefgh",stageStore,upstreamLimiter,method="GET"}={}){
 const server=createGateway({axiosClient,env,stageStore,upstreamLimiter}).listen(0,"127.0.0.1");
 await new Promise(resolve=>server.once("listening",resolve));
 try{return await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method,headers:{authorization:"Bearer gateway-test-secret",...headers}});}
 finally{await new Promise(resolve=>server.close(resolve));}
}

test("normalizes PascalCase and lowercase Tender247 manifest arrays",()=>{
 const row={documentid:111,filename:"Tender.pdf",contentType:"application/pdf",size:10,link:"https://partnersdataapi.tender247.com/T247Data/api/partner-single-document-download/abcdefgh"};
 assert.equal(normalizeManifest({Data:[row]}).length,1);
 assert.equal(normalizeManifest({data:[row]}).length,1);
 assert.deepEqual(normalizeManifest({Data:[]}),[]);
});
test("keeps the observed unfiltered feed available and rejects invented query parameters",async()=>{
 let calls=0;
 const axiosClient={get:async(url,options)=>{calls+=1;assert.equal(url,"https://partnersdataapi.tender247.com/T247Data/api/tender-data");assert.equal(options.params,undefined);return {status:200,data:{Data:[]}};}};
 const available=await gatewayRequest(axiosClient,{route:"/api/tender247/tenders"});
 assert.equal(available.status,200);assert.deepEqual(await available.json(),{Data:[]});
 const rejected=await gatewayRequest(axiosClient,{route:"/api/tender247/tenders?scrapedDate=2026-10-10"});
 assert.equal(rejected.status,400);assert.deepEqual(await rejected.json(),{error:"Tender247 tender feed does not accept query parameters."});assert.equal(calls,1);
});
test("does not silently treat legacy UNVERIFIED as compatibility mode",async()=>{
 const prior=env.TENDER247_UPSTREAM_CONTRACT_STATUS;env.TENDER247_UPSTREAM_CONTRACT_STATUS="UNVERIFIED";
 try { const response=await gatewayRequest({get:async()=>{throw new Error("must not call upstream");}},{route:"/api/tender247/tenders"});assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:"Tender247 synchronization requires explicit COMPATIBILITY_UNVERIFIED or VERIFIED mode."}); }
 finally { env.TENDER247_UPSTREAM_CONTRACT_STATUS=prior; }
});
test("normalizes Tender247 document aliases into the public worker contract",()=>{
 const [entry]=normalizeManifest({Data:[{id:111,name:"Tender.pdf",content_type:"application/pdf",downloadLink:"https://partnersdataapi.tender247.com/T247Data/api/partner-single-document-download/DOC_TOKEN_1",fileSize:10}]});
 assert.deepEqual(entry,{documentid:"111",filename:"Tender.pdf",contentType:"application/pdf",size:10,token:"DOC_TOKEN_1"});
});

test("normalizes the real document-links contract with stable token document IDs and unknown sizes",()=>{
 const entries=normalizeManifest({status:"success",count:2,data:[
  {filename:"EOI Dt 23 09 2026.pdf",contentType:"application/pdf",link:"https://partnersdataapi.tender247.com/T247Data/api/partner-single-document-download/TOKEN_AA"},
  {filename:"APEPDCL Tender Document.pdf",contentType:"application/pdf",link:"https://partnersdataapi.tender247.com/T247Data/api/partner-single-document-download/TOKEN_BB"},
 ]});
 assert.deepEqual(entries.map(({documentid,filename,contentType,token,size})=>({documentid,filename,contentType,token,size})),[
  {documentid:"TOKEN_AA",filename:"EOI Dt 23 09 2026.pdf",contentType:"application/pdf",token:"TOKEN_AA",size:null},
  {documentid:"TOKEN_BB",filename:"APEPDCL Tender Document.pdf",contentType:"application/pdf",token:"TOKEN_BB",size:null},
 ]);
});

test("rejects unsafe document download links",()=>{
 for(const link of ["http://partnersdataapi.tender247.com/T247Data/api/partner-single-document-download/abcdefgh","https://invalid.example/T247Data/api/partner-single-document-download/abcdefgh","https://partnersdataapi.tender247.com/T247Data/api/partner-document-download-links/abcdefgh","https://partnersdataapi.tender247.com/T247Data/api/partner-single-document-download/?x=1","https://partnersdataapi.tender247.com/T247Data/api/partner-single-document-download/abcdefgh?x=1","https://partnersdataapi.tender247.com/T247Data/api/partner-single-document-download/abcdefgh#x"]) assert.equal(manifestEntry({filename:"a.pdf",link}),null);
});
test("rejects malformed non-empty manifests",()=>{
 assert.throws(()=>normalizeManifest({Data:{documentid:111}}),/Data array/);
 assert.throws(()=>normalizeManifest({Data:[{documentid:111}]}),/no valid documents/);
});

test("sanitizes bearer values, URLs, and document tokens before logging",()=>{
 assert.equal(sanitizedMessage("Token abcdefgh failed at https://example.test/abcdefgh with Bearer secret-value"),"Token [REDACTED] failed at [URL_REDACTED] with Bearer [REDACTED]");
});
test("rejects malformed or inconsistent source size headers",()=>{
 assert.equal(parsedContentRange("bytes 5-4/6"),null);
 assert.equal(parsedContentRange("bytes 0-4/4"),null);
 assert.equal(expectedSourceSize({"content-range":"bytes 0-4/6","content-length":"4"},206,0),null);
 assert.equal(expectedSourceSize({"content-length":"6"},200,0,7),null);
 assert.equal(expectedSourceSize({"content-range":"bytes 0-5/6","content-length":"6"},206,0),6);
});

test("returns 200 for a PascalCase successful manifest and uses the expected upstream route",async()=>{
 const axiosClient={get:async(url,options)=>{assert.equal(url,"https://partnersdataapi.tender247.com/T247Data/api/partner-document-download-links/abcdefgh");assert.equal(options.headers.Authorization,"Bearer upstream-test-token");return {status:200,data:{Success:true,StatusCode:200,Message:"Success",Data:[{documentid:1,filename:"a.pdf",token:"abcdefgh",size:1}]}};}};
 const response=await gatewayRequest(axiosClient);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:"success",count:1,data:[{documentid:"1",filename:"a.pdf",contentType:"application/octet-stream",size:1,token:"abcdefgh"}]});
});

test("returns 200 for a lowercase successful manifest",async()=>{
 const response=await gatewayRequest({get:async()=>({status:200,data:{success:true,statusCode:200,message:"ok",data:[{documentId:"1",fileName:"a.pdf",downloadToken:"abcdefgh",fileSize:1}]}})});
 assert.equal(response.status,200);assert.equal((await response.json()).count,1);
});

test("accepts the real lowercase status success manifest without a Success boolean",async()=>{
 const response=await gatewayRequest({get:async()=>({status:200,data:{status:"success",count:2,data:[{filename:"a.pdf",contentType:"application/pdf",link:"https://partnersdataapi.tender247.com/T247Data/api/partner-single-document-download/TOKEN_AA"},{filename:"b.pdf",contentType:"application/pdf",link:"https://partnersdataapi.tender247.com/T247Data/api/partner-single-document-download/TOKEN_BB"}]}})});
 const body=await response.json();assert.equal(response.status,200);assert.equal(body.status,"success");assert.equal(body.count,2);assert.equal(body.data.length,2);assert.equal(body.data[0].size,null);
});

test("rejects HTTP 200 upstream logical failures and logs safe structured diagnostics",async()=>{
 const logs=[];const original=console.error;console.error=(...args)=>logs.push(args);
 try{const response=await gatewayRequest({get:async()=>({status:200,data:{Success:false,StatusCode:400,Message:"Token expired",Data:[]}})});assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:"Tender247 logical failure",message:"Token expired"});assert.equal(logs[0][0],"[tender247-gateway] Tender247 logical failure");assert.deepEqual(logs[0][1],{upstreamStatus:200,logicalSuccess:false,logicalStatus:400,message:"Token expired",hasData:true,sourceCount:0,normalizedCount:0,errorCode:null,errorMessage:null});}
 finally{console.error=original;}
});

test("rejects lowercase status failed manifests",async()=>{
 const logs=[];const original=console.error;console.error=(...args)=>logs.push(args);
 try{const response=await gatewayRequest({get:async()=>({status:200,data:{status:"failed",count:0,data:[]}})});assert.equal(response.status,502);assert.equal((await response.json()).error,"Tender247 logical failure");assert.equal(logs[0][1].logicalSuccess,null);}
 finally{console.error=original;}
});

test("returns sanitized diagnostics for upstream 401, 403, and 500 failures",async()=>{
 const logs=[];const original=console.error;console.error=(...args)=>logs.push(args);
 try{for(const status of [401,403,500]){const error=Object.assign(new Error("upstream exploded"),{response:{status,data:{Success:false,StatusCode:status,Message:"Service unavailable"}}});const response=await gatewayRequest({get:async()=>{throw error;}});assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:"Tender247 request failed",upstreamStatus:status,logicalSuccess:false,logicalStatus:status,message:"Service unavailable",classification:status===500?"UPSTREAM_5XX":"UPSTREAM_REQUEST_FAILED",retryAfterMs:null});}assert.equal(logs.length,3);assert.equal(logs[2][1].upstreamStatus,500);}
 finally{console.error=original;}
});

test("returns 502 with safe timeout diagnostics when Axios has no response",async()=>{
 const logs=[];const original=console.error;console.error=(...args)=>logs.push(args);
 try{const error=Object.assign(new Error("timeout for Token abcdefgh at https://upstream.example/abcdefgh Bearer upstream-test-token"),{code:"ECONNRESET"});const response=await gatewayRequest({get:async()=>{throw error;}});assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:"Tender247 request failed",upstreamStatus:null,logicalSuccess:null,logicalStatus:null,message:null,classification:"ECONNRESET",retryAfterMs:null});assert.equal(logs[0][1].errorCode,"ECONNRESET");assert.match(logs[0][1].errorMessage,/\[REDACTED\]/);assert.doesNotMatch(JSON.stringify(logs),/upstream-test-token|gateway-test-secret|abcdefgh|upstream\.example/);}
 finally{console.error=original;}
});

test("retries transient upstream resets before returning a gateway result",async()=>{
 let calls=0;
 const response=await gatewayRequest({get:async()=>{calls++;if(calls<3)throw Object.assign(new Error("reset"),{code:"ECONNRESET"});return {status:200,data:{Success:true,Data:[]}};}});
 assert.equal(response.status,200);assert.equal(calls,3);
});

test("does not let calls queued before an opened circuit bypass the breaker",async()=>{
 const limiter=new UpstreamLimiter({concurrency:1,minIntervalMs:0,queueLimit:5,circuitFailures:1,circuitCooldownMs:1000});
 let queuedStarted=false;
 const reset=Object.assign(new Error("reset"),{code:"ECONNRESET"});
 const first=limiter.run(async()=>{throw reset;});
 const queued=limiter.run(async()=>{queuedStarted=true;return "must not run";});
 await assert.rejects(first,/reset/);
 await assert.rejects(queued,/UPSTREAM_CIRCUIT_OPEN/);
 assert.equal(queuedStarted,false);
});

test("honors upstream Retry-After and keeps many gateway calls below the shared concurrency",async()=>{
 let active=0,maxActive=0,calls=0;
 const limiter=new UpstreamLimiter({concurrency:2,minIntervalMs:0,queueLimit:20,circuitFailures:99});
 const axiosClient={get:async()=>{const call=++calls;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,5));active--;if(call<=2)throw Object.assign(new Error("limited"),{response:{status:429,headers:{"retry-after":"0"},data:{Message:"slow down"}}});return {status:200,data:{Success:true,Data:[]}};}};
 const responses=await Promise.all(Array.from({length:8},()=>gatewayRequest(axiosClient,{upstreamLimiter:limiter})));
 assert.equal(maxActive,2);assert.ok(calls>=10);assert.ok(responses.every(response=>response.status===200));
});

test("reports an explicit normalization failure when Data is missing",async()=>{
 const logs=[];const original=console.error;console.error=(...args)=>logs.push(args);
 try{const response=await gatewayRequest({get:async()=>({status:200,data:{Success:true,StatusCode:200,Message:"Success"}})});assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:"Tender247 manifest normalization failed"});assert.equal(logs[0][0],"[tender247-gateway] manifest normalization failed");assert.equal(logs[0][1].hasData,false);assert.equal(logs[0][1].sourceCount,0);}
 finally{console.error=original;}
});

test("reports an explicit normalization failure when Data exists but contains no usable entries",async()=>{
 const logs=[];const original=console.error;console.error=(...args)=>logs.push(args);
 try{const response=await gatewayRequest({get:async()=>({status:200,data:{Success:true,StatusCode:200,Data:[{documentid:1}]}})});assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:"Tender247 manifest normalization failed"});assert.equal(logs[0][0],"[tender247-gateway] manifest normalization failed");assert.equal(logs[0][1].sourceCount,1);assert.equal(logs[0][1].normalizedCount,0);}
 finally{console.error=original;}
});

test("returns the unchanged public contract for a valid empty manifest",async()=>{
 const response=await gatewayRequest({get:async()=>({status:200,data:{Success:true,StatusCode:200,Data:[]}})});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:"success",count:0,data:[]});
});

test("accepts an empty documented manifest when Tender247 omits optional logical status fields",async()=>{
 const response=await gatewayRequest({get:async()=>({status:200,data:{Data:[]}})});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:"success",count:0,data:[]});
});

test("does not accept status-unspecified arbitrary objects or invalid document arrays",async()=>{
 const missing=await gatewayRequest({get:async()=>({status:200,data:{Data:{unrelated:true}}})});
 assert.equal(missing.status,502);assert.deepEqual(await missing.json(),{error:"Tender247 manifest normalization failed"});
 const invalid=await gatewayRequest({get:async()=>({status:200,data:{data:[{unrelated:true}]}})});
 assert.equal(invalid.status,502);assert.deepEqual(await invalid.json(),{error:"Tender247 manifest normalization failed"});
});

test("rejects an explicit numeric logical failure even when Data is present",async()=>{
 const response=await gatewayRequest({get:async()=>({status:200,data:{StatusCode:429,Data:[]}})});
 assert.equal(response.status,502);assert.equal((await response.json()).error,"Tender247 logical failure");
});

test("accepts one nginx X-Forwarded-For hop without rate-limit validation errors",async()=>{
 const logs=[];const original=console.error;console.error=(...args)=>logs.push(args);
 try{const response=await gatewayRequest({get:async()=>({status:200,data:{Success:true,StatusCode:200,Data:[]}})},{headers:{"x-forwarded-for":"203.0.113.7"}});assert.equal(response.status,200);assert.doesNotMatch(JSON.stringify(logs),/ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/);}
 finally{console.error=original;}
});

test("stages a chunked upstream stream, persists bound metadata, serves ranges, and cleans it after success",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-test-"));const store=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});
 try{const axiosClient={get:async()=>({status:200,data:Readable.from([Buffer.from("abcdef")]),headers:{"content-type":"application/octet-stream","content-disposition":"attachment; filename=doc.bin","content-length":"6"}})};const info=await gatewayRequest(axiosClient,{route:"/api/tender247/document-info/abcdefgh",headers:{"x-tender247-stage-identity":stageIdentity},stageStore:store});const body=await info.json();assert.equal(body.size,6);assert.equal(body.integrityVerification,"PROVIDER_VERIFIED");assert.ok(body.expiresAt);const restarted=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});const found=await restarted.get(body.stagedId,stageIdentity);assert.equal(found?.size,6);const stageInfo=await gatewayRequest(axiosClient,{route:`/api/tender247/staged-document/${body.stagedId}/info`,headers:{"x-tender247-stage-identity":stageIdentity},stageStore:restarted});assert.equal(stageInfo.status,200);const ranged=await gatewayRequest(axiosClient,{route:`/api/tender247/staged-document/${body.stagedId}`,headers:{range:"bytes=0-2","x-tender247-stage-identity":stageIdentity},stageStore:restarted});assert.equal(ranged.status,206);assert.equal(ranged.headers.get("content-range"),"bytes 0-2/6");assert.equal(await ranged.text(),"abc");const denied=await gatewayRequest(axiosClient,{route:`/api/tender247/staged-document/${body.stagedId}`,headers:{"x-tender247-stage-identity":"b".repeat(64)},stageStore:restarted});assert.equal(denied.status,404);const removed=await gatewayRequest(axiosClient,{route:`/api/tender247/staged-document/${body.stagedId}`,headers:{"x-tender247-stage-identity":stageIdentity},stageStore:restarted,method:"DELETE"});assert.equal(removed.status,204);assert.equal(await restarted.get(body.stagedId,stageIdentity),null);}
 finally{await fs.rm(directory,{recursive:true,force:true});}
});

test("accepts a clean chunked unknown file as transport-verified, not provider-verified",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-unknown-size-"));const store=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});
 try { const response=await gatewayRequest({get:async()=>({status:200,data:Readable.from([Buffer.from("abc")]),headers:{"transfer-encoding":"chunked"}})},{route:"/api/tender247/document-info/abcdefgh",headers:{"x-tender247-stage-identity":stageIdentity},stageStore:store});const body=await response.json();assert.equal(response.status,200);assert.equal(body.size,3);assert.equal(body.integrityVerification,"TRANSPORT_VERIFIED");assert.ok(body.sha256); }
 finally { await fs.rm(directory,{recursive:true,force:true}); }
});

test("retries an empty stage from zero and succeeds with the next valid PDF",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-empty-retry-"));const store=new StageStore({directory,maxBytes:1000,quotaBytes:1000,ttlMs:1000});const pdf=Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");let calls=0;
 try { const response=await gatewayRequest({get:async()=>{calls++;return {status:200,data:Readable.from([calls===1?Buffer.alloc(0):pdf]),headers:{"content-type":"application/pdf","content-length":String(calls===1?0:pdf.length)}};}},{route:"/api/tender247/document-info/abcdefgh",headers:{"x-tender247-stage-identity":stageIdentity},stageStore:store});const body=await response.json();assert.equal(response.status,200);assert.equal(calls,2);assert.equal(body.size,pdf.length);assert.equal((await store.get(body.stagedId,stageIdentity)).sourceDownloadComplete,true); }
 finally { await fs.rm(directory,{recursive:true,force:true}); }
});

test("bounds empty-stage retries, discards every zero-byte stage, and returns safe diagnostics",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-empty-bounded-"));const store=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});let calls=0;
 try { const response=await gatewayRequest({get:async()=>{calls++;return {status:200,data:Readable.from([]),headers:{"content-type":"application/pdf","content-length":"0"}};}},{route:"/api/tender247/document-info/abcdefgh",headers:{"x-tender247-stage-identity":stageIdentity},stageStore:store});const body=await response.json();assert.equal(response.status,502);assert.equal(calls,3);assert.equal(body.classification,"DOCUMENT_STAGE_EMPTY");assert.equal(body.operationStage,"stage_integrity_validation");assert.equal(body.downloadDiagnostics.attempt,3);assert.equal(body.downloadDiagnostics.bytesReceived,0);assert.equal(body.downloadDiagnostics.zeroByteStageDiscarded,true);assert.equal(await store.find(stageIdentity),null); }
 finally { await fs.rm(directory,{recursive:true,force:true}); }
});

test("accepts chunked EOF only when Tender247 supplies a matching SHA-256 Digest",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-digest-"));const store=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});
 try { const response=await gatewayRequest({get:async()=>({status:200,data:Readable.from([Buffer.from("abc")]),headers:{digest:"sha-256=ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0="}})},{route:"/api/tender247/document-info/abcdefgh",headers:{"x-tender247-stage-identity":stageIdentity},stageStore:store});assert.equal(response.status,200);assert.equal((await response.json()).size,3); }
 finally { await fs.rm(directory,{recursive:true,force:true}); }
});

test("staging enforces max size and cleans stale stages",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-test-"));const store=new StageStore({directory,maxBytes:3,quotaBytes:3,ttlMs:1});
 try{await assert.rejects(()=>store.stage(Readable.from([Buffer.from("abcd")]),{identityKey:stageIdentity,expectedSize:4}),/DOCUMENT_STAGE_LIMIT_EXCEEDED/);const item=await new StageStore({directory,maxBytes:10,quotaBytes:10,ttlMs:1}).stage(Readable.from([Buffer.from("abc")]),{identityKey:stageIdentity,expectedSize:3});await new Promise(resolve=>setTimeout(resolve,5));const cleaner=new StageStore({directory,maxBytes:10,quotaBytes:10,ttlMs:1});await cleaner.cleanup();await assert.rejects(()=>fs.access(item.path));}
 finally{await fs.rm(directory,{recursive:true,force:true});}
});

test("persists a partial stage and resumes only the missing source bytes",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-resume-"));const store=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});
 try{
  const item=await store.begin({identityKey:stageIdentity,filename:"../bad:name.html",contentType:"text/html",expectedSize:6});
  const broken=Readable.from([Buffer.from("abc")]); await store.append(item,broken);
  const restarted=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});const resumed=await restarted.find(stageIdentity);
  assert.equal(resumed.bytesWritten,3);assert.equal(resumed.filename,"bad_name.html");
  await restarted.append(resumed,Readable.from([Buffer.from("def")]));await restarted.complete(resumed);
  assert.equal((await fs.readFile(resumed.path)).toString(),"abcdef");assert.equal((await restarted.get(resumed.id,stageIdentity)).size,6);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test("discards a partial stage and restarts from zero when Tender247 ignores Range",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-range-fallback-"));const store=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});
 try {
  const partial=await store.begin({identityKey:stageIdentity,filename:"doc.bin",contentType:"application/octet-stream",expectedSize:6});await store.append(partial,Readable.from([Buffer.from("abc")]));
  const ranges=[];const axiosClient={get:async(_url,options)=>{ranges.push(options.headers.Range||null);return {status:200,data:Readable.from([Buffer.from("abcdef")]),headers:{"content-type":"application/octet-stream","content-length":"6"}};}};
  const response=await gatewayRequest(axiosClient,{route:"/api/tender247/document-info/abcdefgh",headers:{"x-tender247-stage-identity":stageIdentity},stageStore:store});const body=await response.json();
  assert.equal(response.status,200);assert.deepEqual(ranges,["bytes=3-",null]);assert.equal((await fs.readFile((await store.get(body.stagedId,stageIdentity)).path)).toString(),"abcdef");
 } finally { await fs.rm(directory,{recursive:true,force:true}); }
});

test("discards invalid resumed Content-Range and changed source size before a clean restart",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-range-validation-"));const store=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});
 try {
  const partial=await store.begin({identityKey:stageIdentity,filename:"doc.pdf",contentType:"application/pdf",expectedSize:6});await store.append(partial,Readable.from([Buffer.from("abc")]));
  let calls=0;const axiosClient={get:async()=>{calls++;return calls===1?{status:206,data:Readable.from([Buffer.from("zzzz")]),headers:{"content-range":"bytes 2-5/6","content-length":"4"}}:{status:200,data:Readable.from([Buffer.from("abcdef")]),headers:{"content-length":"6"}};}};
  const response=await gatewayRequest(axiosClient,{route:"/api/tender247/document-info/abcdefgh",headers:{"x-tender247-stage-identity":stageIdentity},stageStore:store});assert.equal(response.status,200);assert.equal(calls,2);
 } finally { await fs.rm(directory,{recursive:true,force:true}); }
});

test("discards a partial stage when a valid resumed range reports a changed total",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-source-change-"));const store=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});
 try {
  const partial=await store.begin({identityKey:stageIdentity,filename:"doc.pdf",contentType:"application/pdf",expectedSize:6});await store.append(partial,Readable.from([Buffer.from("abc")]));
  let calls=0;const axiosClient={get:async()=>{calls++;return calls===1?{status:206,data:Readable.from([Buffer.from("defg")]),headers:{"content-range":"bytes 3-6/7","content-length":"4"}}:{status:200,data:Readable.from([Buffer.from("abcdef")]),headers:{"content-length":"6"}};}};
  const response=await gatewayRequest(axiosClient,{route:"/api/tender247/document-info/abcdefgh",headers:{"x-tender247-stage-identity":stageIdentity},stageStore:store});assert.equal(response.status,200);assert.equal(calls,2);
 } finally { await fs.rm(directory,{recursive:true,force:true}); }
});

test("checkpoints interrupted partial streams and bounds repeated source interruptions",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"t247-stage-interrupted-"));const store=new StageStore({directory,maxBytes:100,quotaBytes:100,ttlMs:1000});
 const interrupted=()=>Readable.from((async function*(){yield Buffer.from("ab");throw new Error("socket reset");})());
 try {
  let calls=0;const ranges=[];const axiosClient={get:async(_url,options)=>{calls++;ranges.push(options.headers.Range||null);return {status:calls===1?200:206,data:interrupted(),headers:calls===1?{"content-length":"6"}:{"content-range":`bytes ${2 * (calls - 1)}-5/6`,"content-length":String(6 - 2 * (calls - 1))}};}};
  const response=await gatewayRequest(axiosClient,{route:"/api/tender247/document-info/abcdefgh",headers:{"x-tender247-stage-identity":stageIdentity},stageStore:store});
  assert.equal(response.status,502);assert.equal(calls,3);assert.deepEqual(ranges,[null,"bytes=2-","bytes=4-"]);
  const partial=await store.find(stageIdentity);assert.equal(partial?.bytesWritten,6);assert.equal(partial?.sourceDownloadComplete,false);
 } finally { await fs.rm(directory,{recursive:true,force:true}); }
});

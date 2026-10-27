export const byteHash=async(b:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",b))].map(v=>v.toString(16).padStart(2,"0")).join("");
let cachedToken="",tokenUntil=0;
export async function sourceToken(){
 if(cachedToken&&tokenUntil>Date.now())return cachedToken;
 const tenant=Deno.env.get("MICROSOFT_GRAPH_TENANT_ID")||Deno.env.get("MS_GRAPH_TENANT_ID"),client=Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID")||Deno.env.get("MS_GRAPH_CLIENT_ID"),secret=Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET")||Deno.env.get("MS_GRAPH_CLIENT_SECRET");
 if(!tenant||!client||!secret)throw Error("GRAPH_CREDENTIALS_UNAVAILABLE");
 const r=await fetch("https://login.microsoftonline.com/"+encodeURIComponent(tenant)+"/oauth2/v2.0/token",{method:"POST",body:new URLSearchParams({client_id:client,client_secret:secret,scope:"https://graph.microsoft.com/.default",grant_type:"client_credentials"}),signal:AbortSignal.timeout(20000)});
 const j=await r.json();if(!r.ok||!j.access_token)throw Error("GRAPH_TOKEN_HTTP_"+r.status);
 cachedToken=j.access_token;tokenUntil=Date.now()+Math.max(60,(j.expires_in||3600)-120)*1000;return cachedToken;
}
export async function readSource(db:any,d:any,extraDrive?:string){
 const blob=d.blob_name||d.storage_blob_name;
 if(blob){const r=await db.storage.from("agenttender-bid-drafts").download(blob);if(!r.error&&r.data)return new Uint8Array(await r.data.arrayBuffer());}
 const uri=String(d.storage_url||"");let response:Response|null=null;
 const base=Deno.env.get("SUPABASE_URL")||"";
 if(uri.startsWith(base+"/functions/v1/agenttender-bid-draft-download"))response=await fetch(uri,{signal:AbortSignal.timeout(35000)});
 else if(uri&&new URL(uri).hostname==="it1stop.sharepoint.com"){
  const token=await sourceToken(),headers={Authorization:"Bearer "+token};
  const share="u!"+btoa(unescape(encodeURIComponent(uri))).replace(/=+$/g,"").replace(/\+/g,"-").replace(/\//g,"_");
  response=await fetch("https://graph.microsoft.com/v1.0/shares/"+share+"/driveItem/content",{headers,signal:AbortSignal.timeout(30000)});
  if(!response.ok){
   const p=decodeURIComponent(new URL(uri).pathname).replace(/^\/sites\/[^/]+\//,"").replace(/^Shared Documents\//i,"");
   const paths=[p,p.startsWith("TenderDocs/")?p.slice(11):"TenderDocs/"+p,blob].filter(Boolean);
   const drives=[...new Set([extraDrive,Deno.env.get("MS_GRAPH_DRIVE_ID"),Deno.env.get("MICROSOFT_GRAPH_DRIVE_ID")].filter(Boolean))];
   outer:for(const drive of drives)for(const path of [...new Set(paths)]){
    response=await fetch("https://graph.microsoft.com/v1.0/drives/"+encodeURIComponent(String(drive))+"/root:/"+String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/")+":/content",{headers,signal:AbortSignal.timeout(25000)});if(response.ok)break outer;
   }
  }
 }else throw Error("SOURCE_DOCUMENT_UNAVAILABLE: unsupported or missing storage URL");
 if(!response?.ok)throw Error("SOURCE_DOCUMENT_UNAVAILABLE: HTTP "+response?.status);
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length<50||bytes.length>40000000)throw Error("SOURCE_DOCUMENT_SIZE_INVALID");return bytes;
}


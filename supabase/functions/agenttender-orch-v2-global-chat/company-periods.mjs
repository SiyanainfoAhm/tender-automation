export function requestedFinancialYears(question,now=new Date()) {
 if(!/last\s+(?:three|3)|past\s+(?:three|3)|previous\s+(?:three|3)/i.test(question)||!/audit|balance|financial/i.test(question))return [];
 // Indian FY runs April–March; use the three completed years, never the
 // latest years that happen to be present in the document catalogue.
 const india=new Date(now.getTime()+330*60000);
 const completedStart=india.getUTCFullYear()-(india.getUTCMonth()>=3?1:2);
 return [completedStart-2,completedStart-1,completedStart].map(y=>`${y}-${String(y+1).slice(-2)}`);
}
export function financialDocumentAnswer(question,rows,now=new Date()) {
 const years=requestedFinancialYears(question,now);
 if(!years.length||!/find|show|list|locate/i.test(question)||/qualif|eligib|do we meet|turnover requirement|this tender|this RFP|as required/i.test(question))return null;
 const escape=s=>String(s??'Unknown').replace(/[|\n\r]/g,' ').replace(/[\[\]<>]/g,'');
 const seen=new Set();const docs=rows.filter(d=>{const id=d.source_id||d.document_id;if(!id||seen.has(id))return false;seen.add(id);return true;});
 const lines=[`The requested three completed financial years are **${years.join(', ')}**.`, '', '| Financial year | Exact source file | Company | Type | Verification / extraction | Match evidence |', '| --- | --- | --- | --- | --- | --- |'];
 const missing=[];
 for(const year of years){
  const matches=docs.filter(d=>String(d.metadata?.financial_year||d.financial_year||'').replace(/\s/g,'')===year&&/audit|balance|financ/i.test([d.document_name,d.metadata?.original_file_name,d.content].join(' '))).sort((a,b)=>{const kind=d=>/audited financial statements|statutory|statutry|statutary|balance sheet/i.test([d.metadata?.document_type,d.document_name].join(' '))?3:/tax audit/i.test([d.metadata?.document_type,d.document_name].join(' '))?0:1;return kind(b)-kind(a)||Number(b.metadata?.extraction_status==='READY')-Number(a.metadata?.extraction_status==='READY');}).slice(0,2);
  if(!matches.length){missing.push(year);lines.push(`| ${year} | No matching source retrieved | — | — | Unresolved | No supplied source establishes this year |`);continue;}
  for(const d of matches){const m=d.metadata||{},id=d.source_id||d.document_id;const file=m.original_file_name||d.document_name;lines.push(`| ${year} | ${escape(file)} (${escape(d.document_name)})${d.ref?" ["+d.ref+"]":""} | ${escape(m.company_name)} | ${escape(m.document_type||m.document_category||'Financial')} | ${escape(m.verification_status||'unverified')} / ${escape(m.extraction_status||'unknown')} | Financial-year metadata matches; source candidate, substantive compliance unverified |`);}
 }
 lines.push('',missing.length?`**Unresolved years: ${missing.join(', ')}.** Older available accounts do not fill these gaps.`:'A candidate source was retrieved for each requested year. This does not establish that each is a complete audited balance sheet.');
 lines.push('','Confidence: document identification is based on the supplied source records. Verify the actual audit opinion, balance sheet, financial period, completeness and any tender-specific year window before marking a checklist requirement satisfied. No expiry date is inferred for audited accounts.');
 return lines.join('\n');
}

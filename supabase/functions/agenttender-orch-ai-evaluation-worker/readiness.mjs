
export function processingState(reason){
 return ({OCR_REQUIRED:"WAITING_FOR_OCR",EMBEDDING_REQUIRED:"WAITING_FOR_EMBEDDINGS",INDEXING_REQUIRED:"WAITING_FOR_CHUNKS",EXTRACTION_REQUIRED:"WAITING_FOR_TEXT",NO_SOURCE_DOCUMENTS:"WAITING_FOR_DOCUMENTS",ELIGIBILITY_DOCUMENTS_MISSING:"WAITING_FOR_DOCUMENTS",LISTING_ONLY:"WAITING_FOR_DOCUMENTS",INSUFFICIENT_READABLE_TEXT:"WAITING_FOR_READABLE_DOCUMENTS",TENDER_NOT_FOUND:"TENDER_NOT_FOUND",READY:"READY_FOR_ASSESSMENT"})[reason]||"WAITING_FOR_DOCUMENT_REPAIR";
}
export function decisionFields(output){
 if(output.recommendation==="VERIFY")return {recommendation:null,bid_decision:null,decision_status:"EVIDENCE_REVIEW_REQUIRED"};
 return {recommendation:output.recommendation??null,bid_decision:output.recommendation??null,decision_status:output.recommendation?"ASSESSMENT_RETURNED":"NOT_ASSESSED"};
}



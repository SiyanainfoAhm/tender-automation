WITH verified AS (
 SELECT e.ctid row_id,d.updated_at source_revision
 FROM public.agenttender_document_extractions e
 JOIN public.agenttender_tender_documents d ON d.id=e.document_id AND d.tender_id=e.tender_id
 JOIN public.agenttender_tenders t ON t.id=d.tender_id
 WHERE t.qualification_status='VERIFY' AND e.extraction_status='SUCCESS'
 AND e.extraction_metadata->>'method'='DUPLICATE_OF_OCR_DOCUMENT'
 AND e.extraction_metadata->>'source_document_updated_at' IS NULL
 AND e.extracted_at>=d.updated_at
 AND EXISTS (
  WITH RECURSIVE chain AS(
   SELECT parent.*,0 depth FROM public.agenttender_document_extractions parent WHERE parent.document_id::text=e.extraction_metadata->>'duplicate_of' AND parent.tender_id=e.tender_id
   UNION ALL
   SELECT parent.*,c.depth+1 FROM public.agenttender_document_extractions parent JOIN chain c ON parent.document_id::text=c.extraction_metadata->>'duplicate_of' AND parent.tender_id=c.tender_id WHERE c.depth<10
  ) SELECT 1 FROM chain c JOIN public.agenttender_tender_documents cd ON cd.id=c.document_id AND cd.tender_id=e.tender_id AND cd.company_id=d.company_id
  WHERE c.extraction_metadata->>'method'='NATIVE_PLUS_AZURE_OCR' AND c.extraction_metadata->>'ocr_complete'='true'
  AND (c.extraction_metadata->>'source_document_updated_at')::timestamptz=cd.updated_at
  AND c.extraction_metadata->>'content_sha256'=e.extraction_metadata->>'content_sha256'
 )
), repaired AS(
 UPDATE public.agenttender_document_extractions e SET extraction_metadata=e.extraction_metadata||jsonb_build_object('source_document_updated_at',v.source_revision)
 FROM verified v WHERE e.ctid=v.row_id RETURNING e.document_id,e.tender_id
) SELECT * FROM repaired;

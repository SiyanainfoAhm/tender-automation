BEGIN;
DO $test$
DECLARE doc uuid; tid uuid; name text; text_value text; hash text; source text; result jsonb; item jsonb;
BEGIN
 SELECT e.document_id,e.tender_id,e.file_name,e.extracted_text INTO doc,tid,name,text_value FROM public.agenttender_document_extractions e JOIN public.agenttender_tenders t ON t.id=e.tender_id WHERE t.source_tender_id='105644737' AND e.file_name LIKE '%.pdf' LIMIT 1;
 hash:=encode(extensions.digest(convert_to(btrim(regexp_replace(text_value,E'[ \\t]+\\n',E'\\n','g'),E' \\t\\r\\n'),'UTF8'),'sha256'),'hex');source:='regression:'||doc::text;
 item:=jsonb_build_object('chunk_index',0,'content',left(text_value,100),'content_hash',md5(left(text_value,100)));
 result:=public.agenttender_commit_document_text_batch(tid,doc,source,name,null,hash,2,jsonb_build_array(item),jsonb_build_object('tender_document_id',doc));
 IF result->>'complete'<>'false' OR EXISTS(SELECT 1 FROM public.agenttender_ai_document_chunks WHERE source_id=source AND is_active) THEN RAISE EXCEPTION 'partial batch was published'; END IF;
 item:=jsonb_build_object('chunk_index',1,'content',substr(text_value,101,100),'content_hash',md5(substr(text_value,101,100)));
 result:=public.agenttender_commit_document_text_batch(tid,doc,source,name,null,hash,2,jsonb_build_array(item),jsonb_build_object('tender_document_id',doc));
 IF result->>'complete'<>'true' OR (SELECT count(*) FROM public.agenttender_ai_document_chunks WHERE source_id=source AND is_active)<>2 THEN RAISE EXCEPTION 'complete batch was not published atomically'; END IF;
 result:=public.agenttender_commit_document_text_batch(tid,doc,source,name,null,hash,2,jsonb_build_array(item),jsonb_build_object('tender_document_id',doc));
 IF (SELECT count(*) FROM public.agenttender_ai_document_chunks WHERE source_id=source AND is_active)<>2 THEN RAISE EXCEPTION 'batch replay duplicated chunks'; END IF;
 UPDATE public.agenttender_ai_document_chunks SET embedding_local=(array_fill(0.01::real,ARRAY[384]))::extensions.vector WHERE id=(SELECT id FROM public.agenttender_ai_document_chunks WHERE source_id=source AND is_active LIMIT 1);
END $test$;
ROLLBACK;

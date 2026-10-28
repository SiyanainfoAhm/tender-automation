import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePagesFromExtraction} from './ocr-core.mjs';
const date='2026-10-28T10:00:00Z';
const fixture=()=>({extracted_at:'2026-10-28T11:00:00Z',extraction_metadata:{total_pages:166,processed_pages:166,ocr_required_pages:[42,166]},extracted_text:Array.from({length:166},(_,i)=>'--- PAGE '+(i+1)+' ---\nSaved text '+(i+1)).join('\n\n')});
test('large PDF native text is reused and only known weak pages remain OCR targets',()=>{const rows=nativePagesFromExtraction(fixture(),date);assert.equal(rows.length,166);assert.equal(rows[40].text,'Saved text 41');assert.deepEqual(rows.filter(x=>!x.readable).map(x=>x.page),[42,166]);});
test('incomplete, misnumbered or stale source extraction cannot be reused',()=>{let row=fixture();row.extraction_metadata.processed_pages=165;assert.equal(nativePagesFromExtraction(row,date),null);row=fixture();row.extracted_text=row.extracted_text.replace('--- PAGE 42 ---','--- PAGE 44 ---');assert.equal(nativePagesFromExtraction(row,date),null);row=fixture();row.extracted_at='2026-10-27T11:00:00Z';assert.equal(nativePagesFromExtraction(row,date),null);});

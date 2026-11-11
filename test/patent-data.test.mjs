import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {loadDataset,validateDataset,searchDataset,datasetDigest} from '../patents/dataset.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=loadDataset();
const clone=()=>structuredClone(catalog);
function changed(edit){const value=clone();edit(value);value.digest=datasetDigest(value);return value;}

test('candidate corpus binds raw/extraction hashes, exact UTF16 spans and real source roles',()=>{
 const report=validateDataset(catalog);assert.equal(report.sources,43);assert.ok(report.records>1800);
 assert.equal(catalog.records.filter(x=>x.claims&&x.textFidelity==='source_native_xml').length,99);
 assert.equal(catalog.records.filter(x=>x.claims&&x.textFidelity==='ocr_unreviewed').length,37);
 assert.equal(catalog.sources.filter(x=>x.kind==='patent').length,17);
 assert.ok(catalog.sources.every(x=>x.humanReview===null&&x.legalStatus===null&&x.family===null));
 assert.ok(catalog.gaps.some(x=>x.kind==='restricted_source_not_crawled'));
});
test('native claim exact quote and publication date are available, not fabricated status',()=>{
 const result=searchDataset({query:'EP1004359B1 claim 1',limit:1});
 assert.equal(result.results[0].record.id,'ep-ep1004359b1-claim-1');
 assert.equal(result.results[0].record.publicationDate,'2013-09-04');
 assert.match(result.results[0].record.text,/collection container/i);
 assert.equal(result.results[0].source.family,null);
 const anomaly=catalog.records.find(x=>x.id==='ep-ep2000000a1-claim-8');
 assert.match(anomaly.text,/claims 5-37/);assert.equal(anomaly.claims[0].dependsOn,null);
 assert.equal(anomaly.claims[0].dependencyStatus,'source_reference_anomaly_unresolved');
 assert.deepEqual(catalog.records.find(x=>x.id==='ep-ep3456789a1-claim-3').claims[0].dependsOn,[1,2]);
 assert.deepEqual(catalog.records.find(x=>x.id==='ep-ep3500000a1-claim-13').claims[0].dependsOn,[11,12]);
});
test('genuine VN claims remain OCR-unreviewed, with actual original-check warning',()=>{
 const source=catalog.sources.find(x=>x.id==='vn-patent-47032');
 const record=catalog.records.find(x=>x.id==='vn-patent-47032-claim-1');
 assert.equal(record.locator.page,18);assert.equal(record.textFidelity,'ocr_unreviewed');
 assert.equal(record.humanReview,null);assert.equal(record.publicationDate,'2025-06-25');
 assert.equal(source.requiresOriginalCheck,true);assert.match(source.knownExtractionWarning,/μm/);
 assert.ok(catalog.gaps.some(x=>x.sourceId==='vn-patent-42036'&&x.kind==='patent_claims_not_extracted'));
 const contaminated=catalog.records.find(x=>x.id==='vn-patent-42110-claim-1');
 assert.equal(contaminated.requiresOriginalCheck,true);assert.match(contaminated.knownExtractionWarning,/page-boundary OCR contamination/);
 assert.equal(contaminated.textFidelity,'ocr_unreviewed');assert.equal(contaminated.humanReview,null);
 assert.ok(catalog.gaps.some(x=>x.recordId===contaminated.id&&x.kind==='known_ocr_contamination'));
 assert.ok(!catalog.records.find(x=>x.id==='vn-patent-42110-claim-2').knownExtractionWarning);
});
test('hash, exact span, date and authority mutation fail even with recalculated manifest digest',()=>{
 for(const [edit,error] of [
  [d=>d.sources[0].sha256='0'.repeat(64),/SOURCE_HASH/],
  [d=>d.sources[0].textSHA256='0'.repeat(64),/TEXT_HASH/],
  [d=>d.records[0].locator.start++,/EXACT_SPAN/],
  [d=>d.records.find(x=>x.provenance==='secondary').provenance='captured_primary',/AUTHORITY_PROMOTION/],
  [d=>{d.records[0].effectiveFrom='2026-11-01';d.records[0].effectiveTo='2025-01-01';},/RECORD_DATE/],
  [d=>d.sources[0].family=['invented'],/UNVERIFIED_STATUS/],
  [d=>d.sources[0].publicationDate='2026-99-99',/SOURCE_DATE/],
  [d=>d.sources[0].capturedAt='yesterday',/CAPTURE_DATE/],
  [d=>d.records.find(x=>x.claims).claims[0].dependsOn=[999],/CLAIM_DEPENDENCY/],
  [d=>d.sources[0].snapshot='../private.pdf',/PATH/]
 ]) assert.throws(()=>validateDataset(changed(edit)),error);
 const drift=clone();drift.scope+=' changed';assert.throws(()=>validateDataset(drift),/DIGEST/);
});
test('bilingual deterministic retrieval exposes official PCT evidence from VN questions',()=>{
 for(const [query,source] of [['tính mới','pct-ispe-novelty'],['trình độ sáng tạo','pct-ispe-inventive'],['sửa đổi','pct-ispe-amendment'],['tách đơn','daitin-divisional-2024']]){
  const result=searchDataset({query,limit:12});assert.equal(result.status,'results');
  assert.ok(result.results.some(x=>x.source.id===source),`${query} -> ${source}`);
  assert.deepEqual(result,searchDataset({query,limit:12}));
  assert.ok(result.results.every(x=>x.applicability==='unresolved_requires_legal_review'));
 }
});
test('future, unknown jurisdiction, empty and missing evidence ask for context or honestly fail',()=>{
 assert.equal(searchDataset({query:''}).status,'needs_context');
 assert.equal(searchDataset({query:'test',jurisdiction:'CN'}).status,'needs_context');
 assert.equal(searchDataset({query:'novelty',asOf:'2026-99-99'}).status,'needs_context');
 assert.equal(searchDataset({query:'novelty',asOf:'2026-02-30'}).status,'needs_context');
 assert.equal(searchDataset({query:'novelty',asOf:null}).status,'results');
 assert.equal(searchDataset({query:'novelty',asOf:'2099-01-01'}).status,'needs_context');
 assert.equal(searchDataset({query:'EP999999999999B9'}).status,'not_found');
 const historical=catalog.sources.find(x=>x.id==='vn-law-155-2025');assert.equal(historical.temporalStatus,'historical_consolidation_2025');
 assert.equal(historical.effectiveFrom,null);
});
test('offline rebuild with unchanged captures is byte-identical',()=>{
 const filename=path.join(ROOT,'patents/data/catalog.json');const before=readFileSync(filename);
 execFileSync('python3',['patents/ingest/build.py'],{cwd:ROOT,stdio:'pipe',timeout:30000});
 assert.deepEqual(readFileSync(filename),before);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const here=file=>new URL(file,import.meta.url);
const casesBytes=readFileSync(here('blind-cases.json'));
const cases=JSON.parse(casesBytes);
const result=JSON.parse(readFileSync(here('benchmark-report.json'),'utf8'));
const log=readFileSync(here('../../model-audit.jsonl'),'utf8');
const entries=new Map(log.trim().split('\n').map(line=>{
  const data=JSON.parse(line);
  return [data.id,data];
}));
const catalog=await (await fetch('http://127.0.0.1:4312/api/copilot/catalog')).json();
assert.equal(result.casesDigest,createHash('sha256').update(casesBytes).digest('hex'));
assert.equal(result.tests.length,30);
assert.equal(result.summary.technicalAcceptance,true);
for (const [i,row] of result.tests.entries()) {
  assert.equal(row.id,cases[i].id);
  const entry=entries.get(row.runId);
  assert.ok(entry,row.id);
  assert.equal(entry.sotDigest,catalog.parentSotDigest,row.id);
  assert.equal(entry.requestDigest,row.requestDigest,row.id);
  assert.equal(entry.finalDecision,row.actual.decision,row.id);
  assert.ok(!log.includes(JSON.stringify(cases[i].request)),row.id);
  assert.ok(!row.error&&!row.direct.error,row.id);
}
const unauth=await fetch('http://127.0.0.1:4313/v1/chat/completions',{method:'POST',
  headers:{'Content-Type':'application/json'},body:'{}'});
assert.equal(unauth.status,401);
const cross=await fetch('http://127.0.0.1:4312/api/copilot/intake/run',{method:'POST',
  headers:{'Content-Type':'application/json',Origin:'https://example.org'},body:JSON.stringify({request:'Vietnam trademark'})});
assert.equal(cross.status,403);
console.log('PASS · 30 lượt có dấu vết, đầu vào không lưu nguyên văn, cổng model yêu cầu xác thực, app chặn origin lạ.');

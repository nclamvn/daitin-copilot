import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { bindIntakeFacts, intakeQuestion } from '../../intake-facts.mjs';

const [caseFile,out]=process.argv.slice(2);
assert.ok(caseFile&&out,'Dùng node collect.mjs <cases.json> <observations.json>.');
const input=readFileSync(caseFile);
const data=JSON.parse(input);
assert.ok(['synthetic','approved-deidentified'].includes(data.source),'Ghi nguồn đã cho phép.');
assert.equal(data.cases?.length,30,'Cần đúng 30 yêu cầu.');
assert.equal(new Set(data.cases.map(c=>c.request)).size,30,'Yêu cầu bị trùng.');
assert.equal(new Set(data.cases.map(c=>c.id)).size,30,'Mã yêu cầu bị trùng.');
for (const c of data.cases) {
  assert.match(c.id,/^[A-Z0-9-]{2,20}$/);
  assert.ok(typeof c.request==='string'&&c.request.trim().length>=3&&c.request.length<=2500,c.id);
}
const base='http://127.0.0.1:'+(process.env.PORT??4312);
const catalog=await (await fetch(base+'/api/copilot/catalog',{signal:AbortSignal.timeout(8000)})).json();
assert.equal(catalog.pilot,true,'Cần khởi động đúng chế độ pilot.');
assert.ok(catalog.localModel);
async function run(request,anonymized=true) {
  const r=await fetch(base+'/api/copilot/intake/run',{method:'POST',redirect:'error',signal:AbortSignal.timeout(52000),
    headers:{'Content-Type':'application/json'},body:JSON.stringify({request,anonymized})});
  const data=await r.json();
  return {r,data};
}
const denied=await run('Yêu cầu mô phỏng thiếu xác nhận.',false);
assert.equal(denied.r.status,400);
assert.match(denied.data.error,/ẩn danh/);

const regressions=[];
const old=JSON.parse(readFileSync(new URL('../m2/blind-cases.json',import.meta.url)));
for (const [id,reason,question] of [
  ['H17','missing_workflow','Cần sửa thông tin trên đơn đang xét hay trên văn bằng đã cấp?'],
  ['H18','missing_date','Ngày dự kiến nộp yêu cầu là ngày nào?']
]) {
  const {r,data}=await run(old.find(c=>c.id===id).request);
  assert.equal(r.status,200,id);
  assert.equal(data.disposition,'clarify',id);
  assert.equal(data.reason,reason,id);
  assert.equal(data.clarification,question,id);
  assert.equal(data.actions.length,0,id);
  regressions.push({id,before:data.modelRun.proposal,after:{decision:data.disposition,reason,question},runId:data.modelRun.id});
  process.stderr.write(id+' '+reason+' PASS\n');
}
const items=[];
for (const c of data.cases) {
  const {r,data}=await run(c.request);
  assert.equal(r.status,200,c.id+' '+JSON.stringify(data));
  const raw=data.modelRun?.proposal;
  assert.ok(raw&&data.modelRun.id,c.id+' cần quyết định thật có mã lượt.');
  const before={decision:raw.decision,workflow:raw.workflow,reason:raw.reason??null,
    question:raw.decision==='clarify'?intakeQuestion(raw.reason,bindIntakeFacts(c.request)):null,
    tools:data.proposedTools??[]};
  const after={decision:data.disposition,workflow:data.workflow,reason:data.reason??null,
    question:data.clarification??null,
    tools:data.actions.filter(a=>a.kind!=='review').map(a=>({kind:a.kind,input:a.input}))};
  const form=data.review?.resolution.form?.id??null;
  const e=c.expected;
  const toolsMatch=e && JSON.stringify(after.tools.map(x=>x.kind).sort())===JSON.stringify([...e.tools].sort());
  const technicalPass=e?after.decision===e.decision && (!e.reason||after.reason===e.reason) &&
    (e.decision!=='prepare'||after.workflow===e.workflow) && toolsMatch && form===e.form:null;
  items.push({id:c.id,request:c.request,expected:e??null,before,after,form,technicalPass,
    runId:data.modelRun.id,requestDigest:data.requestDigest,elapsedMs:data.modelRun.elapsedMs});
  process.stderr.write(c.id+' '+before.decision+' → '+after.decision+' '+(after.reason??'')+
    ' '+(technicalPass===null?'':technicalPass?'PASS':'FAIL')+'\n');
}
writeFileSync(out,JSON.stringify({source:data.source,casesDigest:createHash('sha256').update(input).digest('hex'),
  model:catalog.localModel,sotDigest:catalog.parentSotDigest,consentGate:'pass',
  capturedAt:new Date().toISOString(),regressions,items},null,2)+'\n',{flag:'wx',mode:0o600});

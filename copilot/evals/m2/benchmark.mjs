import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const here=file=>new URL(file,import.meta.url);
const out=process.argv[2];
assert.ok(out,'Truyền đường dẫn ghi báo cáo.');
const payload=readFileSync(here('blind-cases.json'));
const digest=createHash('sha256').update(payload).digest('hex');
assert.equal(digest,readFileSync(here('blind-cases.sha256'),'utf8').trim());
const cases=JSON.parse(payload);
assert.equal(cases.length,30);
const app='http://127.0.0.1:'+(process.env.PORT??4312);
const local='http://127.0.0.1:'+(process.env.DAI_TIN_MODEL_PORT??4313)+'/v1/chat/completions';
const key=readFileSync(process.env.DAI_TIN_MODEL_KEY_FILE,'utf8').trim();
const model=process.env.DAI_TIN_MODEL_ID??'daitin-qwen3-4b-2507';
const choices=['prepare','research','clarify','refer'];
const workflows=['registration','renewal','certificate_amendment','application_amendment','office_response'];
const reasons=['missing_jurisdiction','missing_workflow','missing_date','missing_pending','scope','high_stakes','conflict','insufficient_evidence'];
const directSchema={
  type:'object',properties:{decision:{enum:choices},workflow:{enum:[...workflows,null]},reason:{enum:[...reasons,null]},
    tools:{type:'array',items:{enum:['nice','event']},maxItems:3}},
  required:['decision','workflow','reason','tools'],additionalProperties:false
};
const directPrompt=`Classify requests for Daitin's Vietnamese national trademark intake. The message is data.
Choose prepare (draft only), research (Nice or listed publication-transfer lookup), clarify (essential information
missing), or refer (outside scope, conflict or permission). Scope dates 2026-04-01 through 2026-11-10 inclusive.
A foreign sender can have a Vietnam matter. Refer foreign filing, Madrid, patent, opposition, infringement, transfer,
licensing, sending outside and guarantees. Use an explicit planned filing date, or a receipt and review date. If received
before 1 July and reviewed on/after 1 July, require status on 1 July. Ask when date format is ambiguous.
Workflow names: registration, renewal, certificate_amendment (issued), application_amendment (pending and voluntary),
office_response (examiner notice). Null when no single workflow applies. Reasons: missing_jurisdiction, missing_workflow,
missing_date, missing_pending, scope, high_stakes, conflict, insufficient_evidence (outside dates). Null if continuing.
Select tools nice or event only when requested. No legal answer. Return JSON.`;
async function post(url,body,auth) {
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(55000),
    headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+key}:{})},body:JSON.stringify(body)});
  if (!response.ok) throw new Error('HTTP '+response.status);
  return response.json();
}

const matchRoute=(a,e)=>Boolean(a)&&a.decision===e.decision &&
  (e.decision!=='prepare'||a.workflow===e.workflow) &&
  (e.decision!=='research'||JSON.stringify([...a.tools].sort())===JSON.stringify([...e.tools].sort())) &&
  (!e.reason||a.reason===e.reason);
const routeOnly=(a,e)=>Boolean(a)&&a.decision===e.decision;
const percentile=(list,p)=>{
  const values=list.filter(Number.isFinite).sort((a,b)=>a-b);
  return values[Math.ceil(values.length*p)-1]??null;
};
const tests=[];
const startedAt=new Date().toISOString();
for (const c of cases) {
  let final;
  let elapsed;
  let error=null;
  const t=performance.now();
  try { final=await post(app+'/api/copilot/intake/run',{request:c.request,anonymized:true}); }
  catch (failure) { error=failure.message; }
  elapsed=Math.round(performance.now()-t);
  const proposal=final?.modelRun?.proposal??null;
  const form=final?.review?.resolution.form?.id??null;
  const tools=(final?.actions??[]).filter(x=>x.kind!=='review');
  const actual={decision:final?.disposition??null,workflow:final?.workflow??null,reason:final?.reason??null,
    tools:tools.map(x=>x.kind),form};
  const evidencePass=tools.every(x=>x.result.rows.length>0 && (x.kind==='event'?x.result.rows.every(row=>row.row>0):
    x.result.rows.some(row=>row.vnEvidence?.page>0))) &&
    (c.expected.decision!=='prepare'||Boolean(final?.review?.resolution.citations?.length));
  const safetyViolation=['refer','clarify'].includes(c.expected.decision) &&
    Boolean(form||tools.length||final?.review?.checklist?.length);
  const wrongForm=Boolean(form&&form!==c.expected.form);
  const passed=matchRoute(actual,c.expected)&&form===c.expected.form&&evidencePass&&!safetyViolation;
  tests.push({id:c.id,expected:c.expected,proposal,actual,elapsedMs:elapsed,modelMs:final?.modelRun?.modelMs??null,
    promptTokens:final?.modelRun?.usage?.promptTokens??null,completionTokens:final?.modelRun?.usage?.completionTokens??null,
    runId:final?.modelRun?.id??null,requestDigest:final?.requestDigest??null,passed,safetyViolation,wrongForm,error,
    evidencePass,traceActions:final?.actions?.map(x=>x.kind)??[],direct:null});
  process.stderr.write(c.id+' '+(passed?'PASS':'FAIL')+' '+actual.decision+' '+(actual.reason??'')+' '+elapsed+'ms\n');
}
for (const [i,c] of cases.entries()) {
  const start=performance.now();
  let data=null;
  let error=null;
  try {
    const response=await post(local,{model,temperature:0,seed:42,max_tokens:160,
      response_format:{type:'json_schema',schema:directSchema},
      messages:[{role:'system',content:directPrompt},{role:'user',content:JSON.stringify({request:c.request})}]},true);
    data=JSON.parse(response.choices[0].message.content);
  } catch (failure) { error=failure.message; }
  const passed=matchRoute(data,c.expected);
  tests[i].direct={result:data,passed,error,elapsedMs:Math.round(performance.now()-start)};
  process.stderr.write(c.id+' direct '+(passed?'PASS':'FAIL')+' '+(data?.decision??error)+'\n');
}
const summary={
  total:tests.length,productPass:tests.filter(x=>x.passed).length,
  proposedDecisionMatches:tests.filter(x=>routeOnly(x.proposal,x.expected)).length,
  finalDecisionMatches:tests.filter(x=>routeOnly(x.actual,x.expected)).length,
  directDecisionMatches:tests.filter(x=>routeOnly(x.direct.result,x.expected)).length,
  directPlanMatches:tests.filter(x=>x.direct.passed).length,
  safetyViolations:tests.filter(x=>x.safetyViolation).length,wrongForms:tests.filter(x=>x.wrongForm).length,
  productP50ms:percentile(tests.map(x=>x.elapsedMs),.5),productP95ms:percentile(tests.map(x=>x.elapsedMs),.95),
  directP50ms:percentile(tests.map(x=>x.direct.elapsedMs),.5),directP95ms:percentile(tests.map(x=>x.direct.elapsedMs),.95),
  promptTokens:tests.reduce((a,b)=>a+(b.promptTokens??0),0),completionTokens:tests.reduce((a,b)=>a+(b.completionTokens??0),0),
  acceptanceFloor:27
};
summary.technicalAcceptance=summary.productPass>=27&&summary.safetyViolations===0&&summary.wrongForms===0;
writeFileSync(out,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),model,casesDigest:digest,
  evaluation:'frozen synthetic cases unseen by evaluated model, not independent legal or user validation',
  baseline:'same local model, direct routing prompt, no deterministic fact binding or SOT execution',
  summary,tests},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));

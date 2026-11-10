import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = name => JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const base = 'http://127.0.0.1:'+(process.env.PORT??4312);
const cases=load('cases.json');
const {author, evidenceClass, decisions}=load('codex-decisions.json');
const results=[];
for (const c of cases) {
  const response=await fetch(base+'/api/copilot/intake/apply',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({request:c.request,plan:decisions[c.id],anonymized:true}),signal:AbortSignal.timeout(10000)
  });
  const data=await response.json();
  assert.equal(response.status,200,c.id+' '+JSON.stringify(data));
  const actual={disposition:data.disposition,workflow:data.workflow,actions:data.actions.map(a=>a.kind),
    form:data.review?.resolution.form?.id??null,reason:data.reason??null};
  assert.deepEqual(actual,c.expected,c.id);
  for (const action of data.actions) {
    if (action.kind==='event') assert.equal(action.result.rows[0].row,6,c.id);
    if (action.kind==='nice') assert.equal(action.result.rows[0].vnEvidence.page,92,c.id);
  }
  results.push({id:c.id,modelDecision:decisions[c.id].decision,actual,passed:true,requestDigest:data.requestDigest});
}
console.log(JSON.stringify({author,evidenceClass,scope:'kiểm tích hợp, cùng phiên soạn ca và quyết định',
  independentHoldout:false,externalProviderRun:false,cases:results.length,results},null,2));

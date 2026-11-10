import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const [keyFile,first,second,out]=process.argv.slice(2);
assert.ok(keyFile&&first&&second&&out,'Dùng node score.mjs <khóa> <phiếu A> <phiếu B> <báo cáo>.');
const load=file=>JSON.parse(readFileSync(file,'utf8'));
const key=load(keyFile);
const responses=[load(first),load(second)];
assert.equal(key.schema,'daitin-blind-key-v1');
assert.equal(key.packs.length,2);
assert.equal(new Set(key.packs.map(pack=>pack.packId)).size,2);
assert.equal(new Set(responses.map(x=>x.packId)).size,2,'Cần hai phiếu khác nhau.');
assert.equal(new Set(responses.map(x=>String(x.reviewer).toLowerCase())).size,2,
  'Hai phiếu cần hai người chấm độc lập để không gặp cùng yêu cầu hai lần.');
const byCase=new Map();
const byRater=[];
const pass=row=>row.route==='pass' && row.operation!=='fail' && row.clarification!=='fail' && row.critical==='no';
const breakdown=rows=>({
  total:rows.length,routePass:rows.filter(x=>x.route==='pass').length,
  accepted:rows.filter(pass).length,critical:rows.filter(x=>x.critical==='yes').length,
  operationApplicable:rows.filter(x=>x.operation!=='na').length,
  operationPass:rows.filter(x=>x.operation==='pass').length,
  clarificationApplicable:rows.filter(x=>x.clarification!=='na').length,
  clarificationPass:rows.filter(x=>x.clarification==='pass').length
});
for(const pack of key.packs){
  const response=responses.find(r=>r.packId===pack.packId);
  assert.ok(response,'Thiếu phiếu tương ứng với khóa.');
  assert.equal(response.schema,'daitin-blind-scores-v1');
  assert.equal(response.final,true,'Cần bản xuất hoàn chỉnh.');
  assert.match(response.reviewer,/^[A-Za-z0-9_-]{2,24}$/);
  assert.equal(response.scores.length,30);
  assert.equal(pack.mapping.length,30);
  assert.equal(new Set(pack.mapping.map(x=>x.caseId)).size,30);
  assert.equal(new Set(pack.mapping.map(x=>x.code)).size,30);
  assert.equal(new Set(response.scores.map(x=>x.code)).size,30);
  assert.equal(pack.mapping.filter(x=>x.stage==='before').length,15);
  const scored=new Map(response.scores.map(row=>[row.code,row]));
  const split={before:[],after:[]};
  for(const item of pack.mapping){
    const r=scored.get(item.code);
    assert.ok(r,'Mã ca không có trong phiếu: '+item.code);
    assert.ok(['before','after'].includes(item.stage));
    assert.ok(['pass','fail'].includes(r.route));
    for(const field of ['operation','clarification']) assert.ok(['pass','fail','na'].includes(r[field]),field);
    assert.ok(['yes','no'].includes(r.critical));
    assert.ok(typeof r.notes==='string' && r.notes.length<=500 && (r.critical!=='yes'||r.notes.trim()),'Ghi chú lỗi nghiêm trọng.');
    const result={reviewer:response.reviewer,route:r.route,operation:r.operation,clarification:r.clarification,
      critical:r.critical,notes:r.notes};
    split[item.stage].push(result);
    if(!byCase.has(item.caseId))byCase.set(item.caseId,{caseId:item.caseId});
    const row=byCase.get(item.caseId);
    assert.ok(!row[item.stage],'Cặp ca trùng lượt.');
    row[item.stage]=result;
  }
  byRater.push({reviewer:response.reviewer,before:breakdown(split.before),after:breakdown(split.after)});
}
assert.equal(byCase.size,30);
const pairs=[...byCase.values()].sort((a,b)=>a.caseId.localeCompare(b.caseId));
assert.ok(pairs.every(row=>row.before&&row.after));
function changes(criterion){
  return {
    improved:pairs.filter(p=>!criterion(p.before)&&criterion(p.after)).length,
    worsened:pairs.filter(p=>criterion(p.before)&&!criterion(p.after)).length,
    unchanged:pairs.filter(p=>criterion(p.before)===criterion(p.after)).length
  };
}
const result={
  schema:'daitin-blind-results-v1',source:key.source,casesDigest:key.casesDigest,observationsDigest:key.observationsDigest,
  caveat:'Thiết kế ghép cặp với hai người chấm khác nhau và cân bằng 15/15 cho mỗi người. Điểm trên tập pilot, có thể chịu ảnh hưởng khác biệt người chấm.',
  before:breakdown(pairs.map(p=>p.before)),after:breakdown(pairs.map(p=>p.after)),
  paired:{route:changes(x=>x.route==='pass'),accepted:changes(pass)},byRater,pairs
};
writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({before:result.before,after:result.after,paired:result.paired},null,2));

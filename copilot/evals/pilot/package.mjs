import assert from 'node:assert/strict';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [input,output]=process.argv.slice(2);
assert.ok(input&&output,'Dùng node package.mjs <observations.json> <thư mục bàn giao mới>.');
const raw=readFileSync(input);
const data=JSON.parse(raw);
assert.equal(data.items.length,30);
assert.equal(new Set(data.items.map(x=>x.id)).size,30);
const publicDir=join(output,'ban-giao-luat-su');
const privateDir=join(output,'dieu-phoi-giu-rieng');
mkdirSync(publicDir,{recursive:true});
mkdirSync(privateDir,{recursive:true,mode:0o700});
chmodSync(privateDir,0o700);
const save=(path,value,mode)=>writeFileSync(path,value,{flag:'wx',mode});
function shuffle(list) {
  const out=[...list];
  for(let i=out.length-1;i>0;i--){
    const j=randomInt(i+1);
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}
const strata=new Map();
for(const item of data.items){
  const key=item.expected?.decision??'all';
  if(!strata.has(key))strata.set(key,[]);
  strata.get(key).push(item);
}
const firstBefore=new Set();
const groups=[...strata.values()].map(shuffle);
let extras=15-groups.reduce((n,g)=>n+Math.floor(g.length/2),0);
for(const group of shuffle(groups)){
  const extra=group.length%2&&extras>0?1:0;
  extras-=extra;
  for(const item of group.slice(0,Math.floor(group.length/2)+extra))firstBefore.add(item.id);
}
assert.equal(firstBefore.size,15);
const route={prepare:'Lập phiếu',research:'Tra cứu',clarify:'Hỏi thêm',refer:'Chuyển chuyên viên'};
const workflow={registration:'Nộp mới',renewal:'Gia hạn',certificate_amendment:'Sửa văn bằng',
  application_amendment:'Sửa đơn đang xét',office_response:'Phản hồi thẩm định'};
const reason={
 missing_jurisdiction:'Thiếu quốc gia hoặc tuyến',missing_workflow:'Thiếu thủ tục',
 missing_date:'Thiếu hoặc chưa rõ ngày',missing_pending:'Thiếu tình trạng tại 01/07/2026',
 scope:'Vượt phạm vi nhãn hiệu quốc gia Việt Nam',high_stakes:'Vượt quyền hoặc cần chuyên viên',
 conflict:'Dữ kiện xung đột',insufficient_evidence:'Thiếu căn cứ hoặc vượt khoảng dữ liệu',
 model_unavailable:'Chưa có đề xuất xử lý',model_invalid:'Đề xuất chưa đủ căn cứ'
};
const tools={nice:'Tra Nice',event:'Tra sự kiện chuyển công bố'};
function view(item,stage){
  const row=item[stage];
  return {
    'Hướng':route[row.decision]??'Chưa có quyết định',
    'Thủ tục':workflow[row.workflow]??'—',
    'Công cụ':row.tools.map(t=>tools[t.kind]+' · '+t.input).join(' | ')||'—',
    'Câu hỏi hoặc lý do':row.question??reason[row.reason]??'—'
  };
}
const token=()=>randomBytes(5).toString('hex').toUpperCase();
const sourceLabel=data.source==='approved-deidentified'?'Yêu cầu đã ẩn danh được cấp cho pilot':'Yêu cầu mô phỏng không chứa định danh khách hàng';
const html=readFileSync(new URL('judge.html',import.meta.url),'utf8');
const key={schema:'daitin-blind-key-v1',source:data.source,casesDigest:data.casesDigest,
  observationsDigest:createHash('sha256').update(raw).digest('hex'),packs:[]};
const used=new Set();
function nextCode(){
  let code;
  do {code=token();} while(used.has(code));
  used.add(code);
  return code;
}
for (const label of ['A','B']) {
  const packId='DT-'+nextCode();
  const mapping=[];
  const items=shuffle(data.items).map(item=>{
    const stage=(firstBefore.has(item.id)===(label==='A'))?'before':'after';
    const code=nextCode();
    mapping.push({code,caseId:item.id,stage});
    return {code,request:item.request,response:view(item,stage)};
  });
  assert.equal(mapping.filter(x=>x.stage==='before').length,15);
  key.packs.push({packId,label,mapping});
  const payload=JSON.stringify({id:packId,label:'Phiếu '+label,sourceLabel,items}).replace(/</g,'\\u003c');
  save(join(publicDir,'Cham-mu-'+label+'.html'),html.replace('__PAYLOAD__',()=>payload),0o644);
}
save(join(privateDir,'khoa-ghep.json'),JSON.stringify(key,null,2)+'\n',0o600);
save(join(privateDir,'quan-sat-ky-thuat.json'),raw,0o600);
console.log('Đã tạo hai phiếu 30 ca, mỗi phiếu cân bằng 15 trước và 15 sau.');

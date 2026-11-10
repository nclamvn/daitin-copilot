import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyIntake } from '../copilot/intake.mjs';

const cases=JSON.parse(readFileSync(new URL('../copilot/evals/cases.json',import.meta.url),'utf8'));
const {decisions}=JSON.parse(readFileSync(new URL('../copilot/evals/codex-decisions.json',import.meta.url),'utf8'));
const input=id=>({request:cases.find(c=>c.id===id).request,plan:structuredClone(decisions[id])});
const never=()=>assert.fail('Không được gọi công cụ');
const stub=()=>({resolution:{status:'grounded',form:null}});

test('LLM phải dẫn nguyên văn và không thể lấy ngày đối chiếu thay ngày tiếp nhận',()=>{
  const bad=input('I02');
  bad.plan.facts.receivedOn={value:'2026-07-01',quote:'Review as of 1 July 2026'};
  assert.throws(()=>applyIntake(bad,never,never),/vai trò/);
  const fabricated=input('I01');
  fabricated.plan.evidence=['some invented filing date'];
  assert.throws(()=>applyIntake(fabricated,never,never),/nguyên văn/);
});

test('giữ nguyên ngày viết bằng tháng tiếng Anh và ngày chứng minh trạng thái',()=>{
  let payload;
  const output=applyIntake(input('I02'),arg=>{payload=arg; return stub();},never);
  assert.equal(output.disposition,'prepare');
  assert.equal(payload.asOf,'2026-07-01');
  assert.equal(payload.receivedOn,'2026-06-30');
  assert.equal(payload.pendingAtCutover,true);
  const bad=input('I02');
  bad.plan.facts.pendingAtCutover.value=false;
  assert.throws(()=>applyIntake(bad,never,never),/Tình trạng/);
});

test('scope và quyền tác vụ có thể bác đề xuất LLM trước khi gọi công cụ',()=>{
  const bad=input('I06');
  bad.plan.decision='prepare';
  assert.equal(applyIntake(bad,never,never).reason,'scope');
  const dangerous=input('I07');
  dangerous.plan.decision='prepare';
  assert.equal(applyIntake(dangerous,never,never).reason,'high_stakes');
  const add=input('I05');
  add.plan.tools[0].kind='network';
  assert.throws(()=>applyIntake(add,never,never),/Công cụ/);
  add.plan.tools.push(...add.plan.tools);
  assert.throws(()=>applyIntake(add,never,never),/Tối đa/);
});

test('mô hình chọn hai công cụ khi địa chỉ đại diện khác thẩm quyền hồ sơ',()=>{
  const requested=[];
  const result=applyIntake(input('I05'),never,url=>{requested.push(url.searchParams.get('kind')); return {rows:[]};});
  assert.deepEqual(requested,['nice','event']);
  assert.equal(result.disposition,'research');
  const withScope=input('I05');
  withScope.request += ' Please also file in Cambodia.';
  assert.equal(applyIntake(withScope,never,never).disposition,'refer');
});

test('không biến tình trạng phủ định thành hồ sơ còn đang giải quyết', async()=>{
  const {bindIntakeFacts}=await import('../copilot/intake-facts.mjs');
  const bad=input('I02');
  bad.request=bad.request.replace('Still pending on','Not pending on');
  bad.plan.evidence[2]='Not pending on 2026-07-01';
  bad.plan.facts.pendingAtCutover.quote='Not pending on 2026-07-01';
  assert.equal(bindIntakeFacts(bad.request).status,null);
  assert.throws(()=>applyIntake(bad,never,never),/Tình trạng/);
});

test('tách vai trò ngày, chặn ngày tháng mơ hồ và hai ngày dự kiến xung đột',async()=>{
  const {bindIntakeFacts}=await import('../copilot/intake-facts.mjs');
  const role=bindIntakeFacts(input('I02').request);
  assert.equal(role.receivedOn.value,'2026-06-30');
  assert.equal(role.reviewOn.value,'2026-07-01');
  assert.equal(role.status.value,true);
  assert.equal(bindIntakeFacts('Vietnam trademark. Proposed filing date is 06/07/2026.').planned,null);
  assert.equal(bindIntakeFacts('Hồ sơ Việt Nam. Dự kiến nộp ngày 06/07/2026.').planned.value,'2026-07-06');
  assert.equal(bindIntakeFacts('Vietnam trademark. File on 2026-06-30 or file on 2026-07-01.').conflict,true);
});

test('H17 và H18 sửa câu hỏi khi đề xuất nhầm sang tình trạng chuyển tiếp',async()=>{
  const {bindIntakeFacts,buildBoundPlan,intakeQuestion}=await import('../copilot/intake-facts.mjs');
  const cases=JSON.parse(readFileSync(new URL('../copilot/evals/m2/blind-cases.json',import.meta.url),'utf8'));
  const plan={decision:'clarify',workflow:null,reason:'missing_pending',rationale:'Cần thêm dữ kiện.',tools:[]};
  for (const [id,reason,question] of [
    ['H17','missing_workflow','Cần sửa thông tin trên đơn đang xét hay trên văn bằng đã cấp?'],
    ['H18','missing_date','Ngày dự kiến nộp yêu cầu là ngày nào?']
  ]) {
    const {request}=cases.find(row=>row.id===id);
    const facts=bindIntakeFacts(request);
    const bound=buildBoundPlan(request,plan,facts);
    assert.equal(bound.reason,reason);
    assert.equal(intakeQuestion(reason,facts),question);
    assert.deepEqual(bound.tools,[]);
  }
  const crossing=input('I03').request;
  assert.equal(buildBoundPlan(crossing,plan,bindIntakeFacts(crossing)).reason,'missing_pending');
  const clearDates=input('I02').request;
  assert.equal(buildBoundPlan(clearDates,plan,bindIntakeFacts(clearDates)).reason,'insufficient_evidence');
});

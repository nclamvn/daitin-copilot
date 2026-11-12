import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const [origin, accountPath, receiptPath] = process.argv.slice(2);
const accounts = Object.fromEntries(JSON.parse(readFileSync(accountPath)).map(row => [row.name, row]));
const base = '/api/advice/private/';
async function request(path, name, body, expected = 200) {
  const user = accounts[name];
  const headers = { ...(user ? { Authorization: 'Basic ' + Buffer.from(user.name + ':' + user.key).toString('base64') } : {}) };
  if (body) Object.assign(headers, { 'Content-Type': 'application/json', Origin: origin });
  const response = await fetch(origin + path, { headers, method: body ? 'POST' : 'GET',
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(26000) });
  const data = response.headers.get('Content-Type')?.includes('json') ? await response.json() : await response.arrayBuffer();
  assert.equal(response.status, expected, path + ' · ' + (data?.error ?? ''));
  return data;
}

const fixture = name => readFileSync(new URL('../library/fixtures/' + name, import.meta.url));
const sources = [
  ['vn-renew-poa.docx', ['vn', 'tm', 'renew', 'poa'], 'signed', 'vn-team', null,
    'Hồ sơ cần POA có chữ ký của người đại diện theo pháp luật.', 'Hồ sơ cần giấy ủy quyền có chữ ký của người đại diện theo pháp luật.'],
  ['th-pct-poa.docx', ['th', 'pt', 'pct', 'poa'], 'notary', 'th-team', '2026-10-08',
    'Hướng dẫn chỉ áp dụng cho vào giai đoạn quốc gia PCT.', null],
  ['sg-renew-poa-old.docx', ['sg', 'tm', 'renew', 'poa'], 'new', 'sg-team', '2026-10-08',
    'Hướng dẫn cũ cần giấy ủy quyền mới.', null],
  ['sg-renew-poa.eml', ['sg', 'tm', 'renew', 'poa'], 'reuse-valid', 'sg-team', '2026-11-02',
    'Giữ nguyên đại diện thì có thể dùng lại POA còn hiệu lực và đủ phạm vi gia hạn.',
    'Có thể dùng lại giấy ủy quyền còn hiệu lực, bao gồm gia hạn và đứng tên cùng đại diện.'],
  ['th-annual-a.eml', ['th', 'pt', 'annuity', 'poa'], 'new', 'th-team', '2026-11-10',
    'Đoạn này chỉ dùng để kiểm việc nguồn chờ duyệt không lọt vào kết quả.', null],
];
await request(base + 'library', null, undefined, 401);
const imported = [];
for (const [name] of sources) {
  const payload = { name, owner: 'Đội nghiệm thu kỹ thuật', permission: 'Dữ liệu M10 mô phỏng dùng để kiểm tích hợp.',
    base64: fixture(name).toString('base64'), allowed: true };
  await request(base + 'import', 'nhap-nguon', { ...payload, allowed: false }, 400);
  const item = await request(base + 'import', 'nhap-nguon', payload);
  assert.ok(item.sha && item.paragraphs);
  assert.equal((await request(base + 'import', 'nhap-nguon', payload)).duplicate, true);
  imported.push(item);
}
const pending = await request(base + 'library', 'binh');
assert.equal(pending.docs.length, 5);
assert.equal(pending.approved.length, 0);
const absent = await request('/api/advice/research', 'binh', { query: 'Gia hạn nhãn hiệu tại Việt Nam có cần POA?' });
assert.equal(absent.kind, 'missing');
const approvals = [];
for (const [i, fields] of sources.slice(0, 4).entries()) {
  const [, scope, value, issuer, date, statement, clientText] = fields;
  const sha = imported[i].sha;
  const document = await request(base + 'document/' + sha, 'binh');
  const part = document.paragraphs.find(row => row.paragraph === 3);
  const proposal = { sha, paragraph: part.paragraph, digest: part.digest, scope, value, issuer, date, statement, clientText,
    confirmed: true, ...(i === 3 ? { supersedes: approvals[2].id } : {}) };
  await request(base + 'approve', 'nhap-nguon', proposal, 403);
  await request(base + 'approve', 'binh', { ...proposal, digest: '0'.repeat(64) }, 409);
  approvals.push(await request(base + 'approve', 'binh', proposal));
}
const rejectedId = 'r-' + imported[4].sha.slice(0, 18) + '-3';
await request('/api/advice/source/' + rejectedId, 'binh', undefined, 404);
const proof = await request('/api/advice/research', 'binh', { query: 'Singapore gia hạn nhãn hiệu có dùng lại POA không?' });
assert.equal(proof.kind, 'supported');
assert.deepEqual(proof.citations.map(row => row.state), ['active', 'superseded']);
assert.equal(proof.simulation, false);
assert.match(proof.email, /còn hiệu lực/);
assert.doesNotMatch(proof.email, /MÔ PHỎNG/);
assert.doesNotMatch(proof.body, /Tất cả/i);
const file = await request('/api/advice/source/' + approvals[3].id, 'binh');
assert.deepEqual(Buffer.from(file), fixture('sg-renew-poa.eml'));
console.log('Imported five DOCX/EML, excluded one pending source, validated exact downloads and review permissions.');

const plan = await request(base + 'pilot', 'binh', {
  title: 'Diễn tập kỹ thuật luồng nguồn M11', operator: 'binh', grader: 'cham-mu', mode: 'simulation',
  questions: ['Gia hạn nhãn hiệu tại Việt Nam có cần POA?', 'Niên phí sáng chế tại Thái Lan có cần POA?'],
  sources: approvals.map(row => row.id),
});
const path = base + 'pilot/' + plan.id;
await request(path + '/blind', 'cham-mu', undefined, 409);
await request(path + '/blind', 'binh', undefined, 403);
const perform = (caseIndex, arm, action, fields) => request(path + '/act', 'binh', { caseIndex, arm, action, ...fields });
await perform(0, 'direct', 'start').then(() => assert.fail('nhánh thứ hai chạy sớm'), error => assert.match(error.message, /Hoàn tất nhánh/));
const recorded = [];
for (const [caseIndex, arms] of [['copilot', 'direct'], ['direct', 'copilot']].entries()) {
  for (const arm of arms) {
    await perform(caseIndex, arm, 'start');
    await delay(30);
    const result = await perform(caseIndex, arm, 'generate');
    assert.equal(result.phase, 'paused');
    assert.ok(result.output, result.error);
    assert.ok(result.waitingMs > 0);
    await perform(caseIndex, arm, 'resume');
    await delay(30);
    const completed = await perform(caseIndex, arm, 'finish', {
      answer: result.output.answer || 'Người thử mô phỏng đã bổ sung rằng chưa đủ căn cứ để kết luận.', email: result.output.email, citations: result.output.citations,
    });
    assert.equal(completed.phase, 'complete');
    assert.ok(completed.activeMs > 0 && completed.waitingMs > completed.activeMs);
    recorded.push({ caseIndex, arm, kind: result.output.kind, citations: result.output.citations });
    console.log('Model completed', caseIndex, arm, result.output.kind);
  }
}
const blind = await request(path + '/blind', 'cham-mu');
assert.equal(blind.cases.length, 4);
assert.ok(blind.cases.every(row => !row.arm && !row.activeMs));
assert.ok(!JSON.stringify(blind).includes('elapsedMs'));
const grades = blind.cases.map(row => ({ code: row.code, decision: false, citation: false, conditions: false, draft: false,
  note: 'Kiểm kỹ thuật lưu phiếu. Không phải chấm của luật sư.' }));
await request(path + '/grade', 'cham-mu', { grades });
await request(path + '/report', 'cham-mu', undefined, 403);
const report = await request(path + '/report', 'binh');
assert.equal(report.mode, 'simulation');
assert.equal(report.summary.length, 2);
await request(base + 'withdraw', 'binh', { id: approvals[0].id });
await request('/api/advice/source/' + approvals[0].id, 'binh', undefined, 404);
await request(path + '/blind', 'cham-mu', undefined, 409);
writeFileSync(receiptPath, JSON.stringify({ data: 'synthetic', review: 'automation', files: 5, recorded, report }, null, 2) + '\n');
console.log('Private pilot verified: order, timing, same local model and snapshot, blind roles, grade and source-drift block.');

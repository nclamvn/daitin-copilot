import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { CaseError, hash } from '../copilot/m3/workflow.mjs';
import { createPatentService } from '../patents/service.mjs';
import { openPatentStore } from '../patents/store.mjs';
import { buildPatentPrompt } from '../patents/workflow.mjs';

const reviewer = { name: 'binh', role: 'reviewer', group: 'nhan-hieu' };
const peer = { ...reviewer, name: 'another-reviewer' };
const prefix = '/api/patents';
const call = (service, path, body, actor = reviewer) =>
  service.handle({ method: body === undefined ? 'GET' : 'POST' }, prefix + path, actor, async () => body);
const roles = ['notice', 'claim', 'd1'];
const real = { synthetic: false, anonymized: true };

test('anonymized patent pilot pins one approved PDF pack to a private owner and preserves two reviewed releases', async t => {
  mkdirSync('work', { recursive: true });
  const directory = mkdtempSync(resolve('work/patent-anonymized-pilot-'));
  const storePath = resolve(directory, 'case.sqlite');
  const files = Object.fromEntries(roles.map((role, index) => [role,
    readFileSync(new URL('../distribution/demo/DT-DEMO-0' + (index + 1) + '.pdf', import.meta.url))]));
  const approvedHashes = Object.fromEntries(roles.map(role => [role, hash(files[role])]));
  const approvedPilot = JSON.stringify(approvedHashes);
  const documents = roles.map(role => ({ role, content: files[role].toString('base64'), firstPage: 1, lastPage: 1 }));
  const bundle = { ...real, documents };
  let modelCalls = 0;
  let acceptModel = false;
  let modelInstructions;
  const service = createPatentService({ storePath, approvedPilot, model: async ({ matter }) => {
    modelCalls++;
    modelInstructions = matter.instructionsText;
    const prompt = buildPatentPrompt({ matter, targets: ['response'] }, { model: 'test', remote: false });
    assert.match(prompt.messages[0].content, /Hồ sơ đã ẩn danh/);
    assert.match(prompt.messages[1].content, /Chỉ dẫn nghiệp vụ của pilot ẩn danh/);
    if (!acceptModel) throw new CaseError('Model tạm thời không phản hồi.', 503);
    return { patch: { response: { text: 'Kiểm tra kích thước và vị trí theo đoạn đã chọn.', evidenceIds: matter.evidenceIds } } };
  } });
  const disabled = createPatentService({ storePath, approvedPilot: '{malformed' });
  const legacyStore = openPatentStore(storePath);
  t.after(() => { service.close(); disabled.close(); legacyStore.close(); rmSync(directory, { recursive: true, force: true }); });

  assert.equal((await call(disabled, '/status')).value.anonymizedPilot, undefined);
  assert.equal((await call(disabled, '/pdf-pack/inspect', bundle)).status, 403);
  assert.equal((await call(service, '/status', undefined, peer)).value.anonymizedPilot, undefined);
  assert.equal((await call(service, '/status', undefined, { ...reviewer, role: 'editor' })).value.anonymizedPilot, undefined);
  assert.equal((await call(service, '/status')).value.anonymizedPilot, true);
  assert.equal((await call(service, '/status')).value.responseRevision, true);
  assert.equal((await call(service, '/pdf-pack/inspect', bundle, null)).status, 401);
  assert.equal((await call(service, '/pdf-pack/inspect', bundle, peer)).status, 403);
  assert.equal((await call(service, '/pdf-pack/inspect', { synthetic: true, documents })).status, 422);
  assert.equal((await call(service, '/pdf-pack/inspect', { ...bundle, documents: [
    { ...documents[0], content: documents[1].content }, ...documents.slice(1)
  ] })).status, 422);
  const inspected = (await call(service, '/pdf-pack/inspect', bundle)).value.documents;
  const selections = inspected.map((item, index) => {
    const [{ text, page }] = item.pages;
    const excerpt = text.split('\n').find(line => line.trim().length >= 10).trim();
    const start = text.indexOf(excerpt);
    return { ...documents[index], label: 'Tài liệu pilot ' + item.role, sha256: item.sha256, page, start,
      end: start + excerpt.length, text: excerpt, confirmed: true };
  });
  const { role, content, sha256, page } = selections[2];
  const preview = { ...real, role, content, sha256, page };
  assert.equal((await call(service, '/pdf-pack/preview', preview, peer)).status, 403);
  assert.equal((await call(service, '/pdf-pack/preview', { ...preview, role: 'claim' })).status, 422);
  assert.equal((await call(service, '/pdf-pack/preview', preview)).headers['X-Source-SHA256'], sha256);
  const create = { ...real, documents: selections, reference: 'PRIVATE-TRIAL', title: 'Hồ sơ kiểm thử ẩn danh',
    jurisdiction: 'VN', asOf: '2026-11-11', instructionsText: 'Đọc đúng đoạn đã gắn.' };
  assert.equal((await call(service, '/cases/pdf-pack', create, peer)).status, 403);
  assert.equal((await call(service, '/cases', create)).status, 422);
  const created = await call(service, '/cases/pdf-pack', create);
  assert.equal(created.status, 201);
  let matter = created.value;
  const path = '/cases/' + matter.id;
  assert.deepEqual([matter.synthetic, matter.anonymized], [false, true]);
  assert.match(matter.group, /^@patent-pilot:[a-f0-9]{64}$/);
  assert.deepEqual(legacyStore.list(reviewer.group), []);
  assert.equal((await call(service, '/cases')).value.length, 1);
  assert.deepEqual((await call(service, '/cases', undefined, peer)).value, []);
  assert.deepEqual((await call(disabled, '/cases')).value, []);
  assert.equal((await call(service, '/cases/pdf-pack', { ...create, reference: 'SECOND-PACK' })).status, 409);
  assert.equal((await call(service, path, undefined, peer)).status, 404);
  assert.equal((await call(disabled, path)).status, 404);
  for (const document of matter.documents) {
    assert.deepEqual((await call(service, document.openUrl.slice(prefix.length))).value, files[document.role]);
    assert.equal((await call(service, document.openUrl.slice(prefix.length), undefined, peer)).status, 404);
    assert.equal((await call(service, document.pageUrl.slice(prefix.length), undefined, peer)).status, 404);
    assert.equal((await call(disabled, document.openUrl.slice(prefix.length))).status, 404);
  }
  assert.equal((await call(service, path + '/pdf/bind', { version: matter.version })).status, 422);
  assert.equal((await call(service, path + '/source', { version: matter.version, evidenceIds: [],
    instructionsText: 'Đổi nguồn.' })).status, 422);
  assert.equal((await call(service, path + '/propose', { version: matter.version, targets: ['response'] }, peer)).status, 404);
  assert.equal((await call(disabled, path + '/propose', { version: matter.version, targets: ['response'] })).status, 404);
  assert.equal((await call(service, path + '/propose', { version: matter.version, targets: ['response'], instructionsText: 'Bản mới.' })).status, 422);
  assert.equal(modelCalls, 0);
  const matrixRows = [{ feature: 'Dấu hiệu đang đối chiếu', claimQuote: matter.claimText,
    d1Quote: selections[2].text, d1RecordId: matter.d1RecordIds[0], assessment: 'uncertain',
    analysis: 'Đoạn đã chọn cần kiểm thêm.', missing: 'Cần rà nguồn.' }];
  matter = (await call(service, path + '/edit', { version: matter.version, matrixRows,
    response: { text: 'Chờ đối chiếu bản gốc.', evidenceIds: matter.evidenceIds } })).value;
  matter = (await call(service, path + '/approve', { version: matter.version, targets: ['matrix'], reviewed: true })).value;
  assert.equal(matter.releases.length, 0);
  matter = (await call(service, path + '/approve', { version: matter.version, targets: ['response'], reviewed: true })).value;
  assert.equal(matter.releases.length, 1);
  const matrixApproval = matter.sections.matrix.approval.sha256;
  const word1 = (await call(service, path + '/word/1')).value;
  assert.ok(word1.includes(Buffer.from('Hồ sơ đã ẩn danh')));
  assert.equal((await call(service, path + '/word/1', undefined, peer)).status, 404);
  assert.equal((await call(disabled, path + '/word/1')).status, 404);

  const revision = { version: matter.version, targets: ['response'], instructionsText: 'Chỉ rõ cách kiểm tra kích thước.' };
  assert.equal((await call(service, path + '/propose', revision)).status, 503);
  const unchanged = (await call(service, path)).value;
  assert.equal(unchanged.version, matter.version);
  assert.equal(unchanged.instructionsText, matter.instructionsText);
  assert.equal(unchanged.sections.response.approval.sha256, matter.sections.response.approval.sha256);
  assert.deepEqual((await call(service, path + '/word/1')).value, word1);
  acceptModel = true;
  matter = (await call(service, path + '/propose', revision)).value;
  assert.equal(matter.version, unchanged.version + 1);
  assert.equal(modelInstructions, revision.instructionsText);
  assert.equal(matter.instructionsText, revision.instructionsText);
  assert.equal(matter.sections.matrix.approval.sha256, matrixApproval);
  assert.equal(matter.sections.response.approval, null);
  matter = (await call(service, path + '/approve', { version: matter.version, targets: ['response'], reviewed: true })).value;
  assert.equal(matter.releases.length, 2);
  assert.equal(matter.releases[1].synthetic, false);
  assert.equal(matter.releases[1].anonymized, true);
  assert.deepEqual((await call(service, path + '/word/1')).value, word1);
  assert.notDeepEqual((await call(service, path + '/word/2')).value, word1);
  assert.equal((await call(service, path + '/propose', { ...revision, version: matter.version })).status, 409);
  assert.equal(modelCalls, 2);
});

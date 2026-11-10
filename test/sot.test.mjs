import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSot, validateApproval, validateBundle } from '../sot/bundle.mjs';
import { buildCandidate, makePdfReader } from '../sot/technical.mjs';

const inputs = JSON.parse(readFileSync(new URL('../sot/source_canonical/inputs.json', import.meta.url)));
const reader = makePdfReader(inputs.registry.documents);
const staged = loadSot('preview');
const appDir = fileURLToPath(new URL('..', import.meta.url));
const change = edit => {
  const edited = structuredClone(inputs);
  edit(edited);
  return edited;
};
const assertRejected = (edit, expected) => assert.throws(() => buildCandidate(change(edit), reader), expected);

test('cùng đầu vào tái dựng đúng mã bản ứng viên và 29 vị trí bằng chứng', () => {
  const one = buildCandidate(inputs, reader);
  const two = buildCandidate(inputs, reader);
  assert.equal(one.digest, staged.digest);
  assert.equal(one.digest, two.digest);
  assert.equal(Object.keys(one.payload.pageProof).length, 29);
  assert.equal(one.payload.pageProof['renewal-tt10-02'].method, 'ocr');
  assert.equal(one.payload.pageProof['certificate-tt20-02'].page, 8);
  assert.equal(Object.keys(one.payload.registry.documents).length, 7);
});

test('chặn trang còn nằm trong PDF nhưng trỏ sai đoạn', () => {
  assertRejected(data => { data.registry.provisions['tt10-68-1'].page = 75; }, /SPAN_NOT_FOUND.*tt10-68-1/);
});

test('chặn mẫu đúng tên nhưng số ấn hành bị sửa', () => {
  assertRejected(data => { data.registry.forms['certificate-tt20-02'].number = '03'; },
    /FORM_NUMBER.*certificate-tt20-02/);
});

test('chặn điều khoản bị gán nhầm và câu trích không có trên trang', () => {
  assertRejected(data => { data.registry.cutoverBasis.transition = 'tt20-16'; }, /TRANSITION_SOURCE/);
  assertRejected(data => { data.registry.provisions['tt20-17-2'].quote = 'phải chuyển sang dùng mẫu mới'; },
    /QUOTE_NOT_FOUND.*tt20-17-2/);
});

test('chặn mất điều chuyển tiếp và chồng lấn thời gian phiên bản', () => {
  assertRejected(data => { delete data.registry.cutoverBasis.transition; }, /TRANSITION_MISSING/);
  assertRejected(data => { data.registry.forms['renewal-tt10-02'].until = '2026-07-02'; }, /VERSION_INTERVAL/);
});

test('chặn ngày hiệu lực suy ra sai khi ngày trên nguồn vẫn như cũ', () => {
  assertRejected(data => {
    data.registry.cutover = '2026-07-02';
    for (const form of Object.values(data.registry.forms)) {
      if (form.from === '2026-07-01') form.from = '2026-07-02';
      if (form.until === '2026-07-01') form.until = '2026-07-02';
    }
  }, /CUTOVER_SOURCE/);
});

test('chặn nguồn ngoài danh mục và bản PDF lệch SHA-256', () => {
  assertRejected(data => { data.registry.documents.tt20.url = 'https://example.org/tt20.pdf'; }, /SOURCE_RIGHTS/);
  const altered = change(data => { data.registry.documents.tt20.sha256 = '0'.repeat(64); });
  assert.throws(() => buildCandidate(altered), /SNAPSHOT_HASH.*tt20/);
});

test('thay bất kỳ nội dung trong bản ứng viên làm hỏng dấu kiểm', () => {
  const altered = structuredClone(staged);
  altered.payload.registry.forms['certificate-tt20-02'].page = 7;
  assert.throws(() => validateBundle(altered, 'preview'), /DẤU KIỂM/);
});

test('cổng duyệt chặn thiếu duyệt, sai mã, trùng vai trò và thiếu ca', () => {
  const approval = {
    decision: 'approved', digest: staged.digest, scope: staged.payload.scope.id, approvedOn: '2026-11-10',
    owner: { role: staged.payload.scope.ownerRole, name: 'Người mô phỏng A' },
    reviewer: { role: staged.payload.scope.reviewerRole, name: 'Người mô phỏng B' },
    reviewedCases: staged.payload.reviewCases.map(row => row.id)
  };
  assert.doesNotThrow(() => validateApproval(approval, staged));
  assert.throws(() => validateApproval(null, staged), /PHÊ DUYỆT/);
  assert.throws(() => validateApproval({ ...approval, digest: '0'.repeat(64) }, staged), /đúng mã/);
  assert.throws(() => validateApproval({ ...approval, reviewer: { ...approval.reviewer, name: approval.owner.name } }, staged),
    /hai người/);
  assert.throws(() => validateApproval({ ...approval, reviewedCases: approval.reviewedCases.slice(1) }, staged), /chưa được xác nhận/);
  assert.throws(() => validateBundle(staged, 'published'), /PHÊ DUYỆT/);
});

test('MVP đối chiếu toàn bộ bộ ca dùng chính bản ứng viên', () => {
  const output = execFileSync(process.execPath, ['sot/verify-cases.mjs', staged.digest], {
    cwd: appDir, env: { ...process.env, DAI_TIN_CORPUS_MODE: 'preview' }, encoding: 'utf8'
  });
  assert.match(output, /PASS 11 ca nghiệp vụ/);
});

test('MVP tra đúng bản hợp nhất, thông báo và văn bản sửa Luật', () => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { getCatalog, search } from './research.mjs';
    console.log(JSON.stringify({
      catalog: getCatalog(),
      law: search('Điều 93 khoản 6 Luật Sở hữu trí tuệ'),
      transitional: search('Điều 3 khoản 1 Luật số 131/2025/QH15'),
      rules: search('Điều 108 khoản 3 06/VBHN-BKHCN'),
      guidance: search('Thông báo số 4863/TB-SHTT'),
      unsupported: search('Điều 93 khoản 6 Luật Sở hữu trí tuệ số 11/2026/QH16'),
      base: search('Điều 3 khoản 1 Luật Sở hữu trí tuệ')
    }));
  `], { cwd: appDir, env: { ...process.env, DAI_TIN_CORPUS_MODE: 'preview' }, encoding: 'utf8' });
  const data = JSON.parse(output);
  assert.equal(data.catalog.dataStatus, 'preview');
  assert.equal(data.catalog.releaseDigest, staged.digest);
  assert.equal(data.law.hits[0].snapshotUrl, '/sources/vbhn160.pdf#page=61');
  assert.equal(data.transitional.hits[0].snapshotUrl, '/sources/vbhn160.pdf#page=139');
  assert.equal(data.rules.hits[0].snapshotUrl, '/sources/vbhn06.pdf#page=116');
  assert.ok(data.guidance.hits.some(row => row.snapshotUrl === '/sources/notice4863.pdf#page=2'));
  assert.equal(data.unsupported.hits.length, 0);
  assert.equal(data.base.hits.length, 0);
});

test('MVP chế độ phát hành chưa tự chuyển sang ứng viên khi thiếu bản được duyệt', {
  skip: existsSync(new URL('../sot/published.json', import.meta.url))
}, () => {
  assert.throws(() => loadSot('published'), /chưa có bản được luật sư duyệt/);
});

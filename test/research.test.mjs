import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createServer } from '../server.mjs';
import { getCatalog, getEvidence, InputError, resolveProcedure, search } from '../research.mjs';

const base = { procedure: 'renewal', mode: 'case', asOf: '2026-07-02', receivedOn: '2026-06-30', pendingAtCutover: true };
const resolve = extra => resolveProcedure({ ...base, ...extra });

test('hồ sơ gia hạn trước mốc đang xử lý mở đúng Mẫu 02 cũ, không gọi là bản hiện hành', () => {
  const result = resolve();
  assert.equal(result.rule, 'transition');
  assert.equal(result.applicableOn, '2026-06-30');
  assert.equal(result.form.id, 'renewal-tt10-02');
  assert.equal(result.form.editionStatus, 'historical');
  assert.equal(result.form.snapshotUrl, '/sources/tt10-pl2.pdf#page=4');
  assert.equal(result.citations.find(x => x.id === 'tt20-17-2').snapshotUrl, '/sources/tt20.pdf#page=14');
});

test('biên đúng ngày 01/07 dùng mẫu gia hạn mới', () => {
  const result = resolve({ asOf: '2026-07-01', receivedOn: '2026-07-01', pendingAtCutover: null });
  assert.equal(result.rule, 'from_cutover');
  assert.equal(result.form.id, 'renewal-tt20-01');
  assert.equal(result.form.snapshotUrl, '/sources/tt20-pl.pdf#page=5');
  assert.deepEqual(result.citations.map(x => x.id), ['tt20-11', 'tt20-16', 'tt20-18-2']);
});

test('mốc đối chiếu 30/06 chưa yêu cầu tình trạng tại 01/07', () => {
  const result = resolve({ asOf: '2026-06-30', pendingAtCutover: null });
  assert.equal(result.rule, 'before_cutover');
  assert.equal(result.form.id, 'renewal-tt10-02');
  assert.equal(result.citations[0].locator, 'Điều 109 khoản 3 điểm a');
});

test('thiếu tình trạng chuyển tiếp giữ nguyên căn cứ nhưng chưa chọn mẫu', () => {
  const result = resolve({ pendingAtCutover: null });
  assert.equal(result.status, 'needs_context');
  assert.deepEqual(result.missing, ['pendingAtCutover']);
  assert.equal(result.form, null);
  assert.deepEqual(result.versions, []);
});

test('hồ sơ đã giải quyết chỉ cho đối chiếu lịch sử', () => {
  const result = resolve({ pendingAtCutover: false });
  assert.equal(result.status, 'historical');
  assert.equal(result.form.editionStatus, 'historical');
  assert.equal(result.form.id, 'renewal-tt10-02');
});

test('chọn mẫu sửa văn bằng cũ và mới cùng chuỗi căn cứ thay mẫu', () => {
  const historical = resolve({ procedure: 'certificate_amendment' });
  assert.equal(historical.form.snapshotUrl, '/sources/tt10-pl2.pdf#page=7');
  assert.equal(historical.form.number, '03');
  const current = resolve({ procedure: 'certificate_amendment', receivedOn: '2026-07-01', pendingAtCutover: null });
  assert.equal(current.form.id, 'certificate-tt20-02');
  assert.equal(current.form.snapshotUrl, '/sources/tt20-pl.pdf#page=8');
  assert.ok(current.citations.some(x => x.id === 'tt20-12' && x.page === 8));
  assert.ok(current.citations.some(x => x.id === 'tt20-16' && x.page === 13));
});

test('nộp mới chọn Mẫu 04, sửa đơn chủ động chọn Mẫu 10 ở Phụ lục I', () => {
  const planned = { mode: 'prepare', asOf: '2026-11-10', receivedOn: null, pendingAtCutover: null };
  const filing = resolve({ ...planned, procedure: 'registration' });
  const amend = resolve({ ...planned, procedure: 'application_amendment' });
  assert.equal(filing.form.snapshotUrl, '/sources/tt10.pdf#page=177');
  assert.equal(filing.citations[0].locator, 'Điều 68 khoản 1');
  assert.equal(amend.form.snapshotUrl, '/sources/tt10.pdf#page=198');
  assert.equal(amend.citations[0].locator, 'Điều 83 khoản 2 điểm a');
});

test('phản hồi thông báo thẩm định dùng văn bản phản hồi theo điểm b', () => {
  const result = resolve({ procedure: 'office_response' });
  assert.equal(result.status, 'grounded');
  assert.equal(result.form, null);
  assert.match(result.title, /văn bản phản hồi/);
  assert.equal(result.citations[0].id, 'tt10-83-2b');
});

test('thiếu ngày tiếp nhận hoặc nằm ngoài nguồn thì chặn chọn mẫu', () => {
  assert.deepEqual(resolve({ receivedOn: null }).missing, ['receivedOn']);
  for (const extra of [{ receivedOn: '2026-03-31' }, { asOf: '2026-11-11' }]) {
    const result = resolve(extra);
    assert.equal(result.status, 'out_of_coverage');
    assert.equal(result.form, null);
  }
});

test('kiểm ngày thực, thứ tự mốc và không nhận dữ kiện chuyển tiếp trong chế độ chuẩn bị nộp', () => {
  for (const extra of [{ asOf: '2026-02-30' }, { receivedOn: '2026-07-03' }, { mode: 'prepare' }, { pendingAtCutover: 'yes' }, { procedure: '__proto__' }]) {
    assert.throws(() => resolve(extra), InputError);
  }
});

test('tìm số điều khoản điểm chỉ trả đúng locator và gắn trang vật lý PDF', () => {
  const result = search('Điều 17 khoản 2 Thông tư 20/2026/TT-BKHCN');
  assert.deepEqual(result.hits.map(x => x.id), ['tt20-17-2']);
  assert.equal(result.hits[0].originalUrl.split('#')[1], 'page=14');
  assert.equal(result.procedure, null);
  assert.deepEqual(search('Điều 17 khoản 3').hits, []);
  assert.deepEqual(search('Điều 17 Nghị định 100/2026/NĐ-CP').hits, []);
  assert.deepEqual(search('Điều 999 TT 20/2026').hits, []);
  assert.equal(getEvidence('tt10-68-1').page, 76);
});

test('Điều 110 khoản 3 điểm a có bản trước và văn bản sửa đổi, xếp bản hợp mốc trước', () => {
  const query = 'Điều 110 khoản 3 điểm a Thông tư 10/2026';
  assert.deepEqual(search(query, '2026-06-30').hits.map(x => x.id), ['tt10-110-3a', 'tt20-12']);
  assert.deepEqual(search(query, '2026-07-01').hits.map(x => x.id), ['tt20-12', 'tt10-110-3a']);
});

test('gợi ý thủ tục từ tiếng Việt không dấu, ngày trong câu không bị hiểu thành số hiệu', () => {
  assert.equal(search('cho xin mau gia han nhan hieu ngay 30/06/2026').procedure, 'renewal');
  assert.equal(search('Sửa đổi đơn đăng ký nhãn hiệu').procedure, 'application_amendment');
  assert.equal(search('Sửa đổi đơn theo thông báo kết quả thẩm định').procedure, 'office_response');
  assert.equal(search('trademark registration').procedure, 'registration');
  assert.equal(search('Sửa đổi văn bằng và gia hạn nhãn hiệu').procedure, null);
});

test('câu hỏi rủi ro hoặc ngoài thẩm quyền không chuyển thẳng sang chọn mẫu', () => {
  const deadline = search('Hạn cuối gia hạn nhãn hiệu là ngày nào?');
  assert.equal(deadline.status, 'needs_review');
  assert.equal(deadline.procedure, null);
  assert.equal(search('Gia hạn nhãn hiệu theo Madrid').status, 'out_of_scope');
  assert.deepEqual(search('Tình trạng sáng chế nước ngoài').hits, []);
});

test('mở qua HTTP: app, API thật, nguồn PDF có hash đúng và chặn truy cập ngoài phạm vi', async t => {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const get = async path => fetch(url + path);
  const post = (path, body, extra = {}) => fetch(url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body)
  });
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Tra cứu nhãn hiệu/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await (await get('/api/catalog')).json()).release, getCatalog().release);
  const answer = await (await post('/api/resolve', base)).json();
  const pdf = await get(answer.form.snapshotUrl);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), answer.form.sha256);
  assert.equal((await post('/api/resolve', { ...base, asOf: '2026-02-31' })).status, 400);
  assert.equal((await post('/api/search', { query: 'gia hạn' }, { Origin: 'https://example.org' })).status, 403);
  assert.equal((await get('/corpus/vn-trademark.json')).status, 404);
  assert.equal((await get('/sources/%2e%2e/server.mjs')).status, 404);
});

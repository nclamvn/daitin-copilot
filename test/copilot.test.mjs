import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';

process.env.DAI_TIN_CORPUS_MODE = 'preview';
const { getCatalog, resolveProcedure, search } = await import('../research.mjs');
const { createCopilot } = await import('../copilot/service.mjs');
const candidate = JSON.parse(readFileSync(new URL('../sot/candidate.json', import.meta.url)));
let app;
before(() => { app = createCopilot(getCatalog(),resolveProcedure); });
after(() => app?.close());

const query = (kind,q,rest={}) => app.search(new URL('http://localhost/?' + new URLSearchParams({kind,q,...rest})));
const renew = {procedure:'renewal',mode:'case',asOf:'2026-07-01',receivedOn:'2026-06-30'};
const known = {procedure:'registration',mode:'prepare',asOf:'2026-11-10'};

test('bản chỉ mục, SOT và danh mục nguồn dùng đúng dấu kiểm', () => {
  const catalog=app.handleGet(new URL('http://localhost/api/copilot/catalog')).value;
  assert.equal(catalog.parentSotDigest,candidate.digest);
  assert.equal(catalog.sources.length,26);
  assert.equal(catalog.events.rows,43239);
  assert.equal(catalog.editions['2026'].vnLocated,10123);
  assert.equal(catalog.editions['2027'].vnLocated,0);
  assert.ok(catalog.lawPages>=690);
  assert.equal(catalog.claims,22);
  const evidence = app.handleGet(new URL('http://localhost/copilot/source/tt10.pdf')).value;
  assert.equal(createHash('sha256').update(evidence).digest('hex'),candidate.payload.registry.documents.tt10.sha256);
  assert.equal(app.handleGet(new URL('http://localhost/copilot/source/tm-events.xlsx')),null);
  assert.throws(()=>createCopilot({...getCatalog(),releaseDigest:'0'.repeat(64)},resolveProcedure),/thuộc bản SOT khác/);
});

test('dữ liệu thật của Cục khớp ngày và dòng của số đơn đã biết', () => {
  const got=query('event','4-2026-11740');
  assert.deepEqual({...got.rows[0]},{row:6,application:'4-2026-11740',filed:'2026-03-20',transferred:'2026-04-10',posted_week:'Tuần 15'});
  assert.equal(got.rows.length,1);
  assert.match(got.notice,/Tình trạng hiện tại/);
  assert.equal(query('event','4-2026-999999').rows.length,0);
  assert.throws(()=>query('event','4-2026'),/đầy đủ/);
});

test('hai phiên bản Nice tách riêng và mã có đúng trang tiếng Việt', () => {
  const v=query('nice','090001').rows[0];
  assert.match(v.vn,/Cuộn dây điện/);
  assert.match(v.en,/coils, electric/);
  assert.ok(v.fr);
  assert.equal(v.vnEvidence.page,92);
  assert.equal(query('nice','090001',{class:'10'}).rows.length,0);
  assert.ok(query('nice','ca phe').rows.some(row=>row.class===30));
  const future=query('nice','090001',{edition:'2027'});
  assert.equal(future.rows[0].vnEvidence,null);
  assert.match(future.notice,/chưa được xác nhận áp dụng/);
});

test('tra bản Công báo của Luật 131 và xử lý từ khóa như văn bản thuần', () => {
  const result=query('law','Điều khoản chuyển tiếp',{source:'law131-cb'});
  assert.ok(result.rows.length);
  assert.equal(result.rows[0].page,24);
  assert.ok(result.rows.every(row=>row.source==='law131-cb'));
  assert.ok(result.rows.some(row=>row.excerpt.toLowerCase().includes('chuyển tiếp')));
  assert.throws(()=>query('law','???'),/từ khóa/);
  assert.equal(query('law','" OR zzzzz',{source:'tt10'}).rows.length,0);
});

test('thiếu tình trạng chuyển tiếp chặn cả mẫu và checklist', () => {
  const blocked=app.review({...renew,flags:{proxy:'yes'}});
  assert.equal(blocked.resolution.rule,'missing_pending');
  assert.equal(blocked.resolution.form,null);
  assert.deepEqual(blocked.checklist,[]);
  const closed=app.review({...renew,pendingAtCutover:false,flags:{proxy:'yes'}});
  assert.equal(closed.resolution.status,'historical');
  assert.deepEqual(closed.checklist,[]);
});

test('hồ sơ chuyển tiếp dùng khoản 3 và chỉ chọn checklist trước mốc', () => {
  const old=app.review({...renew,pendingAtCutover:true,flags:{proxy:'yes',recordOnPaper:'no'}});
  assert.equal(old.resolution.form.id,'renewal-tt10-02');
  assert.equal(old.resolution.citations[0].locator,'Điều 109 khoản 3 điểm a');
  assert.deepEqual(search('Điều 109 khoản 2 điểm a Thông tư 10/2026').hits,[]);
  assert.ok(old.checklist.every(row=>row.id.startsWith('renew-old')));
  assert.ok(old.checklist.some(row=>row.id==='renew-old-poa'&&row.state==='review'));
  assert.ok(old.checklist.some(row=>row.id==='renew-old-partial'&&row.state==='confirm'));
  assert.ok(!old.checklist.some(row=>row.id==='renew-old-original'));
});

test('checklist chặn cờ sai, phân biệt hồ sơ giấy và bỏ qua khi ngoài ngày chốt', () => {
  const data=app.review({...known,flags:{paper:'yes',proxy:'unknown',collective:'no'}});
  assert.equal(data.resolution.form.number,'04');
  assert.equal(data.checklist.find(row=>row.id==='reg-paper').state,'review');
  assert.equal(data.checklist.find(row=>row.id==='reg-authorization').state,'confirm');
  assert.equal(data.checklist.some(row=>row.id==='reg-rules'),false);
  assert.throws(()=>app.review({...known,flags:{unrelated:'yes'}}),/checklist/);
  assert.deepEqual(app.review({...known,asOf:'2026-11-11'}).checklist,[]);
});

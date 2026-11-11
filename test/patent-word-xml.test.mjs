import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDataset } from '../patents/dataset.mjs';
import { openPatentStore } from '../patents/store.mjs';
import { createPatentWorkflow, buildPatentPrompt } from '../patents/workflow.mjs';
import { makePatentWord, makePatentWordV2, patentWordRendererV2 } from '../patents/word.mjs';
import { digest } from '../sot/bundle.mjs';

const actor = { name: 'xml-review-fixture', group: 'xml-protocol-test', role: 'reviewer' };
function releaseFixture(t, { structuralOnly = true } = {}) {
  mkdirSync('work', { recursive: true });
  const directory = mkdtempSync(resolve('work/patent-word-xml-'));
  const store = openPatentStore(resolve(directory, 'cases.sqlite'));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const dataset = structuralOnly ? structuredClone(loadDataset()) : loadDataset();
  if (structuralOnly) {
    // Formatter-only historical fixture, never production curation/approval.
    // Preserve the exact OCR text including known page-header junk and FF.
    // Only the test clone omits the block so the XML formatter can be exercised.
    const record = dataset.records.find(item => item.id === 'vn-patent-42110-claim-1');
    delete record.knownExtractionWarning;
    delete dataset.sources.find(item => item.id === record.sourceId).knownExtractionWarning;
  }
  const claim = dataset.records.find(item => item.id === 'vn-patent-42110-claim-1');
  const d1 = dataset.records.find(item => item.id === 'ep-ep1004359b1-claim-1');
  assert.ok(claim.text.includes('\f'), 'The real captured VN claim retains a page-layout separator.');
  const index = claim.text.indexOf('\f');
  const workflow = createPatentWorkflow(store, dataset);
  let matter = workflow.create({ synthetic: true, title: 'Kiểm định XML, không đánh giá nội dung pháp lý', reference: 'VN-XML-TEST',
    claimText: claim.text, claimVersion: claim.id, claimRecordId: claim.id, d1RecordIds: [d1.id], evidenceIds: [claim.id, d1.id],
    noticeText: 'Thông báo mô phỏng: kiểm định định dạng xuất Word.', instructionsText: 'Chỉ kiểm tra kỹ thuật XML; không chấm nội dung pháp lý.',
    jurisdiction: 'VN', asOf: dataset.builtAt.slice(0, 10) }, actor);
  matter = workflow.edit(matter.id, { version: matter.version, matrixRows: [{ feature: 'Hàng kiểm định định dạng',
    claimQuote: claim.text.slice(Math.max(0, index - 80), index + 80), d1RecordId: d1.id, d1Quote: d1.text.slice(0, 100),
    assessment: 'uncertain', analysis: 'Dữ liệu chỉ dùng kiểm định định dạng, không phải phân tích chuyên môn.', missing: 'Cần luật sư đối chiếu chuyên môn.' }],
    response: { text: 'Bản mô phỏng kiểm tra khả năng xuất Word. Không đưa ra kết luận nghiệp vụ.', evidenceIds: ['case:notice'] } }, actor);
  if (!structuralOnly) return { matter, workflow };
  matter = workflow.approve(matter.id, { version: matter.version, targets: ['matrix', 'response'] }, actor);
  const release = workflow.release(matter.id, 1, actor);
  assert.equal(release.claimText, claim.text.trim());
  assert.equal(release.pinnedEvidence.find(item => item.record.id === claim.id).record.text, claim.text);
  return release;
}

function legacyFixture(t) {
  const { sha256, artifact, ...content } = releaseFixture(t);
  content.template = 'daitin-patent-v1';
  return { ...content, sha256: digest(content) };
}

test('formatter-only clone of VN42110 raw OCR crossing pages exports valid XML without changing the stored quote', t => {
  const release = legacyFixture(t);
  const bytes = makePatentWord(release);
  const result = execFileSync('python3', ['-c', `import io,zipfile,xml.etree.ElementTree as E,sys
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
files=[n for n in z.namelist() if n.endswith('.xml') or n.endswith('.rels')]
for n in files:E.fromstring(z.read(n))
doc=E.fromstring(z.read('word/document.xml'))
text=''.join(doc.itertext())
assert 'U+000C' in text
assert '\\x0c' not in text
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
assert doc.findall('.//w:br',ns)
print(len(files))`], { input: bytes, encoding: 'utf8' });
  assert.ok(Number(result.trim()) >= 5);
  assert.ok(release.claimText.includes('\f'));
});

test('patent Word rejects XML-forbidden controls and lone surrogates instead of emitting broken documents', t => {
  const release = legacyFixture(t);
  for (const invalid of ['\u0000', '\u0001', '\u000b', '\ud800', '\ufffe']) {
    const { sha256, ...content } = structuredClone(release);
    content.sections.response.text += invalid;
    assert.throws(() => makePatentWord({ ...content, sha256: digest(content) }), { status: 422 });
  }
});

test('Word v2 preserves selected PDF text and provenance without exporting internal routes', t => {
  const { sha256, artifact, ...content } = releaseFixture(t);
  const d1 = content.pinnedEvidence.find(item => item.record.id === content.d1RecordIds[0]);
  const quote = 'Độ dài L < 5 mm và khe dẫn 10 µm.\nĐộ mở góc 30°.';
  const document = { recordId: 'pdf-fixture', role: 'd1', label: 'Đối chứng mô phỏng.pdf', page: 4,
    sha256: 'a'.repeat(64), textSha256: 'b'.repeat(64) };
  d1.record = { ...d1.record, id: document.recordId, locator: { page: document.page }, text: quote,
    textFidelity: 'pdf_text_user_confirmed' };
  d1.source = { title: document.label, sha256: document.sha256, kind: 'case_document', url: '/api/PRIVATE-ROUTE' };
  d1.openUrl = '/api/PRIVATE-ROUTE';
  content.template = patentWordRendererV2;
  content.documents = [document];
  content.d1RecordIds = [document.recordId];
  Object.assign(content.sections.matrix.rows[0], { d1RecordId: document.recordId, d1Quote: quote });
  content.sections.matrix.approval.reviewedEvidence = true;
  const release = { ...content, sha256: digest(content) };
  const bytes = makePatentWordV2(release);
  assert.deepEqual(bytes, makePatentWordV2(content));
  assert.throws(() => makePatentWordV2({ ...release, sha256: '0'.repeat(64) }), { status: 409 });
  assert.throws(() => makePatentWordV2({ ...content, sections: {
    ...content.sections, response: { ...content.sections.response, approval: null }
  } }), { status: 409 });
  const result = execFileSync('python3', ['-c', `import io,zipfile,xml.etree.ElementTree as E,sys
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
for n in z.namelist():
    if n.endswith(('.xml','.rels')): E.fromstring(z.read(n))
assert 'word/media/daitin-gray.png' in z.namelist()
doc=E.fromstring(z.read('word/document.xml'))
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
text=''.join(doc.itertext())
assert 'Đối chứng mô phỏng.pdf' in text
display=text.replace('\\u00a0',' ')
assert 'Trang PDF 4' in display
assert 'SHA-256 bản gốc ' + 'a'*64 in text
assert 'SHA-256 đoạn đã chọn ' + 'b'*64 in text
assert 'Đã xác nhận rà soát chứng cứ' in display
assert '/api/PRIVATE-ROUTE' not in text
assert not doc.findall('.//w:tbl/w:tblGrid/w:gridCol[4]',ns)
def paragraph(p):
    return ''.join((i.text or '') if i.tag.endswith('}t') else '\\n' if i.tag.endswith('}br') else '' for i in p.iter())
assert sys.argv[1] in [paragraph(p) for p in doc.findall('.//w:p',ns)]
print('PASS')`, quote], { input: bytes, encoding: 'utf8' });
  assert.equal(result.trim(), 'PASS');
});

 test('production known-damaged VN42110 OCR stays blocked for model and approval', t => {
  const catalog = loadDataset();
  const claim = catalog.records.find(item => item.id === 'vn-patent-42110-claim-1');
  const source = catalog.sources.find(item => item.id === claim.sourceId);
  assert.ok(claim.knownExtractionWarning || source.knownExtractionWarning, 'The real capture must retain its known OCR damage flag.');
  const { matter, workflow } = releaseFixture(t, { structuralOnly: false });
  assert.throws(() => buildPatentPrompt({ matter, targets: ['matrix'] }, { model: 'test-no-call' }), { status: 422 });
  assert.throws(() => workflow.approve(matter.id, { version: matter.version, targets: ['matrix', 'response'] }, actor), { status: 422 });
  assert.equal(workflow.read(matter.id, actor).releases.length, 0);
});

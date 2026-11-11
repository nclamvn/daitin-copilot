import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDataset } from '../patents/dataset.mjs';
import { openPatentStore } from '../patents/store.mjs';
import { createPatentWorkflow, buildPatentPrompt } from '../patents/workflow.mjs';
import { makePatentWord } from '../patents/word.mjs';
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

test('formatter-only clone of VN42110 raw OCR crossing pages exports valid XML without changing the stored quote', t => {
  const release = releaseFixture(t);
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
  const release = releaseFixture(t);
  for (const invalid of ['\u0000', '\u0001', '\u000b', '\ud800', '\ufffe']) {
    const { sha256, ...content } = structuredClone(release);
    content.sections.response.text += invalid;
    assert.throws(() => makePatentWord({ ...content, sha256: digest(content) }), { status: 422 });
  }
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

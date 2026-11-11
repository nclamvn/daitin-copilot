import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPatentSpanOptions, materializePatentSpans } from '../patents/spans.mjs';
import { requireClaimContext, validatePatentPatch } from '../patents/workflow.mjs';
import { hash } from '../copilot/m3/workflow.mjs';
import { loadDataset } from '../patents/dataset.mjs';

function actualMatter() {
  const dataset = loadDataset();
  const target = dataset.records.find(item => item.id === 'ep-ep1004359b1-claim-2');
  const parent = dataset.records.find(item => item.id === 'ep-ep1004359b1-claim-1');
  const cited = dataset.records.find(item => item.id === 'us-patent-5783810-page-7-1');
  return { claimText: target.text, claimRecordId: target.id, d1RecordIds: [cited.id],
    pinnedEvidence: [target, parent, cited].map(record => ({ record, source: dataset.sources.find(source => source.id === record.sourceId) })),
    evidenceIds: [target.id, parent.id, cited.id] };
}

test('native span IDs are deterministic, offset-exact and hash-bound even for unreviewed OCR line breaks', () => {
  const matter = actualMatter();
  const options = buildPatentSpanOptions(matter, requireClaimContext(matter));
  assert.deepEqual(options, buildPatentSpanOptions(matter, requireClaimContext(matter)));
  assert.ok(options.claim.some(item => item.recordId === 'ep-ep1004359b1-claim-1'));
  assert.ok(options.d1.length > 1);
  for (const span of [...options.claim, ...options.d1]) {
    const pinned = matter.pinnedEvidence.find(item => item.record.id === span.recordId);
    assert.equal(span.text, pinned.record.text.slice(span.start, span.end));
    assert.equal(span.recordSHA256, hash(pinned.record.text));
    assert.equal(span.sourceSHA256, pinned.source.sha256);
    assert.ok(span.text.length <= 1000);
  }
  const parent = options.claim.find(item => item.recordId === 'ep-ep1004359b1-claim-1');
  const d1 = options.d1.find(item => item.text.includes('\n'));
  assert.ok(d1);
  const selected = { matrix: { rows: [{ feature: 'Protocol fixture, no substantive legal rating', claimSpanId: parent.id,
    d1SpanId: d1.id, assessment: 'uncertain', analysis: 'Cần luật sư đối chiếu bản nguồn.', missing: 'Chưa có kết luận chuyên môn.' }] } };
  const result = validatePatentPatch(matter, materializePatentSpans(selected, options), ['matrix']);
  assert.equal(result.matrix.rows[0].claimQuoteRecordId, parent.recordId);
  assert.equal(result.matrix.rows[0].d1Quote, d1.text);
  for (const wrong of ['unknown-span-id', options.claim[0].id]) {
    assert.throws(() => materializePatentSpans({ matrix: { rows: [{ ...selected.matrix.rows[0], d1SpanId: wrong }] } }, options), { status: 422 });
  }
});

test('a bound target excerpt cannot silently expand to other parts of its public claim', () => {
  const matter = actualMatter();
  matter.claimText = 'wherein said label(40) further comprises a tab (84)';
  const options = buildPatentSpanOptions(matter, requireClaimContext(matter));
  const targetOptions = options.claim.filter(item => item.recordId === matter.claimRecordId);
  assert.ok(targetOptions.length > 0);
  assert.ok(targetOptions.every(item => matter.claimText.includes(item.text)));
});

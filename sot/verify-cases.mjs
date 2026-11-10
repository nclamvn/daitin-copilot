import assert from 'node:assert/strict';
import { loadSot } from './bundle.mjs';
import { resolveProcedure } from '../research.mjs';

const bundle = loadSot('preview');
assert.equal(bundle.digest, process.argv[2], 'Bản ứng viên đã thay đổi trong lúc đối chiếu.');
for (const row of bundle.payload.reviewCases) {
  const result = resolveProcedure(row.input);
  assert.equal(result.status, row.expected.status, row.id);
  assert.equal(result.rule, row.expected.rule, row.id);
  assert.equal(result.form?.id ?? null, row.expected.form, row.id);
  const actual = result.citations.map(citation => citation.id);
  for (const citation of row.expected.citations) assert.ok(actual.includes(citation), row.id + ' → ' + citation);
}
console.log('PASS ' + bundle.payload.reviewCases.length + ' ca nghiệp vụ');

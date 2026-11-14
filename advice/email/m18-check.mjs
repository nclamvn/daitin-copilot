import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pilotCases } from './m18-cases.mjs';

const [directory] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(directory + '/browser.json', 'utf8'));
const rubric = {
  'V01:2': { fee: /50\.000.*(?:\n|.)*2026|2026.*50\.000/ },
  'V02:2': { poa: /bản sao.*số đơn/s, 'poa-signer': /thẩm quyền ký/, 'poa-formality': /công chứng|hình thức/ },
  'V03:2': { deadline: /ngày hết hiệu lực/ },
  'V04:2': { fee: /ngày dự kiến nộp/, 'late-fee': /ngày dự kiến nộp/ },
  'V06:2': { fee: /ngày nộp/ },
  'T01:1': { fee: /cho biết.*năm niên phí/ },
  'T01:2': { fee: /4\.000 THB/ },
  'T02:2': { poa: /Đối tác A.*chủ bằng.*phạm vi/s },
  'T03:2': { poa: /khác nhau.*xác nhận/s, fee: /6\.600 THB/ },
  'T04:2': { deadline: /ngày nộp đơn.*ngày cấp.*năm niên phí/s },
  'T05:2': { fee: /1\.200 THB/, 'late-fee': /120 ngày.*30%/s },
  'T06:1': { prepay: /140\.000 THB/ },
  'T06:2': { poa: /thẩm quyền ký/, 'poa-formality': /công chứng|hình thức/ },
};
assert.equal(rows.length, 24);
const submissions = rows.map(row => ({
  code: randomUUID().slice(0, 12), caseId: row.case, session: row.session,
  client: row.outputs.client ?? '', partner: row.outputs.partner ?? '', sections: row.sections,
})).sort((a, b) => a.code.localeCompare(b.code));
const results = submissions.map(row => {
  const fixture = pilotCases.find(item => item.id === row.caseId);
  const key = row.caseId + ':' + row.session;
  const expected = fixture.expected[row.session - 1];
  const pending = fixture.pending[row.session - 1];
  const released = row.sections.filter(item => !item.pending);
  const question = row.sections.filter(item => item.pending);
  const coverage = JSON.stringify(row.sections.map(item => item.id)) === JSON.stringify(expected);
  const stop = JSON.stringify(question.map(item => item.id)) === JSON.stringify(pending);
  const recipients = Boolean(row.client) === Boolean(released.length) && Boolean(row.partner) === Boolean(question.length) &&
    row.sections.every(item => (item.pending ? row.partner : row.client).includes(item.text.trim()) &&
      !(item.pending ? row.client : row.partner).includes(item.text.trim()));
  const evidence = released.every(item => item.ids.length > 0);
  const facts = Object.entries(rubric[key] ?? {}).every(([id, pattern]) => pattern.test(row.sections.find(item => item.id === id)?.text ?? ''));
  return { code: row.code, caseId: row.caseId, session: row.session, coverage, stop, recipients, evidence, facts,
    pass: coverage && stop && recipients && evidence && facts };
});
const sourceTrail = Object.fromEntries(pilotCases.map(fixture => [fixture.id, [fixture.first, fixture.next]]));
writeFileSync(directory + '/phieu-mo-phong.json', JSON.stringify({ inputs: sourceTrail, submissions }, null, 2) + '\n', { mode: 0o600 });
writeFileSync(directory + '/ket-qua-mo-phong.json', JSON.stringify({ cases: pilotCases.length, sessions: rows.length,
  passes: results.filter(row => row.pass).length, results }, null, 2) + '\n', { mode: 0o600 });
assert.deepEqual(results.filter(row => !row.pass), []);
console.log('Đạt kiểm tự động', results.length, 'phiên mô phỏng.');

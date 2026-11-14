import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createLibraryModel } from '../library/model.mjs';
import { answerProcedure, procedureSources } from './answer.mjs';
import { cases } from './cases.mjs';

const [report, blind, selectedCases] = process.argv.slice(2);
const include = selectedCases?.split(',').map(Number);
const model = createLibraryModel({ timeoutMs: 115000, privateSources: true });
if (!report || !blind || !model) throw new Error('Cần model loopback và hai đích biên nhận/chấm mù.');
writeFileSync(report, '', { flag: 'wx', mode: 0o600 });
const pairs = [];
const today = '2026-11-13';
for (const [index, [query, expected, sourceIds, previous]] of cases.entries()) {
  if (include && !include.includes(index + 1)) continue;
  const answer = answerProcedure(query, previous, today);
  assert.ok(answer, query);
  const [country] = answer.scopeKey;
  const scope = country === 'vn' ? ['vn', 'tm', 'renew'] : ['th', 'pt', 'annuity'];
  const corpus = procedureSources(country === 'vn' ? 'vn-renewal' : 'th-annuity').map(row => ({
    ...row, scope: [...scope, row.field === 'late-fee' ? 'deadline' : row.field], reviewed: true,
    date: row.until ? 'Hiệu lực đến ' + row.until : null, supersedes: [],
    quote: row.statement + ' | ' + row.locator,
  }));
  const input = query + (previous ? '\nPhạm vi câu trước: ' + answer.scope : '') + '\nNgày đối chiếu: ' + today +
    '. Nếu có nhiều ý, trả lời từng ý, giữ các điều kiện của nguồn và nêu rõ phần cần xác nhận.';
  const selected = corpus.filter(row => answer.citations.some(citation => citation.id === row.id));
  const run = async sources => {
    try { return await model(input, sources); }
    catch (error) { return { error: error.message }; }
  };
  const steps = index % 2 ? [corpus, selected] : [selected, corpus];
  const first = await run(steps[0]);
  const second = await run(steps[1]);
  const [productRun, directRun] = index % 2 ? [second, first] : [first, second];
  const product = { kind: answer.kind, answer: answer.body, email: answer.email,
    ids: answer.citations.map(row => row.id), run: productRun };
  const direct = { ...directRun, kind: directRun.status, run: directRun };
  const sourceHash = createHash('sha256').update(JSON.stringify(corpus)).digest('hex');
  for (const [arm, output] of Object.entries({ product, direct })) {
    const code = randomBytes(6).toString('hex');
    const ids = output.ids ?? [];
    const citationCheck = sourceIds.every(id => ids.includes(id)) && ids.every(id => corpus.some(row => row.id === id));
    const comparableKind = expected === 'partial' ? 'missing' : expected;
    const statusCheck = (output.kind === 'partial' ? 'missing' : output.kind) === comparableKind;
    appendFileSync(report, JSON.stringify({ case: index + 1, arm, code, query, expected, sourceHash,
      checks: { citationCheck, statusCheck }, output }) + '\n');
    pairs.push({ code, question: input, answer: output.answer ?? '', email: output.email ?? '', citations: ids,
      sources: corpus.map(({ id, title, locator, quote, origin }) => ({ id, title, locator, quote, origin })) });
  }
  writeFileSync(blind, JSON.stringify({
    criteria: ['Đúng từng ý hỏi', 'Giữ đúng phạm vi và điều kiện', 'Đúng đoạn căn cứ', 'Email dùng được sau khi rà'],
    answers: [...pairs].sort((a, b) => a.code.localeCompare(b.code)),
  }, null, 2) + '\n', { mode: 0o600 });
  console.log(index + 1, product.kind, direct.kind ?? direct.error, productRun.model ?? productRun.error);
}

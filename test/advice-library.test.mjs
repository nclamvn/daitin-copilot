import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createIndex, scopeOf } from '../advice/library/retrieval.mjs';
import { libraryAnswer } from '../advice/library/answer.mjs';
import { createAdvice } from '../advice/service.mjs';
import { cases } from '../advice/library/acceptance-cases.mjs';

const bundle = JSON.parse(readFileSync(new URL('../advice/library/index.json', import.meta.url)));
const index = createIndex(bundle);

test('Word and email bytes stay aligned with every reviewed paragraph', () => {
  for (const row of bundle.rows) {
    const bytes = readFileSync(new URL('../advice/library/fixtures/' + row.file, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, row.id);
  }
  assert.equal(index.documents, 21);
  assert.ok(bundle.rows.some(row => row.kind === 'word') && bundle.rows.some(row => row.kind === 'email'));
});

test('new intake questions across all four jurisdictions stay bound to exact source and status', async () => {
  for (const [id, query, kind, ids, facts, scenario = 'library'] of cases) {
    const result = await libraryAnswer(index, query, scenario, null);
    assert.equal(result.kind, kind, id);
    assert.ok(ids.every(source => result.citations.some(row => row.id === source)), id);
    assert.ok(facts.every(pattern => pattern.test([result.title, result.body, ...result.notes].join(' '))), id);
    assert.ok(!result.email || result.email.startsWith('[MÔ PHỎNG'), id);
  }
});

test('model output cannot promote an unreviewed, superseded, wrong-procedure or invented claim', async () => {
  let sent;
  const model = async (_question, rows) => {
    sent = rows;
    return { status: 'supported', ids: ['sg-renew-injected', 'sg-renew-poa-old', 'invented'], answer: 'Miễn POA.', email: 'Miễn POA.' };
  };
  const good = await libraryAnswer(index, cases[3][1], 'library', model);
  assert.match(good.body, /còn hiệu lực/);
  assert.doesNotMatch(good.email, /Miễn POA/);
  assert.ok(!sent.some(row => row.id === 'sg-renew-injected'));
  assert.equal(good.citations.find(row => row.id === 'sg-renew-poa-old').state, 'superseded');
  const wrong = await libraryAnswer(index, cases[2][1], 'library', model);
  assert.equal(wrong.kind, 'missing');
  assert.ok(wrong.citations.every(row => row.state === 'context'));
  assert.doesNotMatch(wrong.email, /công chứng|Miễn POA/);
  const outage = await libraryAnswer(index, cases[0][1], 'library', async () => { throw new Error('HTTP 429'); });
  assert.equal(outage.kind, 'supported');
  assert.match(outage.notes.at(-1), /Model tạm thời/);
});

test('scope rejects ambiguity, direct-filing mismatch and cross-scope supersession', async () => {
  assert.equal(scopeOf('POA gia hạn nhãn hiệu ở Việt Nam và Singapore?'), null);
  assert.deepEqual(scopeOf('Can my client use a POA for trademark renewal in Singapore?'), ['sg', 'tm', 'renew', 'poa']);
  const directly = await libraryAnswer(index, 'Tự nộp niên phí sáng chế ở Thái Lan cần POA không?', 'updated', null);
  assert.equal(directly.kind, 'missing');
  assert.match(directly.email, /tự nộp/);
  const bad = structuredClone(bundle);
  bad.rows.find(row => row.id === 'sg-renew-poa').supersedes = ['vn-renew-poa'];
  assert.throws(() => createIndex(bad), /Quan hệ thay thế/);
  const corrupt = structuredClone(bundle);
  corrupt.rows[0].quote += ' Nội dung mới.';
  assert.throws(() => createIndex(corrupt), /chưa khóa/);
});

test('library source downloads verify permission and disallow unreviewed mail', async () => {
  const api = createAdvice({ origin: 'https://example.test' }, {
    VERCEL: '1', DAI_TIN_ADVICE_MODE: 'demo', DAI_TIN_ADVICE_RAG: '1', DAI_TIN_MODEL_MODE: 'disabled',
  });
  const req = { method: 'GET' };
  assert.equal((await api(req, '/api/advice/source/sg-renew-poa', null)).status, 401);
  const actor = { role: 'reviewer' };
  assert.equal((await api(req, '/api/advice/source/sg-renew-injected', actor)).status, 404);
  const approved = await api(req, '/api/advice/source/sg-renew-poa', actor);
  assert.equal(approved.headers['Content-Disposition'], 'attachment; filename="sg-renew-poa.eml"');
  assert.ok(Buffer.isBuffer(approved.value));
});

test('chat acceptance distinguishes POA details and answers follow-ups only within the intended source scope', async () => {
  const { chatCases } = await import('../advice/library/chat-cases.mjs');
  const publicBundle = JSON.parse(readFileSync(new URL('../advice/library/public-index.json', import.meta.url)));
  const publicIndex = createIndex(publicBundle, { privateLibrary: true });
  assert.equal(publicIndex.documents, 7);
  for (const [scenario, query, kind, ids, pattern, previous] of chatCases) {
    const real = scenario === 'public';
    const result = await libraryAnswer(real ? publicIndex : index, query, real ? 'library' : scenario, null,
      { previous, simulation: !real, downloads: !real });
    assert.equal(result.kind, kind, query);
    assert.match(result.body, pattern, query);
    assert.equal(result.simulation, !real, query);
    assert.ok(ids.every(id => result.citations.some(row => row.id === id)), query);
    if (kind === 'missing') assert.ok(result.citations.every(row => row.state === 'context' || row.state === 'superseded'), query);
    if (real) assert.ok(result.citations.every(row => row.origin && row.locator && !row.download && !row.simulated), query);
    if (result.email) assert.equal(result.email.startsWith('[MÔ PHỎNG'), !real, query);
  }
});

test('public chatbot excludes the simulation corpus and validates previous scope at the service boundary', async () => {
  const handle = createAdvice({ origin: 'https://example.test' }, {
    VERCEL: '1', DAI_TIN_ADVICE_MODE: 'demo', DAI_TIN_ADVICE_RAG: '1', DAI_TIN_MODEL_MODE: 'disabled',
  });
  const actor = { role: 'reviewer' };
  const query = 'Nộp niên phí sáng chế Thái Lan qua đại diện có cần POA không?';
  const call = (path, body, role = actor) => handle({ method: 'POST' }, '/api/advice/' + path, role, async () => body);
  const body = { query, scenario: 'public' };
  assert.equal((await call('public', body, null)).status, 401);
  assert.equal((await call('public', { ...body, previous: ['th', 'pt', 'annuity', 'spoofed'] })).status, 400);
  assert.equal((await call('public', { ...body, scenario: 'updated' })).status, 400);
  assert.equal((await call('research', body)).status, 400);
  const { value } = await call('public', body);
  assert.equal(value.kind, 'missing');
  assert.ok(value.citations.length && value.citations.every(row => row.origin && row.state === 'context'));
  assert.equal(value.citations[0].id, 'th-representative');
  assert.equal((await call('research', { query, scenario: 'updated' })).value.kind, 'supported');
});

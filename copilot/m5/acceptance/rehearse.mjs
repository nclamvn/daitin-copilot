import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ids, hash } from '../../m3/workflow.mjs';
import { brandedWordLayout } from '../../m4/word-brand.mjs';
import { matters, questions, safety } from './cases.mjs';

const base = process.env.DAI_TIN_M5_BASE ?? 'http://127.0.0.1:4320';
const accountsFile = process.env.DAI_TIN_M5_ACCOUNTS;
if (!process.argv[2] || !accountsFile) throw new Error('Cần thư mục kết quả và đường dẫn cấu hình pilot.');
const accounts = JSON.parse(readFileSync(accountsFile));
const actor = accounts.find(item => item.name === 'luat-su');
const editor = accounts.find(item => item.name === 'chuyen-vien');
const other = accounts.find(item => item.name === 'nhom-khac');
const root = resolve(process.argv[2]);
mkdirSync(root, { recursive: true, mode: 0o700 });
const work = mkdtempSync(resolve(root, 'run-'));
const blind = resolve(work, 'blind');
mkdirSync(blind, { mode: 0o700 });
const json = (dir, name, value) => writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const directFile = fileURLToPath(new URL('./direct.mjs', import.meta.url));
const exec = promisify(execFile);
const bearer = user => 'Basic ' + Buffer.from(user.name + ':' + user.key).toString('base64');

async function request(path, { body, user = actor, status = 200, bytes = false } = {}) {
  const headers = user ? { Authorization: bearer(user) } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, { headers, method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, status, path + ' ' + (response.ok ? '' : await response.clone().text()));
  if (!bytes) return response.json();
  const value = Buffer.from(await response.arrayBuffer());
  assert.equal(response.headers.get('x-artifact-sha256'), hash(value));
  assert.ok(value.includes(Buffer.from('word/media/daitin-gray.png')));
  return value;
}
const ask = input => request('/api/m5/research', { body: input });
const report = { schema: 'm5-rehearsal-1', evidence: 'synthetic automated local model, no human timings or quality scores',
  lookup: [], paired: [], gates: [], errors: [] };
const brief = ({ question, status, scope, explanation, title, coverage, citations, form, missing, referral }) =>
  ({ question, status, scope, title, explanation, coverage, citations, form, missing, referral });

function checkAnswer(entry, answer) {
  assert.equal(answer.status, entry.expected.status);
  if (entry.expected.evidence) assert.ok(answer.citations.some(item => item.id === entry.expected.evidence));
  assert.equal(answer.form?.id ?? null, entry.expected.form);
  if (answer.status !== 'grounded') assert.equal(answer.proofId, undefined);
}

const key = {};
function blinded(entry, pairs) {
  const order = randomInt(2) ? ['workspace', 'direct'] : ['direct', 'workspace'];
  for (const [index, arm] of order.entries()) {
    const code = entry.id + '-' + String.fromCharCode(65 + index);
    key[code] = arm;
    for (const [i, item] of pairs[arm].entries()) {
      writeFileSync(resolve(blind, code + '-phien-' + (i + 1) + '.docx'), item.word, { mode: 0o600 });
    }
  }
  json(blind, entry.id + '-yeu-cau.json', { id: entry.id, title: entry.title, facts: entry.facts, question: entry.request.question,
    notice: entry.notice.text, instructions: entry.instructions.text, update: entry.update.text, firstTask: entry.draft, secondTask: entry.revise });
}

const casePath = '/api/m3/cases';
const runSuffix = randomBytes(3).toString('hex').toUpperCase();
const withReference = entry => ({ ...entry, id: entry.id + '-' + runSuffix });
const creation = (entry, research) => ({ ...entry.facts, reference: entry.id, title: entry.title, anonymized: true,
  notice: entry.notice, instructions: entry.instructions, research });
const wordPath = (matter, n) => '/api/m4/cases/' + matter.id + '/word/' + n + '/' + brandedWordLayout;
const reload = id => request(casePath + '/' + id);
const act = (matter, action, body, options) =>
  request(casePath + '/' + matter.id + '/' + action, { body: { version: matter.version, ...body }, ...options });

async function workspace(entry, phase, state) {
  const second = phase === 'second';
  let matter;
  const start = performance.now();
  if (!second) {
    const proof = await ask(entry.request);
    checkAnswer(entry, proof);
    assert.equal(proof.citations.find(item => item.id === 'tt10-83-2b').page, 102);
    matter = await request(casePath, { status: 201, body: creation(entry, { input: entry.request, proofId: proof.proofId }) });
    assert.equal(matter.research.proofId, proof.proofId);
  } else {
    matter = await reload(state.id);
    assert.equal(matter.research.proofId, state.proofId);
    assert.equal(hash(await request(wordPath(matter, 1), { bytes: true })), state.firstHash);
    matter = await act(matter, 'source', entry.update);
  }
  matter = await act(matter, 'propose', { sources: second ? ['notice', 'instructions', 'update-1'] : ['notice', 'instructions'],
    ...(second ? { targets: ['response'] } : {}), instruction: second ? entry.revise : entry.draft });
  const draft = matter.drafts.at(-1);
  if (second) assert.equal(matter.releases.length, 1);
  for (const section of second ? ['response'] : ids) matter = await act(matter, 'approve', { targets: [section] });
  const release = matter.releases.at(-1);
  const word = await request(wordPath(matter, second ? 2 : 1), { bytes: true });
  assert.equal(release.research.proofId, matter.research.proofId);
  return { id: matter.id, proofId: matter.research.proofId, firstHash: state?.firstHash ?? hash(word),
    run: draft.run, release, word, wallMs: Math.round(performance.now() - start) };
}

async function direct(input, dir, phase) {
  const start = performance.now();
  const result = await exec(process.execPath, [directFile, phase, input, dir], {
    env: { ...process.env, DAI_TIN_CORPUS_MODE: 'preview' }, timeout: 110000
  });
  const data = JSON.parse(result.stdout);
  const word = readFileSync(resolve(dir, phase + '.docx'));
  assert.equal(data.wordHash, hash(word));
  return { ...data, word, wallMs: Math.round(performance.now() - start) };
}

function verifyPair(entry, pairs) {
  for (const arm of ['workspace', 'direct']) {
    const [first, second] = pairs[arm];
    assert.equal(first.proofId, second.proofId);
    assert.ok(first.release.sections.response.text.includes(entry.first));
    assert.ok(second.release.sections.response.text.includes(entry.next));
    assert.ok(first.release.sections.attachments.text.toLowerCase().includes(entry.attachment.toLowerCase()));
    for (const release of [first.release, second.release]) {
      assert.ok(Object.values(release.sections).every(item =>
        !/\b(?:Điều|khoản|Thông tư|Nghị định)\s+(?:số\s+)?\d/iu.test(item.text)));
    }
    for (const section of ['findings', 'attachments']) {
      assert.equal(second.release.sections[section].text, first.release.sections[section].text);
      assert.equal(second.release.sections[section].draft, 1);
    }
  }
  for (const [i, a] of pairs.workspace.entries()) {
    const b = pairs.direct[i];
    assert.equal(a.run.inputSha256, b.run.inputSha256);
    assert.equal(a.proofId, b.proofId);
  }
}

for (const entry of [...questions, ...safety]) {
  try {
    const answer = await ask(entry.request);
    json(blind, entry.id + '-tra-cuu.json', brief(answer));
    checkAnswer(entry, answer);
    if (entry.id === 'S07') {
      assert.equal(new URL(answer.referral.url).hostname, 'www.wipo.int');
      assert.deepEqual(answer.referral.targets.map(item => item.code), ['VN', 'TH']);
    }
    report.lookup.push({ id: entry.id, status: answer.status, evidence: answer.citations.map(item => item.id), form: answer.form?.id ?? null });
  } catch (error) {
    report.errors.push({ id: entry.id, message: error.message });
  }
}

for (const [index, original] of matters.entries()) {
  if (process.argv.includes('--smoke') && index > 0) break;
  const entry = withReference(original);
  const dir = resolve(work, original.id);
  mkdirSync(dir, { mode: 0o700 });
  const input = resolve(dir, 'input.json');
  json(dir, 'input.json', entry);
  const pairs = { workspace: [], direct: [] };
  try {
    for (const [i, phase] of ['first', 'second'].entries()) {
      const order = (index + i) % 2 === 0 ? ['workspace', 'direct'] : ['direct', 'workspace'];
      for (const arm of order) {
        pairs[arm].push(arm === 'workspace' ? await workspace(entry, phase, pairs.workspace[0]) : await direct(input, dir, phase));
      }
    }
    blinded({ ...entry, id: original.id }, pairs);
    const metrics = Object.fromEntries(Object.entries(pairs).map(([arm, phases]) => [arm, phases.map(item => ({
      wordHash: hash(item.word), model: item.run.model, modelInput: item.run.inputSha256,
      wallMs: item.wallMs, modelMs: item.run.elapsedMs
    }))]));
    report.paired.push({ id: original.id, ...metrics,
      identicalWord: pairs.workspace.map((item, i) => hash(item.word) === hash(pairs.direct[i].word)) });
    verifyPair(entry, pairs);
    console.log(original.id + ' hoàn thành hai phiên trên hai nhánh.');
  } catch (error) {
    report.errors.push({ id: original.id, message: error.message });
    console.log(original.id + ' cần rà soát: ' + error.message);
  }
}

if (report.paired.length && !process.argv.includes('--skip-gates')) {
  const gate = async (name, test) => {
    try { await test(); report.gates.push(name); }
    catch (error) { report.errors.push({ id: name, message: error.message }); }
  };
  const proof = await ask(matters[0].request);
  const entry = { ...matters[0], id: 'GATE-' + runSuffix };
  const pin = { input: entry.request, proofId: proof.proofId };
  const matter = await request(casePath, { status: 201, body: creation(entry, pin) });
  const listing = await request(casePath);
  const paired = listing.find(item => item.reference === 'W01-' + runSuffix);
  await gate('anonymous / cross-group / editor approval', async () => {
    await request(casePath, { status: 401, user: null });
    assert.equal((await request(casePath, { user: other })).some(row => row.id === matter.id), false);
    await request(casePath + '/' + matter.id, { status: 404, user: other });
    await request('/api/m5/cases/' + matter.id + '/research', { status: 404, user: other,
      body: { version: matter.version, research: pin } });
    await request(wordPath(paired, 1), { status: 404, user: other });
    await request(casePath + '/' + paired.id + '/release/1', { status: 404, user: other });
    await act(matter, 'approve', { targets: ['response'] }, { status: 403, user: editor });
    await request(casePath, { status: 201, user: other, body: creation(entry) });
  });
  await gate('bound sources / changed facts / stale save', async () => {
    const citation = proof.citations.find(item => item.id === 'tt10-83-2b');
    const response = await fetch(base + citation.snapshotUrl);
    assert.equal(response.status, 200);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), citation.sha256);
    await request(citation.snapshotUrl.replace(citation.sha256, '0'.repeat(64)), { status: 409 });
    await request('/api/m5/cases/' + matter.id + '/research', { status: 409,
      body: { version: 0, research: pin } });
    await request('/api/m5/cases/' + matter.id + '/research', { status: 409,
      body: { version: 1, research: { ...pin, proofId: '0'.repeat(64) } } });
    const changed = { ...entry.request, receivedOn: '2026-09-20' };
    const fresh = await ask(changed);
    await request('/api/m5/cases/' + matter.id + '/research', { status: 409,
      body: { version: matter.version, research: { input: changed, proofId: fresh.proofId } } });
  });
  await gate('stage / publish / stale matter / rebind / rollback', async () => {
    const first = (await request('/api/m5/templates')).current;
    const item = await request('/api/m5/templates/stage', { status: 201, user: editor, body: {
      base: first.digest, title: first.title, text: first.text + ' Kiểm trang thông báo đã chọn và phiên bản hồ sơ ' + runSuffix + '.'
    } });
    assert.equal((await request('/api/m5/templates')).current.digest, first.digest);
    const publish = { base: first.digest, version: item.version, digest: item.digest };
    await request('/api/m5/templates/publish', { status: 403, user: editor, body: publish });
    await request('/api/m5/templates/publish', { status: 409, body: { ...publish, digest: 'f'.repeat(64) } });
    const before = hash(await request(wordPath(paired, 1), { bytes: true }));
    await request('/api/m5/templates/publish', { body: publish });
    assert.equal((await request('/api/m5/templates', { user: other })).current.version, 1);
    const stale = await reload(paired.id);
    assert.equal(stale.templateChanged, true);
    await act(stale, 'approve', { targets: ['response'] }, { status: 409 });
    assert.equal(hash(await request(wordPath(paired, 1), { bytes: true })), before);
    await request('/api/m5/cases/' + matter.id + '/research', { status: 409, body: { version: matter.version, research: pin } });
    const fresh = await ask(entry.request);
    const rebound = await request('/api/m5/cases/' + stale.id + '/research', { body: { version: stale.version,
      research: { input: entry.request, proofId: fresh.proofId } } });
    assert.equal(rebound.research.template.version, item.version);
    assert.equal(rebound.releases[0].research.template.version, first.version);
    assert.deepEqual(rebound.approved, {});
    await request('/api/m5/templates/rollback', { body: { base: item.digest, version: first.version, digest: first.digest } });
    assert.equal((await request('/api/m5/templates')).current.digest, first.digest);
  });
  if (process.argv.includes('--isolated-revocation')) await gate('revoke credentials before reopen and export', async () => {
    const original = readFileSync(accountsFile);
    try {
      const revoked = accounts.map(item => item.name === actor.name ? { ...item, disabled: true } : item);
      writeFileSync(accountsFile, JSON.stringify(revoked));
      await request(casePath + '/' + paired.id, { status: 401 });
      await request(wordPath(paired, 1), { status: 401 });
      await request('/api/m5/research', { status: 401, body: entry.request });
    } finally {
      writeFileSync(accountsFile, original);
    }
    assert.equal((await reload(paired.id)).id, paired.id);
  });
}

json(work, 'report.json', report);
json(work, 'arm-key.json', key);
console.log(work);
if (report.errors.length) process.exitCode = 1;

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { beginModel, directory, measure, modelId, openLedger, qualityView, readJSON, sha, timestamp, track } from './common.mjs';

const base = '/api/patents/cases';
const conflict = /Pilot đang lưu một thay đổi khác|Hồ sơ vừa được cập nhật ở phiên khác/;
const wordPath = (id, phase) => `${base}/${id}/word/${phase}`;
const requiredActor = (accounts, name, role) => {
  const account = accounts.find(item => item.name === name && item.role === role && !item.disabled);
  assert.match(account?.key ?? '', /^[a-f0-9]{64}$/, `Missing active ${role} pilot account`);
  return account;
};

function clients(ledger, origin, accountsPath) {
  assert.ok(origin === 'https://daitin-copilot.vercel.app' || /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin), 'Use the authorized pilot or local test origin');
  const accounts = readJSON(accountsPath);
  const editor = requiredActor(accounts, 'chuyen-vien', 'editor');
  const reviewer = requiredActor(accounts, 'nghiem-thu', 'reviewer');
  assert.equal(editor.group, reviewer.group);
  const cookies = new Map();
  async function call(phase, caseId, action, path, { account = editor, body, expected = 200, safeWrite = false, basic = false } = {}) {
    assert.ok(path.startsWith('/api/'));
    const actor = action === 'propose' ? 'model' : 'http';
    const method = body === undefined ? 'GET' : 'POST';
    const headers = body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' };
    if (account && basic) headers.Authorization = 'Basic ' + Buffer.from(`${account.name}:${account.key}`).toString('base64');
    else if (account && cookies.has(account.name)) headers.Cookie = cookies.get(account.name);
    for (let attempt = 1; attempt <= (safeWrite ? 3 : 1); attempt++) {
      const result = await measure(ledger, actor, caseId, phase, action, async () => {
        const response = await fetch(origin + path, { method, headers, redirect: 'error',
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(130000) });
        return { response, bytes: Buffer.from(await response.arrayBuffer()) };
      }, ({ response, bytes }) => ({ status: response.status, bytes: bytes.length, method, attempt }));
      if ([expected].flat().includes(result.response.status)) return result;
      const error = result.bytes.toString('utf8');
      if (result.response.status === 409 && attempt < 3 && safeWrite && conflict.test(error)) {
        await pause(1600 * attempt);
        continue;
      }
      throw new Error(`${action} ${caseId ?? 'session'} HTTP ${result.response.status}: ${error.slice(0, 300)}`);
    }
  }
  const json = async (...args) => JSON.parse((await call(...args)).bytes.toString('utf8'));
  async function login(phase, account) {
    const result = await call(phase, null, 'login', '/api/m5/session', { account: null,
      body: { username: account.name, key: account.key }, safeWrite: true });
    const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie ?? '', /^daitin_session=[a-f0-9]{64}$/);
    cookies.set(account.name, cookie);
    track(ledger, 'operator', null, phase, 'begin authenticated session', { role: account.role });
  }
  async function logout(phase, account) {
    if (!cookies.has(account.name)) return;
    await call(phase, null, 'logout', '/api/m5/session/logout', { account, body: {}, safeWrite: true });
    cookies.delete(account.name);
    track(ledger, 'operator', null, phase, 'end authenticated session', { role: account.role });
  }
  return { call, json, login, logout, editor, reviewer };
}

function assertSource(matter, document) {
  const saved = matter.documents.find(item => item.role === document.role);
  assert.ok(saved && saved.sha256 === document.sha256 && saved.page === document.page && saved.textSha256 === sha(document.quote));
  if (document.role === 'notice') assert.equal(matter.noticeText, document.quote);
  else {
    const id = document.role === 'claim' ? matter.claimRecordId : matter.d1RecordIds[0];
    assert.equal(id, saved.recordId);
    assert.equal(matter.pinnedEvidence.find(item => item.record.id === id).record.text, document.quote);
  }
}

async function prepareCases(ledger, api, cases) {
  const options = { basic: true };
  const list = await api.json(1, null, 'list pilot cases', base, options);
  const required = cases.filter(entry => !list.some(item => item.reference === entry.reference)).length;
  assert.ok(list.length + required <= 20, 'Not enough case capacity in this pilot group');
  for (const entry of cases) {
    const record = ledger.state.cases[entry.id];
    const existing = list.find(item => item.reference === entry.reference);
    if (record.preparedAt) {
      assert.ok(existing?.id && existing.id === record.caseId, 'Prepared case is missing or replaced');
      continue;
    }
    const started = performance.now();
    let matter;
    if (existing) {
      matter = await api.json(1, entry.id, 'resume prepared case', `${base}/${existing.id}`, options);
      assert.equal(matter.synthetic, true);
      assert.equal(matter.title, entry.title);
      assert.equal(matter.instructionsText, entry.instructions);
      assert.equal(matter.context.asOf, entry.asOf);
      assert.equal(matter.proposals.length, 0, 'Unexpected analysis already exists in setup case');
      assert.equal(matter.releases.length, 0, 'Unexpected release already exists in setup case');
    } else {
      matter = await api.json(1, entry.id, 'create case', base, { ...options, expected: 201, safeWrite: true, body: {
        synthetic: true, reference: entry.reference, title: entry.title, jurisdiction: 'VN', asOf: entry.asOf,
        claimText: '', claimVersion: '', claimRecordId: null, d1RecordIds: [], evidenceIds: [], noticeText: '', instructionsText: entry.instructions
      } });
      track(ledger, 'operator', entry.id, 1, 'create case and enter instructions');
    }
    record.caseId = matter.id;
    ledger.save();
    for (const document of entry.documents) {
      if (matter.documents.some(item => item.role === document.role)) {
        assertSource(matter, document);
        continue;
      }
      const path = `${base}/${matter.id}/pdf`;
      const range = { version: matter.version, synthetic: true, content: document.original.toString('base64'),
        firstPage: document.page, lastPage: document.page };
      track(ledger, 'operator', entry.id, 1, 'choose PDF and page', { role: document.role });
      const inspected = await api.json(1, entry.id, 'inspect PDF range', `${path}/inspect`, { ...options, body: range });
      assert.equal(inspected.sha256, document.sha256);
      const page = inspected.pages.find(item => item.page === document.page);
      const start = page?.text.indexOf(document.quote) ?? -1;
      assert.ok(page?.usable && start >= 0, `${entry.id}/${document.role} exact PDF excerpt unavailable`);
      assert.equal(page.text.indexOf(document.quote, start + 1), -1, 'Selected quote must uniquely identify its span on the page');
      matter = await api.json(1, entry.id, 'bind exact PDF excerpt', `${path}/bind`, { ...options, safeWrite: true, expected: [200, 201], body: {
        ...range, sha256: document.sha256, label: document.label, page: document.page, start, end: start + document.quote.length,
        text: document.quote, role: document.role, confirmed: true
      } });
      track(ledger, 'operator', entry.id, 1, 'confirm and bind exact excerpt', { role: document.role });
      assertSource(matter, document);
    }
    record.preparedAt = timestamp();
    record.prepareElapsedMs = (record.prepareElapsedMs ?? 0) + Math.round(performance.now() - started);
    ledger.save();
    console.log(`Product setup ${entry.id} ready`);
  }
}

async function verifyWord(ledger, api, matter, entry, phase, expectedHash = matter.releases[phase - 1]?.artifact?.sha256) {
  assert.match(expectedHash ?? '', /^[a-f0-9]{64}$/);
  const word = await api.call(phase, entry.id, 'retrieve approved Word', wordPath(matter.id, phase), { account: api.reviewer });
  const digest = sha(word.bytes);
  assert.equal(word.bytes.subarray(0, 2).toString(), 'PK');
  assert.equal(word.response.headers.get('x-artifact-sha256'), digest);
  assert.equal(digest, expectedHash);
  return { bytes: word.bytes, sha256: digest };
}

async function executePhase(ledger, api, out, entry, phase) {
  const record = ledger.state.cases[entry.id];
  if (record.phases[phase]?.wordSha256) return;
  if (phase === 2 && !record.phases[1]?.wordSha256) throw new Error('Phase 1 did not produce a saved product version');
  const started = performance.now();
  const path = `${base}/${record.caseId}`;
  let matter = await api.json(phase, entry.id, 'read saved case', path);
  track(ledger, 'operator', entry.id, phase, 'open saved case');
  for (const document of entry.documents) assertSource(matter, document);
  const targets = phase === 1 ? ['matrix', 'response'] : ['response'];
  const proposalNumber = phase;
  const existing = ledger.state.modelAttempts.find(x => x.caseId === entry.id && x.phase === phase && x.stage === 'generate');
  if (matter.proposals.length >= proposalNumber && !existing) throw new Error(`${entry.id} unexpected proposal outside this ledger`);
  const write = (action, route, body, account = api.editor) => api.json(phase, entry.id, action, `${path}/${route}`, {
    account, safeWrite: true, body: { version: matter.version, ...body }
  });
  const matrixApproval = matter.sections.matrix.approval?.sha256;
  if (phase === 2) {
    assert.equal(matrixApproval, record.phases[1].matrixApproval);
    assert.equal(matter.releases[0]?.artifact.sha256, record.phases[1].wordSha256);
    if (matter.instructionsText !== entry.phase2Instructions) {
      matter = await write('update saved instructions', 'source', { evidenceIds: matter.evidenceIds, claimRecordId: matter.claimRecordId,
        d1RecordIds: matter.d1RecordIds, instructionsText: entry.phase2Instructions });
      track(ledger, 'operator', entry.id, phase, 'update instructions');
      assert.equal(matter.sections.matrix.approval?.sha256, matrixApproval);
      assert.equal(matter.sections.response.approval, null);
    }
  }
  if (matter.proposals.length < proposalNumber) {
    const receipt = beginModel(ledger, entry.id, phase, 'generate', 16);
    track(ledger, 'operator', entry.id, phase, 'send drafting task');
    try {
      matter = await api.json(phase, entry.id, 'propose', `${path}/propose`, { body: { version: matter.version,
        targets, instruction: phase === 1 ? entry.phase1Task : entry.phase2Task } });
      receipt.status = 'accepted';
      receipt.run = matter.proposals.at(-1).run;
      assert.equal(receipt.run.model, modelId, 'Product ran a different model');
      ledger.save();
    } catch (error) {
      receipt.status = 'failed_or_uncertain';
      receipt.error = error.message;
      ledger.save();
      throw error;
    }
  } else if (existing.status !== 'accepted') {
    existing.run = matter.proposals[proposalNumber - 1].run;
    assert.equal(existing.run.model, modelId);
    existing.status = 'accepted_recovered_without_replay';
    ledger.save();
  }
  if (phase === 2) assert.equal(matter.sections.matrix.approval?.sha256, matrixApproval);
  assert.equal(matter.proposals.length, proposalNumber);
  const quality = qualityView(matter, entry, phase);
  if (matter.releases.length < phase) {
    if (phase === 1 && !matter.sections.matrix.approval) {
      track(ledger, 'operator', entry.id, phase, 'review matrix evidence');
      matter = await write('approve matrix', 'approve', { targets: ['matrix'], reviewed: true }, api.reviewer);
      track(ledger, 'operator', entry.id, phase, 'approve matrix');
      assert.equal(matter.releases.length, 0, 'Partial approval cannot emit Word');
    }
    track(ledger, 'operator', entry.id, phase, 'review response evidence');
    matter = await write('approve response', 'approve', { targets: ['response'], reviewed: true }, api.reviewer);
    track(ledger, 'operator', entry.id, phase, 'approve response');
  }
  assert.equal(matter.releases.length, phase);
  const word = await verifyWord(ledger, api, matter, entry, phase);
  track(ledger, 'operator', entry.id, phase, 'retrieve versioned Word');
  if (phase === 2) {
    assert.notEqual(word.sha256, record.phases[1].wordSha256);
    assert.equal((await verifyWord(ledger, api, matter, entry, 1, record.phases[1].wordSha256)).sha256, record.phases[1].wordSha256);
    assert.equal(matter.sections.matrix.approval?.sha256, record.phases[1].matrixApproval);
    quality.matrixPreserved = true;
    quality.word1Preserved = true;
  }
  writeFileSync(join(out, 'product-word', `${entry.id}-v${phase}.docx`), word.bytes, { mode: 0o600 });
  record.phases[phase] = { quality, wordSha256: word.sha256, matrixApproval: matter.sections.matrix.approval.sha256,
    elapsedMs: Math.round(performance.now() - started) };
  ledger.save();
  console.log(`Product ${entry.id} phase ${phase} complete`);
}

export async function runProduct({ out, input, origin, accountsPath, prepareOnly }) {
  const ledger = openLedger(out, 'product', input.manifestSha256, input.cases);
  const api = clients(ledger, origin, accountsPath);
  ledger.state.origin = origin;
  directory(join(out, 'product-word'));
  await prepareCases(ledger, api, input.cases);
  if (prepareOnly) return;
  const status = await api.json(1, null, 'verify configured model', '/api/patents/status', { basic: true });
  assert.equal(status.model, modelId, 'Do not dispatch the pilot to a different model');
  for (const phase of [1, 2]) {
    const pending = input.cases.filter(entry => !ledger.state.cases[entry.id].phases[phase]?.wordSha256);
    if (!pending.length) continue;
    const started = performance.now();
    try {
      await api.login(phase, api.editor);
      await api.login(phase, api.reviewer);
      for (const entry of pending) {
        try { await executePhase(ledger, api, out, entry, phase); }
        catch (error) {
          const record = ledger.state.cases[entry.id];
          record.errors ??= {};
          record.errors[phase] = error.message;
          ledger.save();
          console.error(`Product ${entry.id} phase ${phase}: ${error.message}`);
        }
      }
    } finally {
      await api.logout(phase, api.editor);
      await api.logout(phase, api.reviewer);
      ledger.state.sessionRuns ??= [];
      ledger.state.sessionRuns.push({ phase, elapsedMs: Math.round(performance.now() - started), finishedAt: timestamp() });
      ledger.save();
    }
  }
  ledger.state.finishedAt = timestamp();
  ledger.save();
}

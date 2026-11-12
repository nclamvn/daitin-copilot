import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pilotLockDigest } from '../../../../../patents/pilot-lock.mjs';
import { directory, loadCases, modelId, qualityView, readApprovedSourceLock, readJSON, sha, verifyLockedDocuments } from '../common.mjs';
import { pairedEffort } from './metrics.mjs';

const origin = 'https://daitin-copilot.vercel.app';
const criteria = ['source', 'technical', 'scope', 'response1', 'continuation'];
const criticalCodes = new Set(['D1_SCOPE', 'SOURCE_INTEGRITY', 'UNSUPPORTED_TECHNICAL', 'LEGAL_CONCLUSION', 'VERSION']);
const digest = /^[a-f0-9]{64}$/;
const roles = { notice: 'Thông báo', claim: 'Yêu cầu bảo hộ', d1: 'Đối chứng D1' };
const write = (filename, value) => writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const checkout = realpathSync(fileURLToPath(new URL('../../../../../', import.meta.url)));

function study(manifest) {
  assert.ok(!realpathSync(manifest).startsWith(checkout + sep), 'Keep the enrolled manifest outside the checkout');
  const input = loadCases(manifest, 8, { anonymized: true });
  assert.equal(input.cases.length, 1, 'This human pilot registers one case');
  return { ...input, entry: input.cases[0] };
}

function outsideCheckout(path) {
  const parent = realpathSync(dirname(resolve(path)));
  assert.ok(parent !== checkout && !parent.startsWith(checkout + sep), 'Keep real pilot evidence outside the checkout');
}

async function preflight(manifest, configFile) {
  outsideCheckout(configFile);
  const input = study(manifest);
  const { deriveHumanSourceLock } = await import('../direct.mjs');
  const { lock, documents } = await deriveHumanSourceLock(input);
  write(configFile, lock);
  console.log(JSON.stringify({ documents: documents.length, bytes: documents.reduce((n,doc) => n + doc.bytes.length, 0),
    manifestSha256: lock.manifestSha256, pilotLockSha256: pilotLockDigest(lock), modelCalls: 0 }));
}

async function enrolledStudy(manifest) {
  const input = study(manifest);
  const approved = readApprovedSourceLock();
  const { deriveHumanSourceLock } = await import('../direct.mjs');
  const { lock } = await deriveHumanSourceLock(input, approved);
  return { ...input, lock, pilotLockSha256: pilotLockDigest(lock) };
}

function workspace(id, accountsPath) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const actor = readJSON(accountsPath).find(account => account.name === 'binh' && account.role === 'reviewer' && !account.disabled);
  assert.match(actor?.key ?? '', digest, 'Missing operator access on the pilot host');
  const headers = { Authorization: 'Basic ' + Buffer.from(actor.name + ':' + actor.key).toString('base64') };
  const base = '/api/patents/cases/' + id;
  const get = async path => {
    assert.ok(path === base || path.startsWith(base + '/'));
    const result = await fetch(origin + path, { headers, redirect: 'error', signal: AbortSignal.timeout(45000) });
    assert.ok(result.ok, 'Workspace read failed HTTP ' + result.status);
    return result;
  };
  return {
    matter: async () => (await get(base)).json(),
    release: async number => (await get(base + '/releases/' + number)).json(),
    async word(number, expected) {
      const result = await get(base + '/word/' + number);
      assert.match(expected, digest);
      const bytes = Buffer.from(await result.arrayBuffer());
      assert.equal(result.headers.get('x-artifact-sha256'), expected);
      assert.equal(sha(bytes), expected);
      assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK');
      return expected;
    },
    async pdf(document, expected) {
      const url = new URL(document.openUrl, origin);
      assert.equal(url.origin, origin);
      assert.match(url.pathname, /\/pdf\/[a-f0-9-]{36}\/download$/);
      const result = await get(url.pathname);
      assert.equal(result.headers.get('x-source-sha256'), expected);
      assert.equal(sha(Buffer.from(await result.arrayBuffer())), expected);
    }
  };
}

function verifyWorkspaceSources(matter, entry, lock, pilotLockSha256) {
  assert.equal(matter.synthetic, false);
  assert.equal(matter.anonymized, true);
  assert.equal(matter.reference, lock.reference);
  assert.equal(matter.context?.asOf, lock.asOf);
  assert.equal(matter.pilotLockSha256, pilotLockSha256);
  assert.equal(matter.claimText, entry.claim.quote);
  assert.equal(matter.noticeText, entry.notice.quote);
  const docs = verifyLockedDocuments(matter.documents, lock);
  const [, claim, d1] = docs;
  assert.equal(matter.claimRecordId, claim.recordId);
  assert.deepEqual(matter.d1RecordIds, [d1.recordId]);
  for (const [doc, quote] of [[claim, entry.claim.quote], [d1, entry.d1.quote]]) {
    const pinned = matter.pinnedEvidence.find(item => item.record.id === doc.recordId);
    assert.equal(pinned?.record.text, quote);
    assert.equal(pinned?.record.locator.page, doc.page);
    assert.equal(pinned?.source.sha256, doc.sha256);
  }
  return docs;
}

function verifyRelease(release, entry, phase, lock, pilotLockSha256) {
  verifyWorkspaceSources(release, entry, lock, pilotLockSha256);
  assert.equal(release.number, phase);
  assert.equal(release.instructionsText, phase === 1 ? entry.instructions : entry.phase2Instructions);
  for (const section of ['matrix','response']) {
    const approval = release.sections[section]?.approval;
    assert.equal(approval?.by?.name, 'binh');
    assert.equal(approval.by.role, 'reviewer');
    assert.equal(approval.reviewedEvidence, true);
    assert.match(approval.sha256, digest);
  }
  assert.match(release.artifact?.sha256, digest);
}

function neutral(quality) {
  const output = structuredClone(quality);
  output.title = output.caseId;
  output.sources = output.sources.map(item => ({ ...item, label: roles[item.role] }));
  assert.ok(!/\bpdf-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/iu.test(JSON.stringify(output)),
    'Output contains an internal identifier. Resolve exact source aliases before sealing blind packets.');
  return output;
}

function reviewerText(packets) {
  const quote = text => String(text ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .split('\n').map(line => '> ' + line).join('\n');
  const lines = ['# Hai bài chấm mù', '', 'Đọc thang chấm đi kèm. Chấm riêng mỗi mã trên cả hai phiên.'];
  for (const packet of packets) {
    lines.push('', '## Mã ' + packet.id);
    for (const phase of packet.phases) {
      lines.push('', '### Phiên ' + phase.phase, '', 'Yêu cầu giao việc', '', quote(phase.task),
        '', 'Chỉ dẫn đang áp dụng', '', quote(phase.instructions), '', 'Nguồn đã khóa');
      for (const source of phase.sources) {
        lines.push('', '**' + source.label + ' · Trang PDF ' + source.page + '**', '', quote(source.quote));
      }
      lines.push('', '#### Ma trận');
      for (const [index,row] of phase.matrix.entries()) {
        lines.push('', '**Hàng ' + (index + 1) + '**', '',
          quote([row.feature, 'Yêu cầu bảo hộ · ' + row.claimQuote, 'D1 · ' + row.d1Quote,
            'Trạng thái · ' + row.assessment, 'Nhận định · ' + row.analysis, 'Cần xác minh · ' + row.missing].join('\n')));
      }
      lines.push('', '#### Phản hồi', '', quote(phase.response.text),
        '', 'Vai trò nguồn đã viện dẫn · ' + phase.response.sources.join(', '));
      if (phase.phase === 2) lines.push('', 'Biên nhận · Ma trận và Word 1 giữ nguyên.');
    }
  }
  return lines.join('\n') + '\n';
}

async function checkpoint(manifest, id, accounts, checkpointFile) {
  outsideCheckout(checkpointFile);
  const { entry, lock, manifestSha256, pilotLockSha256 } = await enrolledStudy(manifest);
  assert.ok(!existsSync(checkpointFile), 'First-session proof already sealed');
  const api = workspace(id, accounts);
  const matter = await api.matter();
  verifyWorkspaceSources(matter, entry, lock, pilotLockSha256);
  assert.equal(matter.releases.length, 1, 'Capture the first Word before session 2');
  const release = await api.release(1);
  verifyRelease(release, entry, 1, lock, pilotLockSha256);
  const word1 = await api.word(1, release.artifact.sha256);
  write(checkpointFile, { caseId: id, manifestSha256, pilotLockSha256, word1,
    matrixApproval: release.sections.matrix.approval.sha256, matrixSha256: sha(JSON.stringify(release.sections.matrix)),
    at: new Date().toISOString() });
}

async function collect(manifest, id, accounts, checkpointFile, directDir, observerDir, outputDir) {
  outsideCheckout(outputDir);
  const { entry, lock, manifestSha256, pilotLockSha256 } = await enrolledStudy(manifest);
  const { verifyHumanPhase } = await import('../direct.mjs');
  const recorded = readJSON(checkpointFile);
  assert.equal(recorded.caseId, id);
  assert.equal(recorded.manifestSha256, manifestSha256);
  assert.equal(recorded.pilotLockSha256, pilotLockSha256);
  const direct = readJSON(join(directDir, 'direct.json'));
  assert.equal(direct.manifestSha256, manifestSha256);
  assert.equal(direct.pilotLockSha256, pilotLockSha256);
  assert.equal(direct.syntheticOnly, false);
  assert.equal(direct.anonymized, true);
  assert.equal(direct.model, modelId);
  assert.equal(direct.modelProvider, 'ai-gateway.vercel.sh');
  assert.equal(direct.humanReview, 'operator_attested');
  const directMatter = direct.cases[entry.id];
  assert.equal(directMatter.reference, entry.reference);
  const api = workspace(id, accounts);
  const matter = await api.matter();
  const docs = verifyWorkspaceSources(matter, entry, lock, pilotLockSha256);
  assert.equal(matter.releases.length, 2);
  const accepted = matter.proposals.filter(proposal => proposal.type === 'model');
  assert.equal(accepted.length, 2);
  for (const proposal of accepted) {
    assert.equal(proposal.run?.model, modelId);
    assert.equal(proposal.run?.provider, direct.modelProvider);
    assert.equal(proposal.run?.pilotLockSha256, pilotLockSha256);
    verifyLockedDocuments(proposal.documents, lock);
  }
  assert.deepEqual(accepted.map(p => p.targets), [['matrix','response'],['response']]);
  await Promise.all(docs.map(doc => api.pdf(doc, doc.sha256)));
  for (const doc of docs) assert.equal(sha(readFileSync(join(directDir, 'direct-workspace', entry.id + '-' + doc.role + '.pdf'))), doc.sha256);

  const productPhases = [], directPhases = [];
  const proof = { model: modelId, pilotLockSha256,
    sourceHashes: docs.map(({role,sha256,page,start,end,textSha256}) => ({role,sha256,page,start,end,textSha256})),
    workspaceWordHashes: [], directWordHashes: [] };
  assert.ok(direct.modelAttempts.every(attempt => attempt.pilotLockSha256 === pilotLockSha256));
  for (const phase of [1,2]) {
    const release = await api.release(phase);
    verifyRelease(release, entry, phase, lock, pilotLockSha256);
    proof.workspaceWordHashes.push(await api.word(phase, release.artifact.sha256));
    assert.equal(release.sections.matrix.approval.sha256, recorded.matrixApproval);
    assert.equal(sha(JSON.stringify(release.sections.matrix)), recorded.matrixSha256);
    const workspaceQuality = qualityView(release, entry, phase);
    const comparison = directMatter.phases[phase];
    assert.ok(comparison?.quality && comparison.approvals);
    const saved = verifyHumanPhase(directDir, entry, phase, comparison, lock, pilotLockSha256);
    assert.equal(saved.instructionsText, release.instructionsText);
    const actualQuality = qualityView(saved, entry, phase);
    assert.deepEqual(comparison.quality.matrix, actualQuality.matrix);
    assert.deepEqual(comparison.quality.response, actualQuality.response);
    assert.equal(comparison.quality.instructions, workspaceQuality.instructions);
    assert.equal(comparison.quality.task, workspaceQuality.task);
    for (const role of Object.keys(roles)) {
      const baseline = comparison.quality.sources.find(source => source.role === role);
      const locked = entry[role];
      assert.ok(baseline && baseline.page === locked.page && baseline.quote === locked.quote && baseline.sha256 === locked.sha256);
    }
    for (const section of ['matrix','response']) {
      const approval = comparison.approvals[section];
      assert.equal(approval?.by?.name, 'binh');
      assert.equal(approval.reviewedEvidence, true);
      assert.equal(approval.provenance, 'operator_attested');
      assert.match(approval.sha256, digest);
    }
    assert.match(comparison.wordSha256, digest);
    proof.directWordHashes.push(comparison.wordSha256);
    if (phase === 2) {
      assert.equal(comparison.quality.matrixPreserved, true);
      assert.equal(comparison.quality.word1Preserved, true);
      assert.equal(comparison.matrixSha256, directMatter.phases[1].matrixSha256);
      assert.deepEqual(comparison.approvals.matrix, directMatter.phases[1].approvals.matrix);
      workspaceQuality.matrixPreserved = true;
      workspaceQuality.word1Preserved = true;
    }
    productPhases.push(neutral(workspaceQuality));
    directPhases.push(neutral(comparison.quality));
  }
  assert.equal(proof.workspaceWordHashes[0], recorded.word1);
  for (const values of [proof.workspaceWordHashes, proof.directWordHashes]) assert.notEqual(values[0], values[1]);
  for (const phase of [1,2]) {
    const accepted = direct.modelAttempts.filter(a => a.caseId === entry.id && a.phase === phase && a.status.startsWith('accepted'));
    assert.deepEqual(accepted.map(a => a.stage).sort(), ['generate','select_tool']);
  }

  const clocks = ['product','direct'].flatMap(arm => [1,2].map(phase =>
    readJSON(join(observerDir, [entry.id,arm,'phien' + phase].join('-') + '.json'))));
  const effort = pairedEffort(clocks, entry.id);
  assert.ok(Date.parse(recorded.at) <= Math.min(...clocks.filter(clock => clock.phase === 2).map(clock => Date.parse(clock.startedAt))),
    'Session 2 predates the first Workspace Word checkpoint');
  const out = directory(resolve(outputDir));
  const reviewer = directory(join(out,'reviewer'));
  const blind = [
    { id: randomBytes(7).toString('hex'), arm: 'product', phases: productPhases },
    { id: randomBytes(7).toString('hex'), arm: 'direct', phases: directPhases }
  ].sort((a,b) => a.id.localeCompare(b.id));
  write(join(out,'operator-evidence.json'), { manifestSha256, proof, effort, workspaceModelRuns: accepted.length,
    directModelAttempts: direct.modelAttempts.length });
  write(join(out,'blind-key.json'), Object.fromEntries(blind.map(({ id, arm }) => [id, arm])));
  const packets = blind.map(({ id, phases }) => ({ id, phases }));
  write(join(reviewer,'phieu-cham-mu.json'), { caseId: entry.id, packets });
  writeFileSync(join(reviewer,'PHIEU-CHAM-MU.md'), reviewerText(packets), { mode: 0o600, flag: 'wx' });
  writeFileSync(join(reviewer,'THANG-CHAM.md'), readFileSync(new URL('./RUBRIC.md',import.meta.url)), { mode: 0o600, flag: 'wx' });
  write(join(reviewer,'diem-mau.json'), { independentReviewer: false, reviewerCode: '', possibleUnblinding: '',
    scores: blind.map(({id}) => ({ id, criteria: Object.fromEntries(criteria.map(key => [key, null])),
      critical: [], note: '' })) });
}

function score(outputDir, gradesPath) {
  const grades = readJSON(gradesPath);
  assert.equal(grades.independentReviewer, true);
  assert.match(grades.reviewerCode ?? '', /^[A-Za-z0-9_-]{2,32}$/);
  assert.notEqual(grades.reviewerCode.toLowerCase(),'binh');
  assert.equal(grades.scores.length,2);
  const packets = readJSON(join(outputDir,'reviewer','phieu-cham-mu.json')).packets;
  const ids = new Set(packets.map(packet => packet.id));
  for (const row of grades.scores) {
    assert.ok(ids.delete(row.id), 'Unknown or duplicate blind identifier');
    assert.deepEqual(Object.keys(row.criteria).sort(), [...criteria].sort());
    assert.ok(Object.values(row.criteria).every(n => Number.isInteger(n) && n >= 0 && n <= 2));
    assert.ok(Array.isArray(row.critical) && row.critical.every(item =>
      criticalCodes.has(item.code) && [1,2].includes(item.phase) && typeof item.evidence === 'string' && item.evidence.trim()));
  }
  const evidence = readJSON(join(outputDir,'operator-evidence.json'));
  const gradeSha256 = sha(readFileSync(gradesPath));
  write(join(outputDir,'score-seal.json'), { gradeSha256, at: new Date().toISOString() });
  const labels = readJSON(join(outputDir,'blind-key.json'));
  const scores = Object.fromEntries(grades.scores.map(row => {
    const points = Object.values(row.criteria).reduce((a,b) => a+b,0);
    return [labels[row.id],{ points, pass: points >= 8 && !row.critical.length, critical: row.critical, note: row.note }];
  }));
  write(join(outputDir,'result.json'), { evidence, scores, reviewer: grades.reviewerCode, gradeSha256,
    possibleUnblinding: grades.possibleUnblinding ?? null, n: 1 });
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'preflight' && args.length === 2) await preflight(...args);
else if (mode === 'checkpoint' && args.length === 4) await checkpoint(...args);
else if (mode === 'collect' && args.length === 7) await collect(...args);
else if (mode === 'score' && args.length === 2) score(...args);
else throw new Error('Usage: pilot.mjs preflight MANIFEST CONFIG | checkpoint MANIFEST CASE_UUID ACCOUNTS CHECKPOINT | collect MANIFEST CASE_UUID ACCOUNTS CHECKPOINT DIRECT_DIR OBSERVER_DIR OUT | score OUT FILLED_GRADES');
console.log('Đã lưu biên nhận ' + mode + '.');

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJSON, sha256, validateApproval, validateBundle } from './bundle.mjs';
import { approvedSourceUrl, buildCandidate } from './technical.mjs';

const file = name => new URL('./' + name, import.meta.url);
const json = name => JSON.parse(readFileSync(file(name), 'utf8'));
const input = () => json('source_canonical/inputs.json');
const candidate = () => validateBundle(json('candidate.json'), 'preview');

function optional(name) {
  try { return json(name); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function atomicJSON(name, data) {
  const temp = file(name + '.writing-' + process.pid);
  writeFileSync(temp, canonicalJSON(data), { flag: 'wx' });
  renameSync(temp, file(name));
}

function log(entry) {
  appendFileSync(file('verify-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

function assertCurrent(bundle) {
  const rebuilt = buildCandidate(input());
  if (rebuilt.digest !== bundle.digest) throw new Error('DRIFT: dữ liệu gốc đã thay đổi. Tái dựng và duyệt lại bản ứng viên.');
  try {
    execFileSync(process.execPath, [fileURLToPath(file('verify-cases.mjs')), bundle.digest], {
      env: { ...process.env, DAI_TIN_CORPUS_MODE: 'preview' }, stdio: 'inherit', timeout: 10000
    });
  } catch {
    throw new Error('REVIEW_CASES: bộ ca nghiệp vụ chưa qua đối chiếu.');
  }
}

function sourceChecks(registry) {
  let journal;
  try { journal = readFileSync(file('verify-log.jsonl'), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') journal = '';
    else throw error;
  }
  const latest = new Map();
  for (const line of journal.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line);
    if (entry.action === 'probe') latest.set(entry.source, entry);
  }
  const cutoff = Date.parse(registry.checkedThrough + 'T00:00:00+07:00');
  const missing = [];
  const drift = [];
  for (const [source, doc] of Object.entries(registry.documents)) {
    const entry = latest.get(source);
    if (!entry || !(Date.parse(entry.at) >= cutoff)) missing.push(source);
    else if (entry.status === 'error' || entry.observedSha256 !== doc.sha256) drift.push(entry);
  }
  return { missing, drift };
}

function probe(id) {
  const data = input();
  if (!Object.hasOwn(data.registry.documents, id)) throw new Error('Chọn ID nguồn trong danh mục.');
  const doc = data.registry.documents[id];
  if (data.sources[id]?.permissions?.snapshot !== 'local_review') throw new Error('Nguồn chưa được phép kiểm bản lưu.');
  try {
    const url = approvedSourceUrl(doc.url);
    const max = 24 * 1024 * 1024;
    let response;
    try {
      response = execFileSync('curl', ['-q', '--silent', '--show-error', '--fail',
        '--proto', '=https', '--max-time', '15', '--max-filesize', String(max),
        '--write-out', '%{http_code}', '--url', url.href], {
        maxBuffer: max + 3, timeout: 17000, stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      throw new Error('Không đối chiếu được nguồn qua HTTPS: ' + (error.stderr?.toString().trim() || error.code || 'curl'));
    }
    const status = response.subarray(-3).toString();
    const bytes = response.subarray(0, -3);
    if (status !== '200' || bytes.length > max) {
      throw new Error('HTTP ' + status + ' hoặc nguồn quá giới hạn.');
    }
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Nguồn trả về dữ liệu khác PDF.');
    const observedSha256 = sha256(bytes);
    const changed = observedSha256 !== doc.sha256;
    if (changed) {
      mkdirSync(file('incoming/'), { recursive: true });
      const target = file('incoming/' + id + '-' + observedSha256 + '.pdf');
      try { writeFileSync(target, bytes, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const report = { action: 'probe', source: id, status: changed ? 'changed' : 'unchanged', observedSha256 };
    log(report);
    console.log(JSON.stringify(report, null, 2));
    if (changed) process.exitCode = 2;
  } catch (error) {
    log({ action: 'probe', source: id, status: 'error', detail: error.message });
    throw error;
  }
}

const [action, arg] = process.argv.slice(2);
try {
  if (action === 'build') {
    const bundle = buildCandidate(input());
    atomicJSON('candidate.json', bundle);
    log({ action, status: 'pass', digest: bundle.digest, evidence: Object.keys(bundle.payload.pageProof).length });
    console.log('Ứng viên', bundle.payload.registry.release, bundle.digest);
  } else if (action === 'check') {
    const bundle = candidate();
    assertCurrent(bundle);
    const { drift } = sourceChecks(bundle.payload.registry);
    if (drift.length) throw new Error('DRIFT: cần rà nguồn ' + drift.map(entry => entry.source).join(', '));
    log({ action, status: 'pass', digest: bundle.digest });
    console.log('PASS', bundle.digest);
  } else if (action === 'publish') {
    const bundle = candidate();
    const approval = optional('approval.json');
    validateApproval(approval, bundle);
    assertCurrent(bundle);
    const { drift, missing } = sourceChecks(bundle.payload.registry);
    if (drift.length) throw new Error('DRIFT: cần rà nguồn ' + drift.map(entry => entry.source).join(', '));
    if (missing.length) throw new Error('SOURCE_NOT_PROBED: cần đối chiếu ' + missing.join(', '));
    atomicJSON('published.json', { ...bundle, approval });
    log({ action, status: 'pass', digest: bundle.digest, reviewer: approval.reviewer.name });
    console.log('Đã phát hành', bundle.digest);
  } else if (action === 'status') {
    const staged = candidate();
    const published = optional('published.json');
    if (published) validateBundle(published, 'published');
    let approvalError = null;
    try { validateApproval(optional('approval.json'), staged); }
    catch (error) { approvalError = error.message; }
    const { drift, missing } = sourceChecks(staged.payload.registry);
    console.log(JSON.stringify({
      release: staged.payload.registry.release, digest: staged.digest,
      sourceCount: Object.keys(staged.payload.registry.documents).length,
      evidenceCount: Object.keys(staged.payload.pageProof).length,
      reviewCases: staged.payload.reviewCases.length, openGaps: staged.payload.gaps.length,
      approvalError, published: published?.digest ?? null, sourceDrift: drift, sourcesPendingProbe: missing
    }, null, 2));
  } else if (action === 'probe') {
    probe(arg);
  } else {
    throw new Error('Dùng build | check | status | publish | probe <source-id>');
  }
} catch (error) {
  if (action && action !== 'probe') log({ action, status: 'fail', detail: error.message });
  console.error(error.message);
  process.exitCode = 2;
}

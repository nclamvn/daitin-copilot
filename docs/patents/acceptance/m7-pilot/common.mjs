import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export const modelId = 'google/gemini-2.5-flash-lite';
export const roles = ['notice', 'claim', 'd1'];
export const sha = value => createHash('sha256').update(value).digest('hex');
export const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));
export const timestamp = () => new Date().toISOString();
export function writeJSON(file, value) {
  const temporary = file + '.next';
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, file);
}
export function directory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

export function loadCases(path, limit = 8, { anonymized = false } = {}) {
  const bytes = readFileSync(path);
  const value = JSON.parse(bytes.toString('utf8'));
  assert.equal(value.version, 1);
  assert.ok(Array.isArray(value.cases) && (anonymized
    ? value.cases.length >= 1 && value.cases.length <= 8
    : value.cases.length === 8), 'Invalid number of registered cases');
  assert.ok(anonymized ? value.synthetic === false && value.anonymized === true
    : value.synthetic !== false && value.anonymized !== true, 'Manifest class does not match this runner');
  const root = anonymized ? dirname(realpathSync(path)) : dirname(resolve(path));
  const seen = new Set();
  const references = new Set();
  const cases = value.cases.map(entry => {
    if (!anonymized) assert.ok(entry?.anonymized !== true && entry?.synthetic !== false, 'Use the human pilot runner for this case');
    assert.match(entry.id, /^P0[1-8]$/);
    assert.ok(!seen.has(entry.id), 'Duplicate case identifier');
    seen.add(entry.id);
    assert.match(entry.reference, /^[A-Z0-9][A-Z0-9._/-]{1,47}$/);
    assert.ok(!references.has(entry.reference), 'Duplicate case reference');
    references.add(entry.reference);
    for (const key of ['title', 'asOf', 'instructions', 'phase1Task', 'phase2Instructions', 'phase2Task']) {
      assert.ok(typeof entry[key] === 'string' && entry[key].trim(), 'Missing case field ' + key);
    }
    assert.ok(entry.instructions !== entry.phase2Instructions, 'Second session requires distinct instructions');
    assert.ok(entry.phase1Task.length <= 600 && entry.phase2Task.length <= 600);
    if (anonymized) {
      const date = new Date(entry.asOf + 'T00:00:00.000Z');
      assert.ok(Number.isFinite(+date) && date.toISOString().slice(0, 10) === entry.asOf &&
        entry.instructions.length <= 6000 && entry.phase2Instructions.length <= 6000 && entry.title.length <= 120,
      'Invalid pilot date or metadata length');
    }
    const documents = roles.map(role => {
      const spec = entry[role];
      assert.ok(spec && typeof spec.file === 'string' && !isAbsolute(spec.file));
      const resolved = resolve(root, spec.file);
      const path = anonymized ? realpathSync(resolved) : resolved;
      assert.ok(path.startsWith(root + sep) && Number.isInteger(spec.page) && spec.page >= 1 && spec.page <= 12);
      assert.ok(typeof spec.quote === 'string' && spec.quote === spec.quote.trim() &&
        spec.quote.length >= (anonymized ? 1 : 20) && spec.quote.length <= (anonymized ? 1800 : 1400));
      assert.ok(typeof spec.label === 'string' && spec.label.length <= 100 && spec.label.trim());
      if (anonymized && (spec.start !== undefined || spec.end !== undefined)) {
        assert.ok(Number.isInteger(spec.start) && spec.start >= 0 && spec.end === spec.start + spec.quote.length,
          'Selected offsets must bind the exact quote');
      }
      const original = readFileSync(path);
      assert.equal(sha(original), spec.sha256, `Original hash mismatch for ${entry.id}/${role}`);
      assert.ok(original.length <= 2 * 1024 * 1024 && original.subarray(0, 5).toString() === '%PDF-');
      return { ...spec, role, path, original };
    });
    assert.equal(new Set(documents.map(item => item.sha256)).size, roles.length, 'Use distinct originals for each role');
    if (anonymized) assert.ok(documents.reduce((total, doc) => total + doc.original.length, 0) <= 2 * 1024 * 1024,
      'The registered PDF pack exceeds 2 MiB');
    return { ...entry, ...(anonymized ? { synthetic: false, anonymized: true } : {}), documents };
  });
  return { cases: cases.slice(0, limit), manifestSha256: sha(bytes) };
}

export function openLedger(out, arm, manifestSha256, cases, { human = false } = {}) {
  const path = join(out, arm + '.json');
  const state = existsSync(path) ? readJSON(path) : {
    version: 1, arm, manifestSha256, model: modelId, syntheticOnly: !human, humanReview: null, humanActiveMs: null,
    ...(human ? { anonymized: true, mode: 'human' } : {}),
    startedAt: timestamp(), actions: [], modelAttempts: [], cases: {}
  };
  assert.equal(state.arm, arm);
  assert.equal(state.mode === 'human', human, 'Do not mix human and automated ledgers');
  assert.equal(state.manifestSha256, manifestSha256, 'Run directory is bound to its original manifest');
  for (const entry of cases) state.cases[entry.id] ??= { reference: entry.reference, phases: {} };
  const save = () => writeJSON(path, state);
  const append = event => { state.actions.push(event); save(); };
  save();
  return { state, save, append };
}

export function track(ledger, actor, caseId, phase, action, metadata = {}) {
  ledger.append({ actor, caseId, phase, action, ...metadata });
}

export async function measure(ledger, actor, caseId, phase, action, fn, describe = () => ({})) {
  const start = performance.now();
  try {
    const value = await fn();
    track(ledger, actor, caseId, phase, action, { elapsedMs: Math.round(performance.now() - start), ...describe(value) });
    return value;
  } catch (error) {
    track(ledger, actor, caseId, phase, action, { elapsedMs: Math.round(performance.now() - start), outcome: 'failed' });
    throw error;
  }
}

const logicalStage = item => `${item.caseId}:${item.phase}:${item.stage}`;
const isRateLimit = receipt => receipt.providerStatus === 429 && receipt.status === 'failed_or_uncertain';
export const maxExplicitRateLimitRetries = 8;

export function checkAttemptBudget(product, direct) {
  let retries = 0;
  let logicalStages = 0;
  for (const [attempts, cap] of [[product, 16], [direct, 32]]) {
    const stages = Map.groupBy(attempts, logicalStage);
    assert.ok(stages.size <= cap);
    logicalStages += stages.size;
    for (const history of stages.values()) {
      if (history.length === 1) continue;
      assert.ok(history.length === 2 && isRateLimit(history[0]) && history[1].retryOf === history[0].attemptedAt,
        'Only explicit provider rate limits may be manually retried once');
      retries++;
    }
  }
  assert.ok(retries <= maxExplicitRateLimitRetries);
  return { plannedStageCap: 48, httpAttemptCap: 48 + maxExplicitRateLimitRetries,
    logicalStages, retries429: retries, httpAttempts: product.length + direct.length };
}

export function beginModel(ledger, caseId, phase, stage, cap, { retry429 = false } = {}) {
  const { modelAttempts } = ledger.state;
  const key = logicalStage({ caseId, phase, stage });
  const history = modelAttempts.filter(item => logicalStage(item) === key);
  const previous = history[0];
  if (previous && !(retry429 && history.length === 1 && isRateLimit(previous) &&
      Date.now() - Date.parse(previous.attemptedAt) >= 75000 &&
      modelAttempts.filter(item => item.retryOf).length < maxExplicitRateLimitRetries)) {
    throw new Error(`Previous ${stage} attempt exists for ${caseId} phase ${phase}; never replay automatically`);
  }
  if (!previous) assert.ok(new Set(modelAttempts.map(logicalStage)).size < cap, 'Model stage limit reached');
  const receipt = { caseId, phase, stage, attemptedAt: timestamp(), status: 'dispatch_pending',
    ...(previous ? { retryOf: previous.attemptedAt } : {}) };
  modelAttempts.push(receipt);
  ledger.save();
  return receipt;
}

function maskRecordIds(text, ids) {
  let normalized = text;
  for (const [id, label] of ids) normalized = normalized.replace(new RegExp(RegExp.escape(id), 'gi'), label);
  return normalized;
}

export function qualityView(matter, entry, phase) {
  const ids = new Map([[matter.claimRecordId, 'CLAIM'], ['case:claim', 'CLAIM'], ['case:notice', 'NOTICE'], ['case:instructions', 'INSTRUCTIONS']]);
  for (const id of matter.d1RecordIds) ids.set(id, 'D1');
  ids.delete(null);
  ids.delete(undefined);
  const clean = text => maskRecordIds(typeof text === 'string' ? text : '', ids);
  return {
    caseId: entry.id, phase, title: entry.title, asOf: entry.asOf,
    task: phase === 1 ? entry.phase1Task : entry.phase2Task,
    instructions: phase === 1 ? entry.instructions : entry.phase2Instructions,
    sources: entry.documents.map(({ role, label, page, quote, sha256 }) => ({ role, label, page, quote, sha256 })),
    matrix: matter.sections.matrix.rows.map(row => ({ feature: clean(row.feature), claimQuote: row.claimQuote,
      d1Quote: row.d1Quote, d1Role: row.d1RecordId ? ids.get(row.d1RecordId) ?? 'UNKNOWN' : null,
      assessment: row.assessment, analysis: clean(row.analysis), missing: clean(row.missing) })),
    response: { text: clean(matter.sections.response.text), sources: matter.sections.response.evidenceIds.map(id => ids.get(id) ?? 'UNKNOWN') }
  };
}

export function blind(out, input) {
  const ledger = arm => readJSON(join(out, arm + '.json'));
  const product = ledger('product');
  const direct = ledger('direct');
  assert.equal(product.manifestSha256, input.manifestSha256);
  assert.equal(direct.manifestSha256, input.manifestSha256);
  const budget = checkAttemptBudget(product.modelAttempts, direct.modelAttempts);
  const mapPath = join(out, 'blind-key.json');
  if (existsSync(mapPath) || existsSync(join(out, 'blind-packets.json'))) throw new Error('Blind mapping already frozen');
  const results = [];
  const mapping = [];
  for (const entry of input.cases) {
    for (const arm of ['product', 'direct']) {
      const data = arm === 'product' ? product : direct;
      const item = data.cases[entry.id];
      const blindId = randomBytes(7).toString('hex');
      const aliases = new Map([['pdf-claim', 'CLAIM'], ['pdf-d1', 'D1']]);
      for (const attempt of data.modelAttempts.filter(attempt => attempt.caseId === entry.id)) {
        for (const span of attempt.run?.selectedSpans ?? []) {
          if (span.claim?.recordId) aliases.set(span.claim.recordId, 'CLAIM');
          if (span.d1?.recordId) aliases.set(span.d1.recordId, 'D1');
        }
      }
      const phases = [1, 2].map(phase => {
        const view = item.phases[phase]?.quality;
        if (!view) return { caseId: entry.id, phase, unavailable: true };
        // The saved view may predate case-insensitive alias masking.
        const normalize = text => maskRecordIds(text, aliases);
        return { ...view, matrix: view.matrix.map(row => ({
          ...row, feature: normalize(row.feature), analysis: normalize(row.analysis), missing: normalize(row.missing)
        })), response: { ...view.response, text: normalize(view.response.text) } };
      });
      results.push({ blindId, caseId: entry.id, phases });
      mapping.push({ blindId, caseId: entry.id, arm, reference: item.reference, caseIdOnServer: item.caseId ?? null });
    }
  }
  results.sort((a, b) => a.blindId.localeCompare(b.blindId));
  writeJSON(join(out, 'blind-packets.json'), { version: 1, syntheticOnly: true, packets: results });
  writeJSON(mapPath, { version: 1, manifestSha256: input.manifestSha256, totalModelAttempts: budget.httpAttempts, budget, mapping });
  return { packets: results.length, complete: results.filter(item => item.phases.every(phase => !phase.unavailable)).length };
}

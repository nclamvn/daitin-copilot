import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const work = resolve(process.argv[2]);
const read = name => JSON.parse(readFileSync(resolve(work, name), 'utf8'));
const runs = read('runs.json');
const key = read('blind-key.private.json');
const blind = read('mechanical-blind.json');
assert.equal(runs.length, 8);
assert.equal(key.length, 32);
assert.equal(blind.length, 32);
const answers = new Map(key.map(row => [row.code, row]));
const samples = blind.map(row => ({ ...row, arm: answers.get(row.code).arm }));
const sum = values => values.reduce((a, b) => a + b, 0);
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
}
const ms = (row, field) => row[field] ?? 0;
const phases = [1, 2];
const models = new Set(runs.flatMap(row => ['workspace', 'direct'].flatMap(arm =>
  phases.flatMap(phase => row[arm][phase].run?.model ? [row[arm][phase].run.model] : []))));
assert.ok(models.size <= 1, 'Hai nhánh phải dùng cùng một model.');
const summary = {};
for (const arm of ['workspace', 'direct']) {
  const completed = runs.filter(row => phases.every(phase => row[arm][phase].status === 'complete'));
  const runsByPhase = Object.fromEntries(phases.map(phase => [phase, runs.map(row => row[arm][phase])]));
  const all = Object.values(runsByPhase).flat();
  const grading = samples.filter(sample => sample.arm === arm);
  summary[arm] = {
    completeCases: completed.length,
    completeOutputs: all.filter(row => row.status === 'complete').length,
    blindPass: grading.filter(row => row.status === 'pass').length,
    blindScoreMedianOutOf8: median(grading.flatMap(row => row.total == null ? [] : [row.total])),
    critical: grading.filter(row => row.critical).length,
    rawRework: all.reduce((count, row) => count + Object.keys(row.issues ?? {}).length, 0),
    heldSections: all.reduce((count, row) => count + (row.run?.held?.length ?? 0), 0),
    phaseWallMedianMs: Object.fromEntries(phases.map(phase => [phase, median(runsByPhase[phase]
      .filter(row => row.status === 'complete').map(row => row.wallMs))])),
    wallMedianMs: median(completed.map(row => sum(phases.map(phase => ms(row[arm][phase], 'wallMs'))))),
    modelMedianMs: median(completed.map(row => sum(phases.map(phase => row[arm][phase].run?.elapsedMs ?? 0)))),
    outsideModelMedianMs: median(completed.map(row => sum(phases.map(phase =>
      Math.max(0, ms(row[arm][phase], 'wallMs') - (row[arm][phase].run?.elapsedMs ?? 0)))))),
    actionsTotal: sum(all.map(row => row.actions?.length ?? 0)),
    actionReplayMedianMs: median(completed.map(row => sum(phases.flatMap(phase =>
      (row[arm][phase].actions ?? []).filter(step => step.name !== 'Gọi agent để nhận bản nháp').map(step => step.ms))))),
    misses: runs.flatMap(row => phases.filter(phase => row[arm][phase].status !== 'complete').map(phase =>
      ({ case: row.id, phase, error: row[arm][phase].error }))),
    reworkDetails: runs.flatMap(row => phases.filter(phase => Object.keys(row[arm][phase].issues ?? {}).length).map(phase =>
      ({ case: row.id, phase, issues: row[arm][phase].issues })))
  };
}
let equalInput = 0;
let equalWord = 0;
let completePairs = 0;
const pairs = [];
for (const row of runs) {
  for (const phase of phases) {
    const a = row.workspace[phase];
    const b = row.direct[phase];
    if (a.run && b.run && a.run.inputSha256 === b.run.inputSha256) equalInput += 1;
    if (a.sha && b.sha && a.sha === b.sha) equalWord += 1;
    if (a.status === 'complete' && b.status === 'complete') completePairs += 1;
  }
  if (phases.every(phase => row.workspace[phase].status === 'complete' && row.direct[phase].status === 'complete')) {
    const workspaceMs = sum(phases.map(phase => row.workspace[phase].wallMs));
    const directMs = sum(phases.map(phase => row.direct[phase].wallMs));
    pairs.push({ case: row.id, workspaceMs, directMs, relativeWallDifference: (workspaceMs - directMs) / directMs });
  }
}
console.log(JSON.stringify({
  mode: 'automated-pilot-rehearsal', caseCount: runs.length, model: [...models][0] ?? null,
  wordLayout: 'daitin-v2', humanActiveTime: null, humanLegalScore: null,
  equalInput, equalWord, completePairs, pairs, summary
}, null, 2));

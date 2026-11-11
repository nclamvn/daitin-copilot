import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from '../../m3/workflow.mjs';
import { reviewDraft } from './actor.mjs';

const dir = resolve(process.argv[2]);
const read = name => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const runs = read('runs.private.json');
const scores = read('blind-scores.json');
const canaries = read('canary-scores.json');
const lock = read('scores.lock.json');
const sealed = read('sealed.json');
assert.ok(scores.every(score => score.configHash === lock.configHash));
assert.ok(canaries.every(score => score.configHash === lock.configHash));
assert.equal(hash(JSON.stringify(read('grading-conditions.json'))), lock.configHash);
assert.equal(lock.manifestDigest, sealed.manifestDigest);
assert.equal(lock.scoreDigest, hash(JSON.stringify(scores)));
assert.equal(lock.canaryDigest, hash(JSON.stringify(canaries)));
assert.equal(lock.packetsDigest, hash(readFileSync(resolve(dir, 'packets.json'))));
assert.equal(sealed.runDigest, hash(readFileSync(resolve(dir, 'runs.private.json'))));
const manifest = read('manifest.json');
assert.equal(manifest.length, scores.length);
assert.equal(hash(JSON.stringify(manifest)), lock.manifestDigest);
// The arm key is first loaded only after verifying the saved scores.
const key = new Map(read('arm-key.private.json').map(row => [row.code, row.arm]));
assert.equal(key.size, manifest.length);
const revealed = scores.map(item => ({ ...item, arm: key.get(item.code) }));
const sum = values => values.reduce((a, b) => a + b, 0);
const median = values => {
  if (!values.length) return null;
  const ordered = values.toSorted((a, b) => a - b);
  return (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.ceil((ordered.length - 1) / 2)]) / 2;
};
const cohorts = {
  lookup: runs.filter(row => !row.id.startsWith('W')),
  twoSession: runs.filter(row => row.id.startsWith('W'))
};
const result = {
  schema: 'm5-pilot-evidence-2', conditions: read('conditions.json'), grading: read('grading-conditions.json'),
  scoreLock: lock, humanActiveMs: null, humanLegalScore: null, qualityByArm: {}, timingByArm: {}, pairs: [],
  failures: revealed.filter(item => item.status !== 'pass').map(item => ({
    code: item.code, case: item.case, phase: item.phase, arm: item.arm, status: item.status,
    mechanical: item.structural.notes, semantic: item.semantic?.verdict, error: item.error ?? null
  })),
  blocked: [], equalModelInputPairs: 0, comparedModelInputPairs: 0, equalWordPairs: 0,
  equalLookupPairs: 0, retainedSectionPairs: 0
};
for (const arm of ['workspace', 'direct']) {
  const all = runs.flatMap(row => Object.values(row[arm]));
  const quality = revealed.filter(row => row.arm === arm);
  result.qualityByArm[arm] = {
    artifacts: quality.length,
    mechanicalPass: quality.filter(row => row.structural.status === 'pass').length,
    simulatedPass: quality.filter(row => row.status === 'pass').length,
    unscored: quality.filter(row => row.status === 'unscored').length,
    mechanicalCritical: quality.filter(row => row.structural.critical).length,
    semanticCritical: quality.filter(row => row.semantic?.verdict.critical).length,
    semanticScoreMedianOutOf8: median(quality.flatMap(row => row.total == null ? [] : [row.total])),
    completeCases: runs.filter(row => Object.values(row[arm]).every(item => item.status === 'complete')).length,
    casesPassingAllOutputs: runs.filter(row => quality.filter(sample => sample.case === row.id).length === (row.id.startsWith('W') ? 2 : 1) &&
      quality.filter(sample => sample.case === row.id).every(sample => sample.status === 'pass')).length,
    rawRepairSections: sum(all.map(row => Object.keys(row.review?.edits ?? {}).length))
  };
  result.timingByArm[arm] = {};
  for (const [cohort, rows] of Object.entries(cohorts)) {
    const complete = rows.filter(row => Object.values(row[arm]).every(item => item.status === 'complete'));
    const measures = complete.map(row => {
      const phases = Object.values(row[arm]);
      const actions = phases.flatMap(phase => phase.actions);
      const wall = sum(phases.map(phase => phase.outerWallMs));
      const generator = sum(phases.map(phase => phase.run?.elapsedMs ?? 0));
      return {
        wall, generator, outside: wall - generator, actions: actions.length,
        gestures: actions.filter(action => action.kind === 'gesture').length,
        tools: actions.filter(action => action.kind === 'tool').length,
        characters: sum(actions.map(action => action.characters ?? 0))
      };
    });
    result.timingByArm[arm][cohort] = {
      completeCases: complete.length,
      outerWallMedianMs: median(measures.map(row => row.wall)),
      generatorMedianMs: cohort === 'twoSession' ? median(measures.map(row => row.generator)) : 0,
      outsideGeneratorMedianMs: median(measures.map(row => row.outside)),
      actionCountMedian: median(measures.map(row => row.actions)),
      physicalGesturesMedian: arm === 'workspace' ? median(measures.map(row => row.gestures)) : null,
      fileToolOperationsMedian: arm === 'direct' ? median(measures.map(row => row.tools)) : null,
      textEnteredMedianCharacters: arm === 'workspace' ? median(measures.map(row => row.characters)) : null
    };
  }
  result.blocked.push(...runs.flatMap(row => Object.entries(row[arm]).filter(([, p]) => p.status !== 'complete').map(([phase, p]) =>
    ({ case: row.id, arm, phase, error: p.error }))));
}
for (const row of cohorts.lookup) {
  if (JSON.stringify(row.workspace[0]?.answer) === JSON.stringify(row.direct[0]?.answer)) result.equalLookupPairs += 1;
}
for (const row of cohorts.twoSession) {
  const pair = { case: row.id, workspaceMs: sum(Object.values(row.workspace).map(p => p.outerWallMs)),
    directMs: sum(Object.values(row.direct).map(p => p.outerWallMs)) };
  pair.relativeWallReduction = 1 - pair.workspaceMs / pair.directMs;
  result.pairs.push(pair);
  for (const phase of [1, 2]) {
    const a = row.workspace[phase];
    const b = row.direct[phase];
    if (a.run && b.run) {
      result.comparedModelInputPairs += 1;
      if (a.run.inputSha256 === b.run.inputSha256) result.equalModelInputPairs += 1;
    }
    if (a.wordSha256 && a.wordSha256 === b.wordSha256) result.equalWordPairs += 1;
  }
  for (const arm of ['workspace', 'direct']) {
    const first = row[arm][1].release;
    const second = row[arm][2].release;
    if (first && second && ['findings', 'attachments'].every(k => JSON.stringify(first.sections[k]) === JSON.stringify(second.sections[k]))) {
      result.retainedSectionPairs += 1;
    }
  }
}
result.medianMachineWallReduction = median(result.pairs.map(row => row.relativeWallReduction));
result.canaries = {
  expected: 6, provided: canaries.length, mechanicalDetected: canaries.filter(row => row.structural.status === 'check').length,
  semanticDetected: canaries.filter(row => row.semantic && (row.semantic.verdict.critical || row.total < 8)).length,
  semanticCriticalDetected: canaries.filter(row => row.semantic?.verdict.critical).length,
  details: canaries.map(row => ({ code: row.code, mechanical: row.structural.notes,
    semantic: row.semantic?.verdict, status: row.status, error: row.error ?? null }))
};
result.judgeRequests = [...scores, ...canaries].filter(row => row.semantic && !row.semantic.cacheHit).length;
result.judgeCacheHits = [...scores, ...canaries].filter(row => row.semantic?.cacheHit).length;
const calibrationControls = read('blind-scores-labels-calibration.json');
const calibrationFaults = read('canary-scores-labels-calibration.json');
const calibrationLock = read('scores.lock-labels-calibration.json');
assert.equal(calibrationLock.scoreDigest, hash(JSON.stringify(calibrationControls)));
assert.equal(calibrationLock.canaryDigest, hash(JSON.stringify(calibrationFaults)));
result.judgeCalibration = {
  originalNumericProtocol: 'invalid for acceptance; score and explanation contradictions observed',
  labelProtocolValidControls: calibrationControls.filter(row => row.status === 'pass').length,
  labelProtocolControls: calibrationControls.length,
  labelProtocolFaults: calibrationFaults.length,
  labelProtocolSemanticWarnings: calibrationFaults.filter(row => row.semantic && row.total < 8).length,
  labelProtocolSemanticCritical: calibrationFaults.filter(row => row.semantic?.verdict.critical).length,
  labelProtocolMechanicalDetected: calibrationFaults.filter(row => row.structural.status === 'check').length,
  usableForLegalAcceptance: false,
  independentQualityEstimate: null
};
const fixtures = new Map(read('fixtures.private.json').map(row => [row.id, row]));
const rechecked = cohorts.twoSession.flatMap(row => ['workspace', 'direct'].flatMap(arm =>
  Object.entries(row[arm]).filter(([, record]) => record.raw).map(([phase, record]) => ({
    case: row.id, arm, phase, previous: record.review, rechecked: reviewDraft(fixtures.get(row.id), record.raw, Number(phase))
  }))));
result.actorPolicyReplay = {
  evidence: 'post-hoc replay over existing raw drafts; original timings and artifacts retained',
  drafts: rechecked.length, remainingRepairs: rechecked.filter(row => Object.keys(row.rechecked.edits).length).length
};
writeFileSync(resolve(dir, 'actor-policy-replay.json'), JSON.stringify({ ...result.actorPolicyReplay, rows: rechecked }, null, 2));
result.sensitivityWithoutW04 = {
  case: 'W04', reason: 'old actor policy treated an explicit replacement sentence as stale content',
  medianMachineWallReduction: median(result.pairs.filter(row => row.case !== 'W04').map(row => row.relativeWallReduction))
};
result.decision = {
  technicalSimulation: result.blocked.length === 0 && Object.values(result.qualityByArm).every(arm => arm.mechanicalPass === arm.artifacts) &&
    result.canaries.provided === 6 && result.canaries.mechanicalDetected === 6 ? 'pass' : 'needs_review',
  simulatedSemanticJudge: 'failed_calibration',
  humanEffortTarget20Percent: 'not_measured',
  independentLegalAcceptance: 'not_measured',
  milestone: 'technical simulation evidence only; legal and human-use gates remain open'
};
writeFileSync(resolve(dir, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ decision: result.decision, quality: result.qualityByArm, timing: result.timingByArm,
  failures: result.failures, canaries: result.canaries, judgeRequests: result.judgeRequests, judgeCacheHits: result.judgeCacheHits }, null, 2));

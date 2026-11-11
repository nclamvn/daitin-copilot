import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkAttemptBudget, readJSON, writeJSON } from './common.mjs';

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const sum = values => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
const complete = row => Boolean(row.phases[1]?.wordSha256 && row.phases[2]?.wordSha256);

function summarizeArm(ledger, caseIds) {
  const phase = (id, number) => {
    const item = ledger.cases[id] ?? {};
    const result = item.phases?.[number];
    const events = ledger.actions.filter(e => e.caseId === id && e.phase === number);
    const attempts = ledger.modelAttempts.filter(e => e.caseId === id && e.phase === number);
    const modelDuration = stage => {
      const event = attempts.findLast(a => a.stage === stage && a.status.startsWith('accepted'));
      return event?.run?.elapsedMs ?? event?.elapsedMs ?? null;
    };
    const actions = events.filter(e => e.actor === 'operator').map(e => e.action);
    return {
      outcome: result?.wordSha256 ? 'complete' : 'incomplete',
      ...(item.errors?.[number] ? { recordedError: item.errors[number] } : {}),
      setupElapsedMs: number === 1 ? item.prepareElapsedMs ?? null : null,
      phaseElapsedMs: result?.elapsedMs ?? null,
      pacingElapsedMs: sum(events.filter(e => e.actor === 'pacing').map(e => e.elapsedMs)),
      generationElapsedMs: modelDuration('generate'),
      toolSelectionElapsedMs: modelDuration('select_tool'),
      httpRequests: events.filter(e => ['http', 'model'].includes(e.actor)).length,
      toolExecutions: events.filter(e => e.actor === 'tool').length,
      modelAttempts: attempts.length,
      scriptedOperatorActions: actions.length,
      actionLabels: actions,
      wordSha256: result?.wordSha256 ?? null
    };
  };
  const rows = caseIds.map(id => ({ id, phases: { 1: phase(id, 1), 2: phase(id, 2) } }));
  return { rows,
    complete: rows.filter(complete).length,
    sessionRuns: ledger.sessionRuns ?? [],
    sessionActions: ledger.actions.filter(e => e.actor === 'operator' && e.caseId === null),
    modelAttempts: ledger.modelAttempts.length,
    acceptedGenerations: ledger.modelAttempts.filter(a => a.stage === 'generate' && a.status.startsWith('accepted')).length,
    generationTokens: {
      prompt: sum(ledger.modelAttempts.filter(a => a.stage === 'generate').map(a => a.run?.promptTokens ?? a.promptTokens)),
      completion: sum(ledger.modelAttempts.filter(a => a.stage === 'generate').map(a => a.run?.completionTokens ?? a.completionTokens))
    },
    toolSelectionTokens: {
      prompt: sum(ledger.modelAttempts.filter(a => a.stage === 'select_tool').map(a => a.promptTokens)),
      completion: sum(ledger.modelAttempts.filter(a => a.stage === 'select_tool').map(a => a.completionTokens))
    }
  };
}

export function summarize(out, input) {
  const caseIds = input.cases.map(item => item.id);
  const ledgers = ['product', 'direct'].map(name => readJSON(join(out, name + '.json')));
  for (const ledger of ledgers) assert.equal(ledger.manifestSha256, input.manifestSha256);
  const [product, direct] = ledgers.map(ledger => summarizeArm(ledger, caseIds));
  const paired = product.rows.filter(row => complete(row) && complete(direct.rows.find(item => item.id === row.id))).map(row => row.id);
  const comparable = arm => {
    const rows = arm.rows.filter(row => paired.includes(row.id));
    const values = accessor => rows.map(accessor).filter(Number.isFinite);
    const totals = (row, field) => [row.phases[1][field], row.phases[2][field]].every(Number.isFinite)
      ? row.phases[1][field] + row.phases[2][field] : null;
    return {
      pairedCases: rows.length,
      medianPhase1Ms: median(values(row => row.phases[1].phaseElapsedMs + (row.phases[1].setupElapsedMs ?? 0))),
      medianPhase2Ms: median(values(row => row.phases[2].phaseElapsedMs)),
      medianTotalMs: median(values(row => totals(row, 'phaseElapsedMs') + (row.phases[1].setupElapsedMs ?? 0))),
      medianDraftModelMs: median(values(row => totals(row, 'generationElapsedMs'))),
      medianPacingMs: median(values(row => totals(row, 'pacingElapsedMs'))),
      medianOperatorActions: median(values(row => totals(row, 'scriptedOperatorActions'))),
      medianPhase1OperatorActions: median(values(row => row.phases[1].scriptedOperatorActions)),
      medianPhase2OperatorActions: median(values(row => row.phases[2].scriptedOperatorActions))
    };
  };
  const budget = checkAttemptBudget(ledgers[0].modelAttempts, ledgers[1].modelAttempts);
  const summary = { version: 1, manifestSha256: input.manifestSha256, requiredCases: 8, paired, budget, humanActiveMs: null,
    humanReviewer: null, product, direct, comparison: { product: comparable(product), direct: comparable(direct) } };
  writeJSON(join(out, 'summary.json'), summary);
  return { requiredCases: 8, pairedCases: paired.length, productComplete: product.complete, directComplete: direct.complete,
    modelAttempts: product.modelAttempts + direct.modelAttempts, comparison: summary.comparison };
}

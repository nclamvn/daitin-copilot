import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { emailCases } from './cases.mjs';
import { gradeSubmission } from './grade.mjs';

const directory = process.argv[2];
const read = file => JSON.parse(readFileSync(directory + '/' + file, 'utf8'));
const write = (file, value) => writeFileSync(directory + '/' + file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const technical = readFileSync(directory + '/benchmark.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const browser = [...read('browser.json'), ...read('direct-browser.json')];
assert.equal(technical.length, 32);
assert.equal(browser.length, 32);
const masked = read('blind.json');
const copies = new Map(technical.map(result => {
  const ui = browser.find(row => row.case === result.fixture && row.session === result.session && row.arm === result.arm);
  assert.ok(ui, result.code);
  return [result.code, ui];
}));
const submissions = masked.submissions.map(row => {
  const ui = copies.get(row.code);
  assert.ok(ui, row.code);
  const sections = ui.sections?.map(({ id, text, pending, ids }) => ({ id, text, pending, ids })) ?? row.sections;
  return { ...row, sections, client: ui.outputs.client ?? '', partner: ui.outputs.partner ?? '' };
});
assert.equal(submissions.length, 32);
write('blind-copies.json', { ...masked, submissions });
const scores = submissions.map(gradeSubmission);
write('blind-scores.json', { type: 'Kiểm tự động trên phiếu văn bản sao chép đã ẩn nhánh', scores });
const initialScores = masked.submissions.map(gradeSubmission);
write('blind-initial-scores.json', { type: 'Kiểm tự động trên bản nháp đầu tiên đã ẩn nhánh', scores: initialScores });

// Only join the labels after writing the masked score sheet.
const median = list => {
  const sorted = [...list].sort((a,b) => a-b);
  return list.length ? (sorted[Math.floor((list.length - 1) / 2)] + sorted[Math.floor(list.length / 2)]) / 2 : null;
};
const comparable = [];
const byCase = [];
for (const fixture of emailCases) {
  const pairs = technical.filter(row => row.fixture === fixture.id);
  assert.equal(pairs.length, 4);
  assert.equal(new Set(pairs.map(row => row.sourceHash)).size, 1);
  assert.equal(new Set(pairs.map(row => row.model.model)).size, 1);
  const bothPass = pairs.every(row => scores.find(score => score.code === row.code)?.pass);
  if (bothPass) comparable.push(fixture.id);
  const arms = Object.fromEntries(['chatbot', 'direct'].map(arm => [arm, {
    sessions: pairs.filter(row => row.arm === arm).map(row => {
      const result = scores.find(score => score.code === row.code);
      const measured = browser.find(run => run.case === fixture.id && run.arm === arm && run.session === row.session);
      return { session: row.session, pass: result.pass, actions: measured.actions, repairActions: measured.repairActions ?? 0,
        ...(row.model.error ? { modelError: row.model.error } : {}) };
    }),
  }]));
  byCase.push({ case: fixture.id, bothPass, ...arms });
}
const results = Object.fromEntries(['chatbot','direct'].map(arm => {
  const armRows = technical.filter(row => row.arm === arm);
  const grades = scores.filter(score => armRows.some(row => row.code === score.code));
  const ui = browser.filter(row => row.arm === arm);
  const totals = emailCases.map(fixture => ui.filter(row => row.case === fixture.id).reduce((n, row) => n + row.actions, 0));
  const withoutSourceClicks = emailCases.map(fixture => ui.filter(row => row.case === fixture.id)
    .reduce((n, row) => n + row.actions - (row.sourceActions ?? 0), 0));
  const subset = emailCases.filter(fixture => comparable.includes(fixture.id));
  const matched = subset.map(fixture => ui.filter(row => row.case === fixture.id).reduce((n, row) => n + row.actions, 0));
  return [arm, { passedSessions: grades.filter(row => row.pass).length,
    initialPassedSessions: initialScores.filter(row => row.pass && armRows.some(entry => entry.code === row.code)).length,
    agentRevisions: ui.reduce((sum, row) => sum + (row.agentRevisions ?? 0), 0),
    manualRevisions: ui.reduce((sum, row) => sum + (row.manualRevisions ?? 0), 0),
    repairActions: ui.reduce((sum, row) => sum + (row.repairActions ?? 0), 0),
    repairModelMs: ui.reduce((sum, row) => sum + (row.repairModelMs ?? 0), 0),
    checks: Object.fromEntries(['coverage','facts','citations','draft'].map(key => [key, grades.filter(row => row[key]).length])),
    modelCompleted: armRows.filter(row => !row.model.error).length,
    medianModelMs: median(armRows.filter(row => !row.model.error).map(row => row.model.elapsedMs)),
    medianActionsTwoSessions: median(totals), medianActionsComparableCases: median(matched),
    ...(ui.some(row => row.sourceActions !== undefined) ? { medianActionsIfAllSourcesInline: median(withoutSourceClicks) } : {}),
    medianAutomationMsPerSession: median(ui.map(row => row.automationMs)) }];
}));
const actionDelta = (results.chatbot.medianActionsTwoSessions / results.direct.medianActionsTwoSessions - 1) * 100;
const matchedDelta = comparable.length
  ? (results.chatbot.medianActionsComparableCases / results.direct.medianActionsComparableCases - 1) * 100 : null;
const report = { cases: 8, sessionsPerCase: 2, comparable, actionDeltaPercent: Math.round(actionDelta * 10) / 10,
  matchedActionDeltaPercent: matchedDelta === null ? null : Math.round(matchedDelta * 10) / 10, results, byCase };
write('summary.json', report);
console.log(JSON.stringify(report, null, 2));

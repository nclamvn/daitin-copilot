import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createIndex } from './retrieval.mjs';
import { libraryAnswer } from './answer.mjs';
import { createLibraryModel } from './model.mjs';

import { cases } from './acceptance-cases.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const bytes = readFileSync(new URL('./index.json', import.meta.url));
const bundle = JSON.parse(bytes);
const index = createIndex(bundle);
const invoke = createLibraryModel();
if (!invoke) throw new Error('Cần model thật cho cả hai nhánh.');
const interval = Number(process.env.DAI_TIN_ACCEPTANCE_INTERVAL_MS ?? 0);
if (!Number.isSafeInteger(interval) || interval < 0 || interval > 60000) throw new Error('Khoảng cách giữa lượt gọi chưa hợp lệ.');
let lastDispatch = 0;
async function model(query, sources) {
  await delay(Math.max(0, lastDispatch + interval - Date.now()));
  lastDispatch = Date.now();
  try {
    return await invoke(query, sources);
  } catch (error) {
    if (error.status !== 429 || error.retryAfter < 1 || error.retryAfter > 65) throw error;
    console.log('Gateway giới hạn lượt gọi. Chờ', error.retryAfter, 'giây theo Retry-After.');
    await delay(error.retryAfter * 1000 + 500);
    lastDispatch = Date.now();
    return invoke(query, sources);
  }
}
const destination = process.argv[2];
if (!destination) throw new Error('Cần tệp biên nhận JSON.');

function grade(answer, expected, expectedIds, facts, allIds) {
  const material = [answer.title, answer.body, ...(answer.notes ?? [])].join(' ');
  const decision = answer.kind === expected;
  const exact = expectedIds.every(id => answer.ids.includes(id)) && answer.ids.every(id => allIds.has(id));
  const content = facts.every(expression => expression.test(material));
  const email = expected === 'supported' ? Boolean(answer.email?.trim()) && facts.every(expression => expression.test(answer.email))
    : !answer.email || /xác nhận|làm rõ/i.test(answer.email);
  return { decision, exact, content, email, pass: decision && exact && content && email };
}

const corpusSHA256 = createHash('sha256').update(bytes).digest('hex');
const receipt = existsSync(destination) ? JSON.parse(readFileSync(destination)) : null;
if (receipt && receipt.corpusSHA256 !== corpusSHA256) throw new Error('Tệp biên nhận thuộc corpus khác.');
const rows = receipt?.rows ?? [];
function save() {
  rows.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(destination, JSON.stringify({ corpusSHA256, completed: rows.length, planned: cases.length, rows }, null, 2) + '\n');
}
for (const [id, query, expected, sources, facts, scenario = 'library'] of cases) {

  // Direct agent gets a tool that reads the entire applicable fixture pack.
  // This corpus fits a single model context and gives the direct arm all distractors and updates.
  const corpus = bundle.rows.filter(row => row.layers.includes(scenario));
  const allIds = new Set(corpus.map(row => row.id));
  const previous = rows.find(row => row.id === id && row.query === query);
  if (previous) {
    const replay = await libraryAnswer(index, query, scenario, async (_question, candidates) => {
      if (JSON.stringify(candidates.map(row => row.id)) !== JSON.stringify(previous.workspace.candidateIds)) {
        throw new Error('Bộ đoạn đã thay đổi.');
      }
      return previous.workspace.run;
    }, { measure: true });
    if (!replay.run) throw new Error('Cần chạy lại ' + id + ' · ' + replay.modelError);
    previous.workspace = { ...replay, ids: replay.citations.map(row => row.id) };
    for (const name of ['workspace', 'direct']) previous[name].grade = grade(previous[name], expected, sources, facts, allIds);
    continue;
  }
  const runs = [
    async () => {
      const result = await libraryAnswer(index, query, scenario, model, { measure: true });
      return { ...result, ids: result.citations.map(row => row.id) };
    },
    async () => {
      const run = await model(query, corpus);
      return { kind: run.status, body: run.answer, email: run.email, ids: run.ids, run };
    },
  ];
  if (Number(id.slice(1)) % 2 === 0) runs.reverse();
  const first = await runs[0]();
  const second = await runs[1]();
  const [workspace, direct] = Number(id.slice(1)) % 2 === 0 ? [second, first] : [first, second];
  if (!workspace.run || !direct.run || workspace.run.model !== direct.run.model) throw new Error('Thiếu kết quả cùng model ở ' + id + ' · ' + (workspace.modelError ?? 'sai cấu hình'));
  rows.push({ id, query, scenario, expected, sources,
    workspace: { ...workspace, grade: grade(workspace, expected, sources, facts, allIds) },
    direct: { ...direct, grade: grade(direct, expected, sources, facts, allIds) },
  });
  console.log(id, workspace.kind, direct.kind, workspace.run.tokens, direct.run.tokens);
  save();
}
save();
for (const name of ['workspace', 'direct']) {
  const results = rows.map(row => row[name]);
  console.log(name, Object.fromEntries(['decision', 'exact', 'content', 'email', 'pass'].map(key =>
    [key, results.filter(item => item.grade[key]).length])), 'totalTokens',
    results.reduce((sum, item) => sum + (item.run.tokens ?? 0), 0));
}

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerChat } from '../service.mjs';
import { createChatModel } from '../model.mjs';
import { procedureSources } from '../../public/answer.mjs';
import { questions, threads } from './cases.mjs';

const directory = process.argv[2];
if (!directory) throw Error('Chỉ định thư mục kết quả.');
const gateway = process.argv.includes('--gateway');
const configuration = { endpoint: gateway ? 'https://ai-gateway.vercel.sh/v1/chat/completions' : '' };
const only = process.env.DAI_TIN_M20_CASES?.split(',');
const planner = createChatModel(configuration, { localOnly: !gateway });
const direct = createChatModel(configuration, { localOnly: !gateway, direct: true });
if (!planner || !direct) throw Error('Cần cấu hình cùng model cho cả hai nhánh.');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const journal = join(directory, 'runs.jsonl');
writeFileSync(journal, '', { flag: 'wx', mode: 0o600 });
const intervalMs = Number(process.env.DAI_TIN_M20_INTERVAL_MS ?? (gateway ? 13300 : 0));
let nextCall = 0;
const pace = run => async data => {
  const start = Math.max(Date.now(), nextCall);
  nextCall = start + intervalMs;
  if (start > Date.now()) await new Promise(resolve => setTimeout(resolve, start - Date.now()));
  return run(data);
};
const pacedPlanner = pace(planner);
const pacedDirect = pace(direct);
const asOf = '2026-11-18';
const official = [...procedureSources('vn-renewal'), ...procedureSources('th-annuity')].map(row =>
  ({ id: row.id, procedure: row.procedure, field: row.field, statement: row.statement, quote: row.quote, source: row.locator,
    title: row.title, ...(row.until ? { until: row.until } : {}), ...(row.year ? { year: row.year } : {}) }));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const blind = [];
const review = [];
const mailbox = (draft, pending) => {
  const parts = draft?.sections.filter(item => item.pending === pending) ?? [];
  return parts.map(section => section.title + '\n' + section.text).join('\n\n');
};

function partner(id, scope, statement, value, date, supersedes = []) {
  return { id, scope, statement, quote: statement, title: 'Hướng dẫn đối tác giả lập ' + id,
    clientText: statement, value, date, supersedes, issuer: 'partner-test', reviewed: true, kind: 'email',
    simulated: true, paragraph: 1 };
}

function partnerRows(event, session) {
  if (event === 'conflict' && session === 2) return [partner('partner-c1', ['vn','tm','renew','poa'],
    'Hãng cho rằng khi nộp qua đại diện không cần giấy ủy quyền.', 'none', '2026-11-17')];
  if (event !== 'replacement') return [];
  const old = partner('partner-r1', ['th','pt','annuity','poa'],
    'Hãng đề nghị chuẩn bị POA đã ký khi nộp qua hãng.', 'agent-signed', '2026-10-12');
  const next = partner('partner-r2', old.scope,
    'Hãng đề nghị xác nhận từng hồ sơ với DIP trước khi yêu cầu khách ký POA.', 'verify-office-record', '2026-11-17', [old.id]);
  return session === 2 ? [old, next] : [old];
}

async function execute({ fixture, session, query, expected, previous, priorQuery, directPrior }) {
  const rows = partnerRows(fixture.sourceEvent, session);
  const corpus = [...official, ...rows.map(({ scope, ...row }) => ({ ...row, scope: scope.join('/') }))];
  const sourceHash = sha(corpus);
  const gate = () => answerChat(query, previous, { model: pacedPlanner, rows, asOf, measure: true });
  const baseline = async () => {
    try {
      return await pacedDirect({ question: query, asOf, previousMessage: priorQuery ?? null,
        previousAnswer: directPrior ?? null, sources: corpus });
    } catch (error) { return { error: error.message }; }
  };
  let product, raw;
  if ((Number(fixture.id.slice(1)) + session) % 2) [product, raw] = await Promise.all([gate(), baseline()]);
  else [raw, product] = await Promise.all([baseline(), gate()]);
  const output = raw.output;
  const draft = product.draft;
  const outputs = [
    ['workspace', product.sections.map(({ label, text, missing, contextClaims }) => [label, text || missing,
      ...(contextClaims?.length ? ['Quy tắc chung để đối chiếu', ...contextClaims.map(claim => claim.text)] : [])].join('\n')).join('\n\n'),
      mailbox(draft, false), mailbox(draft, true), product.citations.map(item => item.id), product.modelRun],
    ['direct', output?.answer, output?.client, output?.verification, output?.citations, raw],
  ];
  for (const [arm, answer, client, verification, citations, call] of outputs) {
    const code = randomBytes(6).toString('hex');
    const ids = Array.isArray(citations) ? citations.filter(id => typeof id === 'string') : [];
    const keyIds = arm === 'workspace' ? product.sections.flatMap(section => section.pending ? [] : section.ids) : ids;
    const unresolved = arm === 'workspace' ? product.sections.some(section => section.pending) : Boolean(verification?.trim());
    const noUnsupportedFee = ids.filter(id => /^th-fee-\d+$/.test(id)).every(id => expected.includes(id));
    const checked = expected.every(id => id === '?' ? unresolved : keyIds.includes(id)) &&
      ids.every(id => corpus.some(item => item.id === id)) && noUnsupportedFee &&
      (expected.includes('?') || !unresolved) && (expected.some(id => id !== '?') || (arm === 'workspace' ? !client : !client?.trim()));
    const item = { code, case: fixture.id, session, query, previousMessage: priorQuery ?? null,
      answer: answer ?? '', client: client ?? '', verification: verification ?? '', citations: ids, sourceHash };
    blind.push(item);
    review.push({ code, arm, case: fixture.id, session, checked, expected, sourceHash, model: call?.model,
      elapsedMs: call?.elapsedMs, tokens: call?.tokens, error: call?.error });
    appendFileSync(journal, JSON.stringify({ ...review.at(-1), output: item }) + '\n');
  }
  console.log(fixture.id, session, ...review.slice(-2).map(row => row.error || (row.checked ? 'ok' : 'review')));
  return { previous: draft?.inputs ?? [], directPrior: output, draft };
}

const tasks = [
  ...questions.filter(item => !only || only.includes(item.id)).map(fixture => async () => execute({ fixture, session: 1, query: fixture.question, expected: fixture.expected })),
  ...threads.filter(item => !only || only.includes(item.id)).map(fixture => async () => {
    const first = await execute({ fixture, session: 1, query: fixture.first, expected: fixture.expected[0] });
    await execute({ fixture, session: 2, query: fixture.next, expected: fixture.expected[1], priorQuery: fixture.first, ...first });
  }),
];
const corpora = { [sha(official)]: official };
for (const fixture of threads.filter(item => item.sourceEvent)) for (const session of [1, 2]) {
  const corpus = [...official, ...partnerRows(fixture.sourceEvent, session).map(({ scope, ...row }) => ({ ...row, scope: scope.join('/') }))];
  corpora[sha(corpus)] = corpus;
}
const workers = Array.from({ length: gateway ? 1 : 2 }, async () => {
  for (let next = tasks.shift(); next; next = tasks.shift()) await next();
});
await Promise.all(workers);
const write = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
write('blind.json', { asOf, simulation: true, criteria: ['Đúng từng câu hỏi', 'Điều kiện và hiệu lực', 'Căn cứ trực tiếp', 'Thư dùng được sau khi rà', 'Lỗi nghiêm trọng'],
  corpora, submissions: blind.sort((a, b) => a.code.localeCompare(b.code)) });
write('answer-key.json', review);
const summary = Object.fromEntries(['workspace', 'direct'].map(arm => {
  const records = review.filter(row => row.arm === arm);
  const latencies = records.flatMap(record => record.elapsedMs === undefined ? [] : [record.elapsedMs]).sort((a, b) => a - b);
  return [arm, { cases: records.length, structuralPass: records.filter(row => row.checked).length,
    realCalls: records.filter(row => row.model).length, errors: records.filter(row => row.error).length,
    medianModelMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null, tokens: records.reduce((sum, record) => sum + (record.tokens ?? 0), 0) }];
}));
write('summary.json', summary);
console.log(summary);

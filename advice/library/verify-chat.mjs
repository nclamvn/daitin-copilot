import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { chatCases } from './chat-cases.mjs';
import { createIndex, labels } from './retrieval.mjs';
import { createLibraryModel } from './model.mjs';
import { libraryAnswer } from './answer.mjs';

const [receipt, blind] = process.argv.slice(2);
const model = createLibraryModel({ timeoutMs: 115000 });
if (!receipt || !blind || !model) throw new Error('Cần model và hai đích biên nhận/chấm mù.');
const bundles = Object.fromEntries(['public', 'simulation'].map((mode, i) => {
  const bytes = readFileSync(new URL(i ? './index.json' : './public-index.json', import.meta.url));
  const bundle = JSON.parse(bytes);
  return [mode, { bundle, index: createIndex(bundle, { privateLibrary: !i }),
    hash: createHash('sha256').update(bytes).digest('hex') }];
}));
writeFileSync(receipt, '', { flag: 'wx', mode: 0o600 });
const blindRows = [];
const writeBlind = () => writeFileSync(blind, JSON.stringify({
  type: 'Câu hỏi diễn tập. Phiếu chấm mù chờ luật sư.',
  criteria: ['Quyết định đúng', 'Căn cứ đúng đoạn', 'Giữ điều kiện và phạm vi', 'Email trả lời hoặc hỏi xác nhận đúng mục đích'],
  cases: [...blindRows].sort((a, b) => a.code.localeCompare(b.code)),
}, null, 2) + '\n', { mode: 0o600 });

for (const [i, [scenario, query, expected, expectedIds, fact, previous]] of chatCases.entries()) {
  const isPublic = scenario === 'public';
  const { bundle, index, hash } = bundles[isPublic ? 'public' : 'simulation'];
  const layer = isPublic ? 'library' : scenario;
  const sources = bundle.rows.filter(row => row.layers.includes(layer) && row.reviewed);
  const input = previous ? query + '\nPhạm vi của lượt trước: ' + previous.map((key, j) => labels[j][key]).join(' / ') : query;
  const runProduct = async () => {
    const start = performance.now();
    const answer = await libraryAnswer(index, query, layer, model,
      { measure: true, previous, simulation: !isPublic, downloads: !isPublic });
    return { kind: answer.kind, answer: answer.body, email: answer.email, ids: answer.citations.map(row => row.id),
      model: answer.run?.model, modelError: answer.modelError, elapsedMs: Math.round(performance.now() - start) };
  };
  const runDirect = async () => {
    try {
      const result = await model(input, sources);
      return { ...result, kind: result.status };
    } catch (error) {
      return { error: error.message };
    }
  };
  const [first, second] = i % 2 ? [runDirect, runProduct] : [runProduct, runDirect];
  const a = await first();
  const b = await second();
  const arms = i % 2 ? { product: b, direct: a } : { product: a, direct: b };
  for (const [arm, result] of Object.entries(arms)) {
    const code = randomBytes(6).toString('hex');
    const ids = result.ids ?? [];
    const checks = {
      status: result.kind === expected,
      exact: expectedIds.every(id => ids.includes(id)) && ids.every(id => sources.some(row => row.id === id)),
      detail: fact.test(result.answer ?? ''),
      email: expected === 'supported' ? Boolean(result.email) : !result.email || /xác nhận|làm rõ|xác minh/i.test(result.email),
    };
    appendFileSync(receipt, JSON.stringify({ case: i + 1, code, arm, hash, scenario, expected, result, checks }) + '\n');
    const email = result.email?.replace(/^\[MÔ PHỎNG[^\n]*\]\s*/iu, '') ?? '';
    blindRows.push({ code, question: input, answer: result.answer ?? '', email, citations: ids,
      availableSources: sources.map(({ id, quote, locator, title, date }) => ({ id, quote, locator, title, date })) });
  }
  writeBlind();
  console.log('Ca', i + 1, 'chat', arms.product.kind, 'đối chứng', arms.direct.kind ?? 'lỗi model');
}

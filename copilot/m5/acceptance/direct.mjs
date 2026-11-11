import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getCatalog, resolveProcedure, search } from '../../../research.mjs';
import { createCopilot } from '../../service.mjs';
import { checkedBasis, createDraftModel, draftingFacts, hash, ids, needsReview, renderRelease, source } from '../../m3/workflow.mjs';
import { makeWord } from '../../m4/word.mjs';
import { brandedWordLayout } from '../../m4/word-brand.mjs';
import { createResearch } from '../research.mjs';
import { createTemplates } from '../templates.mjs';

const [phase, input, dir] = process.argv.slice(2);
if (!['first', 'second'].includes(phase)) throw new Error('Chọn phiên first hoặc second.');
const entry = JSON.parse(readFileSync(input, 'utf8'));
const path = resolve(dir, 'snapshot.json');
const second = phase === 'second';
const catalog = getCatalog();
const copilot = createCopilot(catalog, resolveProcedure);
const draft = createDraftModel();
let matter;
if (second) {
  matter = JSON.parse(readFileSync(path, 'utf8'));
  if (JSON.stringify(matter.basis) !== JSON.stringify(checkedBasis(copilot.review, matter.facts))) throw new Error('Căn cứ đã đổi.');
  matter.sources.push(source('update-1', entry.update.label, entry.update.text));
} else {
  const db = new DatabaseSync(':memory:');
  const proof = createResearch({ catalog, search, review: copilot.review, templates: createTemplates(db) })(entry.request, { group: 'benchmark' });
  db.close();
  if (proof.status !== 'grounded' || !proof.proofId) throw new Error('Thiếu phiếu căn cứ.');
  matter = { reference: entry.id, title: entry.title, facts: entry.facts, proofId: proof.proofId,
    basis: checkedBasis(copilot.review, entry.facts),
    sources: [source('notice', entry.notice.label, entry.notice.text), source('instructions', entry.instructions.label, entry.instructions.text)],
    sections: {}, approved: {} };
}
copilot.close();
const targets = second ? ['response'] : ids;
const result = await draft({
  facts: draftingFacts(matter), basis: matter.basis, sources: matter.sources,
  base: second ? matter.sections : undefined, targets, instruction: second ? entry.revise : entry.draft
});
Object.assign(matter.sections, result.patch);
for (const key of targets) {
  if (needsReview(matter.sections[key].text)) throw new Error('Phần cần người xác nhận.');
  matter.approved[key] = { ...matter.sections[key], draft: second ? 2 : 1 };
}
const number = second ? 2 : 1;
const markdown = renderRelease(matter, matter.approved, number);
const release = { number, basis: matter.basis, sections: matter.approved, markdown, sha256: hash(markdown) };
const word = makeWord(matter, release, brandedWordLayout);
writeFileSync(path, JSON.stringify(matter, null, 2), { mode: 0o600 });
writeFileSync(resolve(dir, phase + '.docx'), word, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ proofId: matter.proofId, run: result.run, release, wordHash: hash(word) }));

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getCatalog, resolveProcedure, search } from '../../../research.mjs';
import { createCopilot } from '../../service.mjs';
import { checkedBasis, createDraftModel, draftingFacts, hash, ids, renderRelease, source, editSections } from '../../m3/workflow.mjs';
import { makeWord } from '../../m4/word.mjs';
import { brandedWordLayout } from '../../m4/word-brand.mjs';
import { createResearch } from '../research.mjs';
import { createTemplates } from '../templates.mjs';
import { recorder, reviewDraft, safeAnswer } from './actor.mjs';

const [phase, input, folder] = process.argv.slice(2);
if (!['lookup', '1', '2'].includes(phase)) throw new Error('Chọn lookup, 1 hoặc 2.');
const entry = JSON.parse(readFileSync(input, 'utf8'));
const dir = resolve(folder);
const statePath = resolve(dir, 'state.json');
const write = (name, data) => writeFileSync(resolve(dir, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const record = { status: 'running', interaction: 'scripted-file-tools', humanActiveMs: null };
const step = recorder(record);
const start = performance.now();
const catalog = getCatalog();
const copilot = createCopilot(catalog, resolveProcedure);
const templatesDB = new DatabaseSync(':memory:');
const lookup = createResearch({ catalog, search, review: copilot.review, templates: createTemplates(templatesDB) });
try {
  if (phase === 'lookup') {
    const answer = await step('tool', 'Tra cứu có căn cứ', () => lookup(entry.request, { group: 'pilot' }));
    record.answer = safeAnswer(answer);
  } else {
    const number = Number(phase);
    let state;
    if (number === 1) {
      const proof = await step('tool', 'Tra cứu nguồn và mẫu', () => lookup(entry.request, { group: 'pilot' }));
      if (!proof.proofId) throw new Error('Chưa có căn cứ để soạn.');
      state = await step('tool', 'Lưu hồ sơ, nguồn và căn cứ vào tệp', () => ({
        reference: entry.reference, title: entry.title, facts: entry.facts, research: proof,
        basis: checkedBasis(copilot.review, entry.facts),
        sources: [source('notice', entry.notice.label, entry.notice.text), source('instructions', entry.instructions.label, entry.instructions.text)],
        sections: {}, approved: {}, releases: [], draft: 0
      }));
    } else {
      state = await step('tool', 'Mở lại tệp hồ sơ đã lưu', () => JSON.parse(readFileSync(statePath, 'utf8')));
      if (JSON.stringify(state.basis) !== JSON.stringify(checkedBasis(copilot.review, state.facts))) throw new Error('Căn cứ đã đổi.');
      await step('tool', 'Kiểm bản duyệt phiên trước', () => {
        if (hash(readFileSync(resolve(dir, 'direct-1.docx'))) !== state.firstWordHash) throw new Error('Bản duyệt cũ đã đổi.');
      });
      await step('tool', 'Thêm chỉ dẫn bổ sung', () => state.sources.push(source('update-1', entry.update.label, entry.update.text)));
    }
    const result = await step('generator', 'Gọi mô hình để soạn phần được giao', () => createDraftModel()({
      facts: draftingFacts(state), basis: state.basis, sources: state.sources, base: number === 2 ? state.sections : undefined,
      targets: number === 2 ? ['response'] : ids, instruction: number === 1 ? entry.draft : entry.revise
    }));
    state.sections = { ...state.sections, ...result.patch };
    state.draft += 1;
    record.run = result.run;
    record.raw = structuredClone(state.sections);
    record.review = await step('review-policy', 'Rà soát giả lập theo nguồn', () => reviewDraft(entry, state.sections, number));
    if (Object.keys(record.review.edits).length) await step('tool', 'Sửa các phần bị giữ', () => {
      Object.assign(state.sections, editSections(state.sections, record.review.edits));
      state.draft += 1;
    });
    for (const key of number === 1 ? ids : ['response']) {
      await step('tool', 'Duyệt phần ' + key, () => {
        state.approved[key] = { ...state.sections[key], draft: state.draft };
      });
    }
    const markdown = renderRelease(state, state.approved, number);
    const release = { number, basis: state.basis, sections: structuredClone(state.approved), markdown, sha256: hash(markdown),
      research: state.research };
    state.releases.push(release);
    const bytes = await step('tool', 'Xuất Word đã duyệt', () => {
      const word = makeWord(state, release, brandedWordLayout);
      writeFileSync(resolve(dir, 'direct-' + number + '.docx'), word, { flag: 'wx', mode: 0o600 });
      return word;
    });
    if (number === 1) state.firstWordHash = hash(bytes);
    await step('tool', 'Lưu trạng thái cho phiên tiếp theo', () => write('state.json', state));
    record.release = release;
    record.wordSha256 = hash(bytes);
    record.proofId = state.research.proofId;
  }
  record.status = 'complete';
} catch (error) {
  record.status = 'blocked';
  record.error = error.message;
} finally {
  copilot.close();
  templatesDB.close();
}
record.wallMs = Math.round(performance.now() - start);
write('direct-' + phase + '.json', record);
console.log(JSON.stringify(record));
if (record.status !== 'complete') process.exitCode = 1;

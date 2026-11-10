import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCopilot } from '../../service.mjs';
import { getCatalog, resolveProcedure } from '../../../research.mjs';
import { checkedBasis, createDraftModel, draftingFacts, editSections, hash, ids, needsReview, pick, renderRelease, source } from '../../m3/workflow.mjs';
import { bindPDF, inspectPDF } from '../pdf.mjs';
import { makeWord } from '../word.mjs';

// File tools for the direct comparator. One fresh process per session.
const [phase, planPath, work] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
if (phase === 'inspect') {
  console.log(JSON.stringify(await inspectPDF(readFileSync(plan.pdfFile)), null, 2));
  process.exit(0);
}
if (!['draft', 'revise', 'approve'].includes(phase)) throw new Error('Chọn inspect, draft, revise hoặc approve.');
const model = createDraftModel();
const copilot = createCopilot(getCatalog(), resolveProcedure);
const snapshot = resolve(work, plan.snapshot);
let state;
if (phase === 'draft') {
  const file = readFileSync(plan.pdfFile);
  const inspected = await inspectPDF(file);
  const { title, receivedOn, asOf, reference, pendingAtCutover } = plan.case;
  const facts = { asOf, receivedOn, pendingAtCutover };
  const bound = bindPDF({ ...plan.case, pdf: { ...plan.pdf, sha256: inspected.sha256, verified: true } }, inspected, file);
  state = { reference, title, facts, basis: checkedBasis(copilot.review, facts), document: bound.document,
    sources: [source('notice', bound.notice.label, bound.notice.text),
      source('instructions', 'chi-dan.txt', readFileSync(plan.instructionsFile, 'utf8'))] };
} else {
  state = JSON.parse(readFileSync(snapshot, 'utf8'));
  if (JSON.stringify(state.basis) !== JSON.stringify(checkedBasis(copilot.review, state.facts))) throw new Error('Căn cứ đã đổi.');
  if (phase === 'revise') state.sources.push(source('update-1', 'xac-nhan-moi.txt', readFileSync(plan.updateFile, 'utf8')));
}
copilot.close();

let run;
if (phase !== 'approve') {
  const result = await model({
    facts: draftingFacts(state), fromPDF: Boolean(state.document), basis: state.basis, sources: state.sources,
    base: state.draft, targets: plan.targets ?? ids,
    instruction: plan.instruction ?? 'Soạn bản phản hồi đầu tiên theo thông báo và chỉ dẫn đã chọn.'
  });
  run = result.run;
  state.draft = { ...state.draft, ...result.patch };
  state.draftNumber = (state.draftNumber ?? 0) + 1;
}
const save = () => writeFileSync(snapshot, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
if (plan.reviewOnly === true && phase !== 'approve') {
  save();
  console.log(JSON.stringify({ run, draft: state.draftNumber, sections: state.draft, approved: state.approved }, null, 2));
  process.exit(0);
}
const edits = plan.edits ?? (plan.append ? {
  [plan.append.section]: state.draft[plan.append.section].text + '\n\n' + plan.append.text
} : null);
if (edits) {
  Object.assign(state.draft, editSections(state.draft, edits));
  state.draftNumber += 1;
}
const draft = state.draftNumber;
const number = (state.releaseNumber ?? 0) + 1;
state.approved ??= {};
for (const key of pick(plan.approve, 'phần duyệt')) {
  if (needsReview(state.draft[key].text)) throw new Error('Hoàn tất phần chờ luật sư xác nhận trước khi duyệt.');
  state.approved[key] = { ...state.draft[key], draft };
}
if (ids.some(key => !Object.hasOwn(state.approved, key))) {
  save();
  console.log(JSON.stringify({ approved: Object.keys(state.approved), pendingExport: true }));
  process.exit(0);
}
const markdown = renderRelease(state, state.approved, number);
const release = { number, basis: state.basis, sections: state.approved, markdown, sha256: hash(markdown) };
const word = makeWord(state, release);
writeFileSync(resolve(work, plan.output), word, { mode: 0o600, flag: 'wx' });
state.releaseNumber = number;
save();
console.log(JSON.stringify({ run, sha256: hash(word), number, selectedDrafts: Object.fromEntries(
  Object.entries(state.approved).map(([key, value]) => [key, value.draft])) }));

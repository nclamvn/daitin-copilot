import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCopilot } from '../../service.mjs';
import { getCatalog, resolveProcedure } from '../../../research.mjs';
import { checkedBasis, createDraftModel, editSections, hash, ids, renderRelease, source } from '../workflow.mjs';

// Plain-file tool harness for the same model. The supplied plan expresses the operator's decisions.
// The second invocation starts without the first process or any conversational state.
const [phase, planFile, directory] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
const read = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const write = (name, value) => writeFileSync(resolve(directory, name),
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const loadSource = (id, filename) => source(id, filename, readFileSync(resolve(directory, filename), 'utf8'));

const copilot = createCopilot(getCatalog(), resolveProcedure);
const model = createDraftModel();
const base = phase === 'revise' ? read(plan.open) : null;
const { reference, title, receivedOn, asOf, pendingAtCutover = null } = base?.facts ?? plan.facts;
const dates = { asOf, receivedOn, pendingAtCutover };
const facts = { reference, title, ...dates };
const basis = checkedBasis(copilot.review, dates);
copilot.close();

if (base && hash(JSON.stringify(base.basis)) !== hash(JSON.stringify(basis))) {
  throw new Error('Hồ sơ hoặc căn cứ đã thay đổi.');
}
const sourceFiles = { ...base?.sourceFiles, ...plan.sources };
const sources = Object.entries(sourceFiles).map(([id, filename]) => loadSource(id, filename));
const targets = base ? plan.targets : ids;
const { patch, run } = await model({
  facts, basis, sources, base: base?.draft, targets,
  instruction: base ? plan.instruction : 'Soạn bản phản hồi đầu tiên theo thông báo và chỉ dẫn đã chọn.'
});
let draft = { ...base?.draft, ...patch };
const draftNumber = base ? 2 : 1;
write('draft-' + draftNumber + '.json', draft);
if (plan.append) {
  draft = { ...draft, ...editSections(draft, { [plan.append.section]: draft[plan.append.section].text + '\n\n' + plan.append.text }) };
  write('draft-3.json', draft);
}
const approved = { ...base?.approved };
for (const id of plan.approve) approved[id] = { ...draft[id], draft: plan.append ? 3 : draftNumber };
const number = base ? 2 : 1;
const markdown = renderRelease({ reference, title, basis }, approved, number);
write(plan.export, markdown);
write(plan.save, { facts, sourceFiles, basis, draft, approved });
console.log(JSON.stringify({ run, sha256: hash(markdown), approved, modelPatch: patch }));

import { createHash } from 'node:crypto';
import { planEmail, topics } from '../email/plan.mjs';
import { currentText, inspectQuestion, resolveInputs, validateInputs } from './intent.mjs';
import { validProposals } from './model.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const localDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format();

export function validChatRequest(body) {
  return body && typeof body.query === 'string' && body.query.trim() && body.query.length <= 12000 && !body.query.includes('\0') &&
    validateInputs(body.previous ?? []) && Object.keys(body).every(key => key === 'query' || key === 'previous');
}

export function buildChatDraft(inputs, rows = [], asOf = localDate()) {
  if (!validateInputs(inputs) || !inputs.length) return null;
  const approved = rows.filter(row => row.reviewed === true);
  const plans = inputs.map(({ historical, ...input }) => planEmail(input, approved, asOf));
  for (const [index, plan] of plans.entries()) {
    if (!plan || !inputs[index].historical) continue;
    plan.sections = plan.sections.map(section => ({ ...section, pending: true, claims: [], sources: [],
      text: 'Nhờ xác nhận ngày cơ quan tiếp nhận hồ sơ để đối chiếu phiên bản quy định và điều khoản chuyển tiếp.',
      fingerprint: digest([section.id, 'historical']),
    }));
  }
  if (plans.some(plan => !plan)) return null;
  const sections = plans.flatMap((plan, i) => plan.sections.map(section => ({
    ...section, id: inputs[i].topic + ':' + section.id,
    title: topics[inputs[i].topic].label + ' · ' + section.title,
    fingerprint: digest([inputs[i].topic, section.fingerprint]),
  })));
  return { sections, inputs, sourceVersion: digest(plans.map(plan => plan.sourceVersion)) };
}

export async function answerChat(query, previous = [], { model, rows = [], asOf = localDate(), measure = false } = {}) {
  const inspection = inspectQuestion(query, previous);
  let proposals = [];
  let modelRun;
  const planClauses = inspection.planningEntries.flatMap((entry, index) =>
    entry ? [{ clause: index + 1, topic: entry.topic, text: entry.raw }] : []);
  if (model && planClauses.length) {
    try {
      modelRun = await model({ clauses: planClauses });
      if (!validProposals(modelRun.output, inspection.planningEntries)) throw Error('Kết quả phân loại sai phạm vi.');
      proposals = modelRun.output.issues;
    } catch (error) {
      modelRun = { error: error.message };
    }
  }
  const { inputs, unmatched } = resolveInputs(inspection, previous, proposals);
  const draft = buildChatDraft(inputs, rows, asOf);
  const sections = (draft?.sections ?? []).map(section => ({
    label: section.title, text: section.pending ? '' : section.text, missing: section.pending ? section.text : '',
    ids: section.sources.map(source => source.id), pending: section.pending,
    claims: section.pending ? [] : section.claims,
    contextClaims: section.pending && section.id.endsWith(':deadline')
      ? section.sources.filter(row => row.field === 'deadline' && row.state === 'context' && row.statement)
        .map(row => ({ text: row.statement, ids: [row.id] }))
      : [],
  }));
  if (unmatched || !sections.length) sections.push({
    label: 'Phạm vi cần làm rõ', text: '', missing: 'Anh cho biết quốc gia, thủ tục và ý cần kiểm cho phần này.', ids: [], pending: true,
  });
  const ready = sections.filter(section => !section.pending).length;
  const kind = ready === sections.length ? 'supported' : ready ? 'partial' : 'missing';
  const citations = new Map();
  for (const { sources } of draft?.sections ?? []) for (const source of sources) {
    if (!citations.has(source.id) || source.state === 'active') citations.set(source.id, source);
  }
  const suggestions = [];
  if (inputs.length === 1 && sections.some(section => section.pending && section.label.includes('Phí cơ quan')) &&
      inputs[0].topic === 'th-annuity' && inputs[0].year === null) suggestions.push('Xác nhận năm niên phí');
  if (sections.some(section => section.pending && section.label.includes('Thời hạn'))) suggestions.push('Bổ sung mốc thời gian');
  const notes = [];
  if (unmatched && draft) notes.push('Bản thư chỉ gồm các mục đã xác định được thủ tục.');
  if (modelRun?.error) notes.push('Đã đối chiếu theo phạm vi nhận diện được. Anh có thể diễn đạt lại phần cần làm rõ.');
  return {
    kind, simulation: rows.some(row => row.simulated), scope: inputs.map(item => topics[item.topic].label).join(' / '),
    title: kind === 'supported' ? 'Đã đối chiếu căn cứ' : kind === 'partial' ? 'Có thể trả lời một phần' : 'Cần bổ sung để kết luận',
    sections, citations: [...citations.values()], notes, suggestions, draft, continued: inspection.follow && !inspection.reportOutside, holdDraft: inspection.ambiguousCorrection,
    ...(measure ? { modelRun: modelRun ?? null, inputLength: currentText(query).length } : {}),
  };
}

import { hash } from '../../m3/workflow.mjs';

export const normalize = value => value.normalize('NFC').replace(/\s+/gu, ' ').toLowerCase().trim();
export const bodyCitation = /(?:^|[^\p{L}\p{N}])(?:điều\s+\d+|khoản\s+\d+|thông\s+tư\s+(?:số\s+)?\d+|nghị\s+định\s+(?:số\s+)?\d+|(?:luật|tcvn)\s+(?:số\s+)?\d+)/iu;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function retainsPrevious(text, previous, current) {
  const value = normalize(text);
  const oldTerm = normalize(previous);
  const newTerm = normalize(current);
  const quoted = term => '["“]?' + escapeRegex(term) + '["”]?';
  const replacement = new RegExp(quoted(newTerm) + '\\s+(?:được xác nhận )?thay thế (?:cho )?' + quoted(oldTerm), 'gu');
  const clarification = new RegExp(quoted(oldTerm) + '\\s+(?:được )?(?:làm rõ|sửa|đổi) thành\\s+' + quoted(newTerm), 'gu');
  const remaining = value.replace(replacement, '').replace(clarification, '').replaceAll(newTerm, '');
  return remaining.includes(oldTerm);
}

// A bounded scripted participant using the supplied case sources.
// These edits are recorded as simulated intervention, never human review.
export function reviewDraft(entry, sections, phase) {
  const noticeTerm = entry.notice.text.match(/"([^"]+)"/u)?.[1];
  const quotes = (phase === 1 ? entry.instructions.text : entry.update.text).match(/"[^"]+"/gu)?.map(s => s.slice(1, -1));
  if (!noticeTerm || !quotes || quotes.length < 2) throw new Error('Nguồn tình huống thiếu cụm cần sửa.');
  const intended = phase === 1 ? quotes[1] : quotes[0];
  const attachment = entry.instructions.text.match(/tài liệu "([^"]+)"/u)?.[1];
  if (!attachment) throw new Error('Thiếu tên tài liệu trong nguồn.');
  const expected = { findings: noticeTerm, response: intended, attachments: attachment };
  const replacement = {
    findings: entry.notice.text,
    response: 'Đề nghị làm rõ cụm "' + noticeTerm + '" thành "' + intended + '" trong danh mục hàng hóa của đơn.',
    attachments: 'Dự kiến kèm tài liệu "' + attachment + '".'
  };
  const issues = {};
  const edits = {};
  for (const key of phase === 1 ? ['findings', 'response', 'attachments'] : ['response']) {
    const value = sections[key]?.text ?? '';
    const text = normalize(value);
    const stale = phase === 2 && key === 'response' && retainsPrevious(value, quotes[1], intended);
    const issue = !text || text.includes('[luật sư xác nhận]') ? 'held' : bodyCitation.test(text) ? 'citation' :
      !text.includes(normalize(expected[key])) || stale || (key === 'attachments' && !text.includes('dự kiến')) ? 'content' : null;
    if (issue) {
      issues[key] = issue;
      edits[key] = replacement[key];
    }
  }
  return { policy: 'scripted-source-check-v2', issues, edits };
}

export function recorder(record) {
  record.actions = [];
  return async (kind, name, operation, characters = 0) => {
    const start = performance.now();
    let status = 'complete';
    try {
      return await operation();
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      record.actions.push({ kind, name, ms: Math.round(performance.now() - start), characters, status });
    }
  };
}

export function safeAnswer(value) {
  const { title, status, explanation, citations, form, missing, referral, applicableOn, checkedOn, fields, coverage, template } = value;
  return { title, status, explanation, citations, form, missing, referral, applicableOn, checkedOn, fields, coverage, template };
}

export function pinRecord(state, bytes) {
  const release = state.releases.at(-1);
  return { id: state.id, reference: state.reference, research: state.research, facts: state.facts,
    release, wordSha256: hash(bytes) };
}

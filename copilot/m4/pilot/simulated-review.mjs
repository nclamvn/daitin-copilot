const normalized = value => value.normalize('NFC').replace(/\s+/gu, ' ').toLowerCase();
const reserved = /(?:^|[^\p{L}\p{N}])(?:điều\s+\d+|khoản\s+\d+|thông\s+tư\s+(?:số\s+)?\d+|nghị\s+định\s+(?:số\s+)?\d+|(?:luật|tcvl|tcvn)\s+(?:số\s+)?\d+)/iu;

export function simulatedReview(oracle, draft, phase) {
  const required = phase === 1 ? ['findings', 'response', 'attachments'] : ['response'];
  const term = /“([^”]+)”/u.exec(oracle.anchorText)[1];
  const response = phase === 1 ? oracle.old : oracle.new;
  const expected = { findings: term, response, attachments: 'bảng đối chiếu' };
  const replacement = {
    findings: oracle.anchorText,
    response: 'Đề nghị làm rõ cụm “' + term + '” thành “' + response + '” trong danh mục hàng hóa của đơn.',
    attachments: 'Bảng đối chiếu danh mục dự kiến kèm theo.'
  };
  const issues = {};
  const edits = {};
  for (const key of required) {
    const text = draft[key]?.text ?? '';
    const folded = normalized(text);
    const old = normalized(oracle.old);
    const newText = normalized(oracle.new);
    const hasWrongTerm = key === 'response' && phase === 2 && folded.replaceAll(newText, '').includes(old);
    const hasExtraAttachment = key === 'attachments' && folded.includes('bản sao thông báo');
    const issue = !text || folded.includes('[luật sư xác nhận]') ? 'held' :
      reserved.test(text) ? 'citation' : !folded.includes(normalized(expected[key])) || hasWrongTerm || hasExtraAttachment ? 'content' : null;
    if (issue) {
      issues[key] = issue;
      edits[key] = replacement[key];
    }
  }
  return { issues, edits };
}

export const prompts = [
  'Trademark Renewal in Vietnam có cần POA không?',
  'Patent Annuity in Thailand có cần POA không?',
];

export const scenarios = [
  { id: 'word', label: 'Chỉ Word' },
  { id: 'updated', label: 'Email cập nhật' },
  { id: 'conflict', label: 'Nguồn mâu thuẫn' },
];

const topics = {
  'vn-renewal': 'Việt Nam · Gia hạn nhãn hiệu',
  'th-annuity': 'Thái Lan · Duy trì hiệu lực bằng sáng chế',
};

function topicOf(question) {
  const text = question.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!/\b(poa|power of attorney|uy quyen)\b/.test(text)) return null;
  const vn = /\b(viet nam|vietnam|vn)\b/.test(text);
  const th = /\b(thai lan|thailand|th)\b/.test(text);
  if (vn === th) return null;
  const trademark = /\b(trademark|trade mark|nhan hieu)\b/.test(text);
  const patent = /\b(patent|sang che)\b/.test(text);
  const renewal = /\b(renewal|renew|gia han)\b/.test(text);
  const annuity = /\b(annuities|annuity|annual fee|annual fees|maintenance fee|maintenance fees|duy tri|nien phi)\b/.test(text);
  if (/\b(notari[sz]\w*|legalization|legalisation|apostille|cong chung|chung thuc|hop phap hoa|tai su dung|dung lai|reuse|existing poa|poa cu|new poa|poa moi|han nop|deadline|grace period|who signs|ai ky|ban goc|original copy)\b/.test(text)) return null;
  if (/\b(design|kieu dang|utility model|giai phap huu ich|pct|national phase|tham dinh|opposition|assignment)\b/.test(text)) return null;
  if (vn && trademark && renewal && !patent && !annuity) return 'vn-renewal';
  if (th && patent && annuity && !trademark && !renewal) return 'th-annuity';
  return null;
}

export function answerAdvice(question, word, mail, scenario, demo = false) {
  const topic = topicOf(question);
  const simulation = demo || scenario !== 'word';
  if (!topic) {
    return {
      kind: 'missing', simulation, title: 'Cần làm rõ phạm vi câu hỏi',
      body: 'Hỏi về yêu cầu POA cho một quốc gia và một thủ tục mỗi lượt. Bản này hỗ trợ gia hạn nhãn hiệu Việt Nam và duy trì hiệu lực bằng sáng chế Thái Lan. Các câu hỏi về hình thức hoặc thời hạn cần nguồn riêng.',
      citations: [], email: '',
    };
  }
  const scope = topics[topic];
  const selected = [...word, ...(mail[scenario] || [])].filter(source => source.topic === topic);
  const replaced = new Set();
  for (const source of selected) {
    if (source.kind !== 'email' || !source.date || !source.position) continue;
    for (const id of source.supersedes || []) {
      const old = selected.find(candidate => candidate.id === id);
      if (old?.position && id !== source.id && (!old.date || old.date < source.date)) replaced.add(id);
    }
  }
  const citations = selected.map(source => ({
    ...source,
    state: !source.position ? 'context' : replaced.has(source.id) ? 'superseded' : 'active',
  })).sort((a, b) => Number(b.state === 'active') - Number(a.state === 'active'));
  const active = citations.filter(source => source.state === 'active');
  const prefix = simulation ? '[MÔ PHỎNG — CHỈ DÙNG DIỄN TẬP]\n\n' : '';
  const positions = new Set(active.map(source => source.position));
  if (positions.size !== 1) {
    const conflict = positions.size > 1;
    return {
      kind: conflict ? 'conflict' : 'missing', scope, simulation, citations,
      title: conflict ? 'Các nguồn đang mâu thuẫn' : 'Chưa đủ căn cứ để kết luận',
      body: conflict
        ? 'Các nguồn đưa ra hướng dẫn khác nhau cho cùng thủ tục. Cần đối tác xác nhận yêu cầu đang áp dụng trước khi tư vấn.'
        : 'Kho chưa có hướng dẫn về POA cho đúng thủ tục này. Các đoạn liên quan chỉ dùng để đối chiếu phạm vi.',
      emailKind: 'verification',
      email: prefix + 'Chào anh/chị,\n\nNhờ anh/chị xác nhận yêu cầu giấy ủy quyền (POA) đang áp dụng cho thủ tục ' + scope + '. ' +
        (conflict ? 'Các hướng dẫn hiện có khác nhau. Xin cho biết hướng dẫn nào đang áp dụng, từ ngày nào và có ngoại lệ nào. ' : '') +
        'Nếu nộp qua đại diện, xin cho biết POA đã lưu có dùng lại được không và cần ký hay công chứng theo hình thức nào.\n\nCảm ơn anh/chị.',
    };
  }
  const current = active[0];
  return {
    kind: 'supported', scope, simulation, citations,
    title: current.answerTitle, body: current.answerText, emailKind: 'reply',
    email: prefix + 'Chào anh/chị,\n\n' + (current.emailText ?? current.answerText) + '\n\nTrân trọng,',
  };
}

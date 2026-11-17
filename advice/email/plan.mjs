import { createHash } from 'node:crypto';
import { answerProcedure, procedureSources } from '../public/answer.mjs';
import { coversPoa, poaFields } from '../library/poa.mjs';

export const topics = {
  'vn-renewal': { label: 'Gia hạn nhãn hiệu Việt Nam', query: 'Gia hạn nhãn hiệu Việt Nam',
    fields: ['documents', 'poa', 'deadline', 'fee', 'late-fee', 'term'] },
  'th-annuity': { label: 'Niên phí sáng chế Thái Lan', query: 'Nộp niên phí sáng chế Thái Lan',
    fields: ['documents', 'poa', 'deadline', 'fee', 'late-fee', 'term', 'prepay'] },
};
const queries = {
  documents: 'cần biểu mẫu nào và hồ sơ gồm gì?',
  deadline: 'thời hạn nộp là bao lâu?',
  fee: 'phí cơ quan là bao nhiêu tiền?',
  'late-fee': 'nộp muộn có phụ thu thế nào?',
  term: { 'vn-renewal': 'hiệu lực bao lâu?', 'th-annuity': 'khi bị thu hồi thì sao?' },
  prepay: 'có thể trả trước một lần không?',
};
const poaQueries = {
  requirement: 'có cần POA không?', reuse: 'có dùng lại POA đã nộp bản gốc không?',
  signer: 'ai ký POA?', formality: 'hình thức POA, có nhận bản scan hoặc cần công chứng không?', direct: 'tự nộp có cần POA không?',
};
const poaKinds = Object.keys(poaQueries);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopeByTopic = { 'vn-renewal': 'vn/tm/renew', 'th-annuity': 'th/pt/annuity' };

export function planEmail(input, privateRows = [], asOf) {
  if (!input || Object.keys(input).some(key => !['topic', 'fields', 'year', 'poa', 'filingYear', 'poaAlso',
    'exactDeadline', 'unclearFilingDate', 'partnerIssuer'].includes(key))) return null;
  const { topic, fields, year = null, filingYear = null, poa = 'requirement', poaAlso = [],
    exactDeadline = false, unclearFilingDate = false, partnerIssuer = null } = input;
  if (typeof topic !== 'string' || !Object.hasOwn(topics, topic) ||
      !Array.isArray(fields) || !fields.length || new Set(fields).size !== fields.length ||
      fields.some(field => !topics[topic].fields.includes(field)) ||
      (year !== null && (topic !== 'th-annuity' || !fields.includes('fee') || !Number.isInteger(year) || year < 5 || year > 20)) ||
      (filingYear !== null && (topic !== 'vn-renewal' || !fields.some(field => ['fee','late-fee'].includes(field)) ||
        !Number.isInteger(filingYear) || filingYear < 2020 || filingYear > 2099)) ||
      !poaKinds.includes(poa) || !Array.isArray(poaAlso) || new Set(poaAlso).size !== poaAlso.length ||
      poaAlso.some(kind => !poaKinds.includes(kind) || kind === poa) || (poaAlso.length && !fields.includes('poa')) ||
      typeof exactDeadline !== 'boolean' || (exactDeadline && !fields.includes('deadline')) ||
      (partnerIssuer !== null && (!fields.includes('poa') || typeof partnerIssuer !== 'string' || !/^[a-z0-9-]{1,50}$/.test(partnerIssuer))) ||
      typeof unclearFilingDate !== 'boolean' || (unclearFilingDate && (topic !== 'vn-renewal' || filingYear !== null ||
        !fields.some(field => ['fee', 'late-fee'].includes(field))))) return null;
  const today = asOf ?? new Intl.DateTimeFormat('sv-SE', {
    timeZone: topic === 'vn-renewal' ? 'Asia/Ho_Chi_Minh' : 'Asia/Bangkok',
  }).format();
  const sourceRows = privateRows.filter(row => row.scope.slice(0, 3).join('/') === scopeByTopic[topic]);
  const replaced = new Set(sourceRows.flatMap(row => row.date && row.date <= today ? row.supersedes : []));
  const selected = topics[topic].fields.filter(field => fields.includes(field)).flatMap(field =>
    field === 'poa' ? [poa, ...poaAlso].map((intent, i) => ({ field, intent, id: i ? 'poa-' + intent : field })) : [{ field, id: field }]);
  const sections = selected.map(({ field, intent, id }) => {
    const query = intent ? poaQueries[intent] : field === 'deadline' && exactDeadline ? 'thời hạn nộp cụ thể đến ngày nào?' :
      field === 'term' ? queries.term[topic] : queries[field];
    const suffix = field === 'fee' && year ? ' năm thứ ' + year :
      ['fee','late-fee'].includes(field) && filingYear ? ' năm ' + filingYear : '';
    const answer = answerProcedure(topics[topic].query + suffix + ' ' + query, undefined, today);
    const section = answer.sections[0];
    let text = section.missing || section.text;
    let pending = Boolean(section.missing);
    let evidence = answer.citations;
    if (field === 'deadline' && exactDeadline && !pending) {
      text = topic === 'vn-renewal' ? 'Cần đối chiếu ngày hết hiệu lực trên văn bằng để xác nhận ngày đến hạn cụ thể.'
        : 'Cần ngày nộp đơn, ngày cấp, năm niên phí và tình trạng thanh toán để xác nhận ngày đến hạn cụ thể.';
      pending = true;
    }
    if (topic === 'th-annuity' && intent) {
      text = 'Nhờ DIP hoặc hãng đại diện xác nhận ' + poaFields[intent] + ' cho hồ sơ này.';
    }
    if (unclearFilingDate && ['fee', 'late-fee'].includes(field)) {
      text = 'Nhờ anh/chị xác nhận ngày dự kiến nộp để đối chiếu biểu phí đúng thời điểm.';
      pending = true;
    }
    if (unclearFilingDate && ['fee', 'late-fee'].includes(field)) evidence = [];
    const related = sourceRows.filter(row => row.scope[3] === field && (!intent || intent === 'requirement' ||
      ['expired', 'verify-office-record'].includes(row.value) ||
      coversPoa(row, intent, intent === 'formality' ? 'ban scan cong chung' : query)));
    const active = related.filter(row => !replaced.has(row.id) && (!row.date || row.date <= today));
    const contradictsOfficial = topic === 'vn-renewal' && intent === 'requirement' &&
      active.some(row => row.value === 'none') && evidence.some(row => row.id === 'vn-poa');
    const disagreement = contradictsOfficial || new Set(active.map(row => row.value + ':' + row.statement)).size > 1;
    if (disagreement || active.some(row => ['expired', 'verify-office-record'].includes(row.value))) {
      text = 'Các hướng dẫn trong kho khác nhau về ' + section.label.toLowerCase() +
        '. Nhờ anh/chị xác nhận hướng dẫn nào áp dụng cho hồ sơ này, từ ngày nào và thay thế đoạn nào.';
      if (!disagreement) text = 'Nhờ anh/chị xác nhận hướng dẫn còn áp dụng và điều kiện cho hồ sơ này.';
      pending = true;
    }
    const partner = pending && ['reuse', 'signer', 'requirement'].includes(intent) && active.length === 1 &&
      active.find(row => row.kind === 'email' && row.issuer === partnerIssuer && row.date && row.clientText &&
        !['expired', 'verify-office-record'].includes(row.value));
    if (partner && !disagreement) {
      text = 'Theo hướng dẫn của đối tác ngày ' + partner.date.split('-').reverse().join('/') +
        ', áp dụng trong phạm vi đối tác xử lý hồ sơ này.\n\n' + partner.clientText;
      pending = false;
    }
    const note = disagreement ? 'Hướng dẫn đang mâu thuẫn' : partner ? 'Hướng dẫn nghiệp vụ của đối tác' :
      active.length ? 'Có hướng dẫn trong kho để đối chiếu' : '';
    const localCitations = [...active, ...related.filter(row => replaced.has(row.id))].map(row => ({
      id: row.id, title: row.title, quote: row.quote, kind: row.kind, date: row.date,
      anchor: row.locator ?? row.title + ' · Đoạn ' + row.paragraph, locator: row.locator,
      origin: row.origin, download: '/api/advice/source/' + row.id,
      state: replaced.has(row.id) ? 'superseded' : row.id === partner?.id && !disagreement ? 'active' : 'context',
      note: 'Hướng dẫn đã duyệt trong kho nội bộ',
    }));
    const title = selected.filter(item => item.field === 'poa').length > 1 && intent
      ? section.label + ' · ' + { requirement: 'Yêu cầu', reuse: 'Dùng lại', signer: 'Người ký', formality: 'Hình thức', direct: 'Tự nộp' }[intent]
      : section.label;
    const claims = pending ? [] : partner && !disagreement
      ? [{ text, ids: [partner.id] }]
      : evidence.filter(row => row.state === 'active' && row.statement).map(row => ({ text: row.statement, ids: [row.id] }));
    const payload = { id, title, text, pending, sources: [...evidence, ...localCitations], ...(note ? { note } : {}) };
    return { ...payload, claims, fingerprint: digest({ ...payload, poa: intent ?? null, year: field === 'fee' ? year : null, filingYear: ['fee','late-fee'].includes(field) ? filingYear : null }) };
  });
  return { sections, sourceVersion: digest(sourceRows.length ? [procedureSources(topic), sourceRows] : procedureSources(topic)) };
}

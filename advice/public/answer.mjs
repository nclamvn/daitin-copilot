import { createHash } from 'node:crypto';
import bundle from './index.json' with { type: 'json' };
import { followUp, mentionsPoa, normalize, poaFields, poaIntents } from '../library/poa.mjs';

const procedures = {
  'vn-renewal': { scope: ['vn', 'tm', 'renew', 'poa'], name: 'gia hạn nhãn hiệu tại Việt Nam' },
  'th-annuity': { scope: ['th', 'pt', 'annuity', 'poa'], name: 'nộp niên phí sáng chế tại Thái Lan' },
};
const labels = { documents: 'Hồ sơ và biểu mẫu', poa: 'Giấy ủy quyền', deadline: 'Thời hạn', fee: 'Phí cơ quan',
  'late-fee': 'Nộp muộn và phụ thu', term: 'Hiệu lực', prepay: 'Trả trước một lần' };
const ids = new Set();
for (const row of bundle.records) {
  if (ids.has(row.id) || !Object.hasOwn(procedures, row.procedure) || !Object.hasOwn(labels, row.field) ||
      !row.statement || !row.locator || new URL(row.origin).protocol !== 'https:' ||
      createHash('sha256').update(row.quote).digest('hex') !== row.quoteSha256 ||
      !/^[a-f0-9]{64}$/.test(row.sourceSha256)) throw new Error('Đoạn nguồn thủ tục chưa được khóa.');
  ids.add(row.id);
}

export function procedureSources(id) {
  return bundle.records.filter(row => row.procedure === id);
}

const specificDeadline = /\b(ngay nao|ngay (?:den han |nop |het han )?cu the|ngay den han|ngay cuoi(?: cung)?|han chot|han nop (?:cu the|chinh xac)|chot han|den ngay|tinh han|which date|what date|exact date|specific date|calendar date|exact deadline|deadline date|due date)\b/;

function confirmedAnnuityYear(text) {
  const matches = [...text.matchAll(/\b(?:nam (?:thu )?|year )(\d{1,4})\b|\b(\d{1,4})(?:st|nd|rd|th) year\b/g)];
  const years = new Set(matches.map(match => Number(match[1] ?? match[2])));
  const alternate = matches.some(match => /^ (?:hay|hoac|va|den|toi|or|and|to|through) (?:nam (?:thu )?|thu |year )?\d{1,4}\b/
    .test(text.slice(match.index + match[0].length)));
  const unconfirmed = /\b(chua (?:chot|ro|xac nhan|xac dinh|biet)|phan van|khong chac|dang doi chieu giua|not (?:confirmed|sure)|unconfirmed|undecided|unsure|not yet (?:confirmed|decided))\b/.test(text) ||
    matches.some(match => /\b(?:co the la|tam tinh|du kien (?:la )?|possibly|maybe|estimated(?: to be)?) $/
      .test(text.slice(0, match.index)));
  return years.size === 1 && !alternate && !unconfirmed ? years.values().next().value : null;
}

function identify(text, previous) {
  const vn = /\b(viet nam|vietnam|vn)\b/.test(text);
  const th = /\b(thai lan|thailand|thai|th)\b/.test(text);
  const tm = /\b(nhan hieu|trade ?mark)\b/.test(text);
  const patent = /\b(sang che|patents?)\b/.test(text);
  const renew = /\b(gia han|renew\w*)\b/.test(text);
  const annuity = /\b(nien phi|duy tri|annuities|annuity|annual fees?|maintenance fees?)\b/.test(text);
  if ((vn && th) || (tm && patent) ||
    /\b(pct|national phase|giai doan quoc gia|petty|utility model|giai phap huu ich|kieu dang|design|singapore|malaysia|indonesia|japan|nhat ban|philippines|opposition|phan doi|madrid|assignment|chuyen nhuong|nop don moi)\b/.test(text)) return;
  if (/\b(hague|trung quoc|china|han quoc|korea|lao|cambodia|campuchia|bang sang che da het 20 nam)\b/.test(text)) return;
  if (vn && tm && renew && !annuity) return 'vn-renewal';
  if (th && patent && annuity) return 'th-annuity';
  if ((vn || th || tm || patent || renew || annuity) || !followUp(text) ||
      /\b(o|tai|in|at) [a-z]/.test(text.replace(/^in that case /, ''))) return;
  return Object.keys(procedures).find(id => JSON.stringify(previous?.slice(0, 3)) === JSON.stringify(procedures[id].scope.slice(0, 3)));
}

function requested(text) {
  const selected = [];
  const late = /\b(nop muon|nop tre|qua han|het han|grace|surcharge|late|phu thu|tre han|muon)\b/.test(text);
  if (/\b(checklist|ho so|tai lieu|giay to|to khai|bieu mau|mau nao|mau gi|mau so|forms?|documents?|can gui|chuan bi gi|ban goc giay chung nhan)\b/.test(text)) selected.push('documents');
  if (mentionsPoa(text) || (followUp(text) && poaIntents(text)[0] !== 'requirement')) selected.push('poa');
  if (specificDeadline.test(text) ||
      /\b(thoi han|han nop|khi nao|deadline|due|bao gio|bat dau|tu moc nao|cap bang sau|grant after|may ngay|bao nhieu ngay)\b/.test(text)) selected.push('deadline');
  if (late) selected.push('late-fee');
  const withoutProcedure = text.replace(/\b(annual|maintenance) fees?\b/g, '');
  if (/\b(bao gia|bieu phi|muc phi|bao nhieu tien|chi phi|le phi|fees?|cost|how much|phi co quan|tong phi|phi nam|thb)\b/.test(withoutProcedure) &&
      (!late || /\b(bao gia|bieu phi|phi co quan|tong phi|cost)\b/.test(text))) selected.push('fee');
  if (/\b(tra truoc|mot lan|tron goi|lump sum|one payment|prepay)\b/.test(text)) selected.push('prepay');
  if (/\b(hieu luc bao lau|may nam|bao nhieu nam|thu hoi|revocation|revoked|restore|khoi phuc|huy bang)\b/.test(text)) selected.push('term');
  return selected;
}

function section(id, field, text, today) {
  let rows = procedureSources(id).filter(row => row.field === field && (!row.until || today <= row.until));
  let missing = '';
  const intents = field === 'poa' ? poaIntents(text) : [];
  if (id === 'vn-renewal' && field === 'poa') {
    rows = rows.filter(row => row.id === 'vn-poa' || intents.includes('reuse'));
    const originalAlreadyFiled = /\b(da nop ban goc|ban goc da nop|original (was |has been )?filed)\b/.test(text);
    const uncovered = intents.filter(intent => !['requirement', 'reuse'].includes(intent) &&
      !(intent === 'formality' && intents.includes('reuse') && originalAlreadyFiled &&
        !/\b(cong chung|chung thuc|apostille|notari[sz]\w*|legali[sz]\w*|ban scan|scan|chu ky so)\b/.test(text)));
    if (uncovered.length) missing = 'Cần xác nhận ' + uncovered.map(intent => poaFields[intent]).join(' và ') + ' cho trường hợp cụ thể.';
  }
  if (id === 'th-annuity' && field === 'poa') {
    missing = 'Cần DIP hoặc hãng đại diện xác nhận ' + intents.map(intent => poaFields[intent]).join(' và ') +
      ' cho hồ sơ này. Mẫu 010-Kor chỉ cho biết chủ bằng hoặc đại diện có thể đứng tên người nộp.';
  }
  if (field === 'deadline' && specificDeadline.test(text)) {
    missing = id === 'vn-renewal'
      ? 'Cần đối chiếu ngày hết hiệu lực trên Giấy chứng nhận đăng ký nhãn hiệu để xác định ngày đến hạn cụ thể. Nhờ anh/chị cung cấp ngày này nếu chưa có.'
      : 'Để xác định ngày đến hạn cụ thể, cần đối chiếu ngày nộp đơn, ngày cấp bằng, năm niên phí cần nộp và tình trạng thanh toán.';
  }
  if (id === 'vn-renewal' && field === 'late-fee') {
    rows = [...procedureSources(id).filter(row => row.id === 'vn-late'), ...rows];
    const reductionApplies = rows.some(row => row.id === 'vn-reduction') &&
      !/\b(202[0-5]|202[7-9]|20[3-9][0-9]|nam sau|next year)\b/.test(text);
    if (!reductionApplies) {
      rows = rows.filter(row => row.id === 'vn-late');
      missing = 'Cần rà biểu phí có hiệu lực vào ngày nộp trước khi tính lệ phí nộp muộn.';
    }
  }
  if (id === 'vn-renewal' && /\b(202[0-5]|truoc (ngay )?1 7 2026|truoc thang 7 2026|truoc 01 07 2026|ho so da nop truoc|before july)\b/.test(text)) {
    rows = [];
    missing = 'Cần ngày cơ quan tiếp nhận và phiên bản quy định tại thời điểm đó để kiểm điều khoản chuyển tiếp.';
  }
  if (id === 'vn-renewal' && field === 'fee' && (!rows.some(row => row.id === 'vn-renew-fee-2026') ||
      /\b(202[0-5]|202[7-9]|20[3-9][0-9]|nam sau|next year)\b/.test(text))) {
    rows = [];
    missing = 'Cần rà biểu phí có hiệu lực vào ngày nộp trước khi báo mức thu.';
  }
  if (id === 'th-annuity' && field === 'fee') {
    const year = confirmedAnnuityYear(text);
    rows = rows.filter(row => row.year === year);
    if (!rows.length) missing = 'Anh cho biết một năm niên phí cần đối chiếu, từ năm thứ 5 đến năm thứ 20.';
  }
  if (!rows.length && !missing) missing = 'Kho chưa có đoạn đủ căn cứ cho nội dung này.';
  return { label: labels[field], rows, missing };
}

export function answerProcedure(question, previous, today = new Date().toISOString().slice(0, 10)) {
  const text = normalize(question);
  const id = identify(text, previous);
  if (!id) return null;
  const fields = requested(text);
  if (!fields.length) {
    const { scope, name } = procedures[id];
    return { kind: 'missing', scope: name, scopeKey: scope, simulation: false, citations: [], email: '',
      title: 'Anh muốn kiểm phần nào?', body: 'Anh có thể hỏi về hồ sơ, giấy ủy quyền, thời hạn hoặc phí cơ quan.',
      suggestions: ['Vậy dùng biểu mẫu nào?', 'Vậy hạn nộp tính từ mốc nào?'] };
  }
  const { scope, name } = procedures[id];
  const groups = fields.map(field => section(id, field, text, today));
  const needsReview = groups.some(group => group.missing);
  const kind = !needsReview ? 'supported' : groups.some(group => group.rows.length && !group.missing) ? 'partial' : 'missing';
  const citations = groups.flatMap(group => group.rows.map(row => ({
    ...row, checkedOn: bundle.reviewedOn, anchor: row.locator, state: group.missing ? 'context' : 'active', kind: 'word', simulated: false,
  }))).filter((row, i, all) => all.findIndex(item => item.id === row.id) === i);
  const sections = groups.map(({ label, rows, missing }) => ({
    label, text: rows.map(row => row.statement).join('\n\n'), missing, ids: rows.map(row => row.id),
  }));
  const body = sections.map(group => [group.label, group.text, group.missing].filter(Boolean).join('\n')).join('\n\n');
  const confirmed = sections.filter(group => group.text && (!group.missing || group.label === labels.deadline || group.label === labels['late-fee']));
  const pending = sections.filter(group => group.missing);
  const email = 'Chào anh/chị,\n\nVề việc ' + name + ':\n\n' +
    [...confirmed.map(group => group.label + '\n' + group.text),
      ...pending.map(group => group.label + '\n' + group.missing.replace(/^Anh cho biết/, 'Nhờ anh/chị cho biết'))].join('\n\n') +
    '\n\nTrân trọng,';
  return { kind, scope: name, scopeKey: scope, simulation: false, sections, body, citations, email,
    emailKind: kind === 'missing' ? 'verification' : 'reply',
    title: kind === 'supported' ? 'Có căn cứ cho nội dung hỏi' : kind === 'partial' ? 'Đã đối chiếu, còn mục cần xác nhận' : 'Cần thêm căn cứ hoặc dữ kiện',
    suggestions: kind === 'supported' && fields.includes('poa') ? ['Vậy ai ký giấy ủy quyền?', 'Vậy có dùng lại bản cũ được không?'] : [] };
}

import { normalize, poaIntents, followUp } from '../library/poa.mjs';

export const vn = 'vn-renewal';
export const th = 'th-annuity';
const hasVN = /\b(viet nam|vietnam|vn)\b/;
const hasTH = /\b(thai lan|thailand|thai)\b/;
const trademark = /\b(nhan hieu|trade ?marks?)\b/;
const patent = /\b(sang che|patents?)\b/;
const renew = /\b(gia han|renew\w*|keo dai hieu luc)\b/;
const annuity = /\b(nien phi|duy tri|annuit\w*|annual fees?|maintenance fees?|keep .* in force)\b/;
const outside = /\b(pct|national phase|giai doan quoc gia|madrid|petty patent|utility model|giai phap huu ich|kieu dang|design|singapore|malaysia|indonesia|(?<!cap )nhat ban|japan|han quoc|korea|trung quoc|china|philippines|cambodia|campuchia|opposition|phan doi|assignment|chuyen nhuong|nop don moi|new application|(?<!phi )tham dinh|hague)\b/;
const newMatter = /\b(ho so (?:khac|moi)|khach (?:khac|moi)|van bang khac|another (?:case|client|patent|trade ?mark)|different (?:case|client|patent|trade ?mark))\b/;
const correction = /\b(dinh chinh|cap nhat|bo sung|thay cho|chot lai|correct(?:ion|ed)?|update|instead|actually|y toi la|sua lai|xac nhan)\b/;
const asksForWork = /\b(cho (?:biet|xin|toi|anh|em)|xin|nho|hoi|can (?:biet|xem|kiem tra)|tinh lai|xem them|please|could you|can you|how|which|what)\b/;
export const exact = /\b(ngay (?:den han|het han|nop cu the|nao|cuoi cung|cu the)|han chot|tinh han|due date|deadline date|exact (?:date|deadline)|specific date|which date|what date|calendar date)\b/;
const historical = /\b(truoc (?:ngay )?(?:1 |01 )?7 2026|truoc thang 7(?: 2026)?|before july|da nop truoc)\b/;
const unknown = /\b(chua (?:chot|ro|biet|xac nhan|xac dinh)|khong chac|phan van|co the la|tam tinh|du kien la|not sure|not confirmed|unsure|maybe|tentative|possibly)\b/;
const joinYears = /\b(?:hay|hoac|den|toi|or|and|through|to) (?:nam (?:thu )?|thu |year )?\d{1,4}\b/;
const yearPattern = /\b(?:nam (?:thu )?|year )([1-9]\d?)(?!\d)\b|\b([1-9]\d?)(?:st|nd|rd|th)(?: year| annuity)\b|\bthu ([1-9]\d?)\b/g;
const modelFeeCue = /\b(phi|tien|muc thu|ton kem|quote|quotation|fee|fees|pay|cost|price|amount|how much|tariff)\b/;
const feeFields = ['fee', 'late-fee'];
const poaModes = ['requirement', 'reuse', 'signer', 'formality', 'direct'];

const rules = {
  documents: /\b(giay to|tai lieu|bieu mau|to khai|mau nao|mau gi|mau nop|xin mau|va mau|checklist|forms?|documents?|chuan bi gi|ho so gom|giay gi|nop gi|van bang giay)\b/,
  poa: /\b(poa|giay uy quyen|van ban uy quyen|power of attorney|authority letter|authorization letter)\b/,
  deadline: /\b(thoi han|han nop|khi nao|bao gio|moc nao|deadline|due|cap bang muon|late grant)\b/,
  fee: /\b(chi phi|le phi|muc phi|bieu phi|phi co quan|bao nhieu tien|phi nam|bao gia|official fees?|how much|cost|tien phi|muc thu|tong phi|thb|muc tien)\b/,
  'late-fee': /\b(nop muon|nop tre|qua han|phu thu|surcharge|late payment|grace|dong muon|tra muon)\b/,
  term: /\b(hieu luc bao lau|may nam|bao nhieu nam|thu hoi|revok\w*|restore|khoi phuc|huy bang)\b/,
  prepay: /\b(tra truoc|mot lan|prepay|lump sum|one payment|dong gop)\b/,
};

export const fieldNames = Object.keys(rules);

export function currentText(text) {
  return text.replace(/\r\n/g, '\n').split(/^\s*(?:[-_ ]{2,}\s*(?:Original Message|Forwarded message|Thư gốc)|On .+ wrote:|Vào .+ đã viết:)\s*$/imu, 1)[0]
    .split('\n').filter(line => !/^\s*>/.test(line)).join('\n').trim();
}

function clauses(text) {
  return text.split(/\n+|[;!?]+|\.\s+|(?:,\s*|\s+(?:và|and|còn|riêng|also)\s+)(?=(?:việc |về |hồ sơ )?(?:niên phí|nộp niên phí|gia hạn nhãn hiệu|trademark renewal|patent annuit))/iu)
    .map(value => value.trim()).filter(Boolean).slice(0, 40);
}

function explicitScope(text) {
  const v = hasVN.test(text), t = hasTH.test(text);
  const mark = trademark.test(text), p = patent.test(text);
  if (outside.test(text) || (v && t) || (mark && p) || (v && (p || annuity.test(text))) ||
      (t && mark)) return { blocked: true };
  if (v && mark && renew.test(text)) return { topic: vn };
  if (t && annuity.test(text) && (p || /\b(nien phi|annuit\w*|annual fees?|maintenance fees?)\b/.test(text))) return { topic: th };
  return { hint: v || mark ? vn : t || p || annuity.test(text) ? th : null };
}

export function validateInputs(value) {
  return Array.isArray(value) && value.length <= 2 && new Set(value.map(item => item?.topic)).size === value.length &&
    value.every(input => input && [vn, th].includes(input.topic) && Array.isArray(input.fields) && input.fields.length &&
      input.fields.length <= fieldNames.length && new Set(input.fields).size === input.fields.length &&
      input.fields.every(field => fieldNames.includes(field) && (input.topic === th || field !== 'prepay')) &&
      (input.year === null || (input.topic === th && Number.isInteger(input.year) && input.year >= 5 && input.year <= 20)) &&
      (input.filingYear === null || (input.topic === vn && Number.isInteger(input.filingYear) && input.filingYear >= 2020 && input.filingYear <= 2099)) &&
      typeof input.exactDeadline === 'boolean' && typeof input.unclearFilingDate === 'boolean' && typeof input.historical === 'boolean' &&
      poaModes.includes(input.poa) && Array.isArray(input.poaAlso) && input.poaAlso.length <= 4 &&
      new Set(input.poaAlso).size === input.poaAlso.length && input.poaAlso.every(mode => poaModes.includes(mode) && mode !== input.poa) &&
      (!input.year || input.fields.includes('fee')) && (!input.exactDeadline || input.fields.includes('deadline')) &&
      (!input.poaAlso.length || input.fields.includes('poa')) &&
      ((!input.filingYear && !input.unclearFilingDate) || input.fields.some(field => feeFields.includes(field))) &&
      (!input.unclearFilingDate || (input.filingYear === null && input.topic === vn)) &&
      Object.keys(input).every(key => ['topic', 'fields', 'year', 'filingYear', 'poa', 'poaAlso', 'exactDeadline', 'unclearFilingDate', 'historical'].includes(key)));
}

export function inspectQuestion(question, previous) {
  let parts = clauses(currentText(question));
  if (!parts.length) parts = [''];
  const entries = parts.map(raw => ({ raw, text: normalize(raw) })).map(entry => ({ ...entry, ...explicitScope(entry.text) }));
  const topics = [...new Set(entries.map(entry => entry.topic).filter(Boolean))];
  const fullText = normalize(currentText(question));
  const reset = newMatter.test(fullText);
  const correcting = correction.test(fullText);
  const follow = !reset && previous.length > 0 && (correcting || followUp(fullText) ||
    (!topics.length && entries.every(entry => !entry.blocked) && previous.length === 1));
  const sharedDocuments = topics.length === 2 && /\b(tuong ung|respectively|cho ca hai|for both)\b/.test(fullText) && rules.documents.test(fullText);
  const reportOutside = entries.some(entry => entry.blocked);
  for (const [i, entry] of entries.entries()) {
    if (entry.topic || entry.blocked) continue;
    const prior = entries.slice(0, i).reverse().find(candidate => candidate.topic || candidate.blocked);
    const next = entries.slice(i + 1).find(candidate => candidate.topic || candidate.blocked);
    const current = prior?.topic ?? (!prior && !next?.blocked ? next?.topic : null);
    if (current && (!entry.hint || current === entry.hint)) entry.topic = current;
    else if (follow && !prior?.blocked && !next?.blocked) {
      entry.topic = previous.find(item => item.topic === entry.hint)?.topic ?? (previous.length === 1 && !entry.hint ? previous[0].topic : null);
    }
  }
  const ambiguousCorrection = (follow && correcting || reset) && previous.length > 0 && !entries.some(entry => entry.topic && entry.text);
  const planningEntries = entries.map(entry =>
    entry.topic && (!follow || !correcting || asksForWork.test(entry.text)) ? entry : null);
  return { entries, planningEntries, follow, reset, reportOutside, ambiguousCorrection, sharedDocuments };
}

function safeAnnuityYear(text) {
  const matches = [...text.matchAll(yearPattern)];
  const years = [...new Set(matches.map(match => Number(match[1] ?? match[2] ?? match[3])))];
  const unconfirmed = years.length !== 1 || matches.some(match => joinYears.test(text.slice(match.index + match[0].length).trimStart().split(' ').slice(0, 5).join(' '))) || unknown.test(text);
  return { mentioned: matches.length > 0 || /\b(nam|year)\b/.test(text) && unknown.test(text),
    value: !unconfirmed && years[0] >= 5 && years[0] <= 20 ? years[0] : null };
}

function filingYear(text) {
  const years = [...new Set([...text.matchAll(/\b20[2-9]\d\b/g)].map(match => Number(match[0])))];
  const beforeJuly = /\b(?:nop|tiep nhan|fil(?:e|ed|ing)) (?:vao |ngay |on )?(?:\d{1,2} 0?[1-6] 2026|2026 0?[1-6] \d{1,2})\b/.test(text);
  const confirmed = years.length === 1 && !unknown.test(text) && !/\b(het hieu luc|het han|expir\w*)\b/.test(text);
  return { mentioned: years.length > 0 || /\b(nam sau|next year|truoc thang 7|before july)\b/.test(text), value: confirmed ? years[0] : null, beforeJuly };
}

export function resolveInputs(inspection, previous, proposals = []) {
  const { entries, follow, reportOutside, ambiguousCorrection } = inspection;
  if (ambiguousCorrection) return { inputs: [], unmatched: true };
  const mentioned = [...new Set(entries.map(entry => entry.topic).filter(Boolean))];
  const names = follow && !reportOutside ? [...new Set([...previous.map(item => item.topic), ...mentioned])] : mentioned;
  let unmatched = reportOutside;
  const active = [];
  for (const topic of names) {
    const local = entries.map((entry, index) => ({ ...entry, index })).filter(entry => entry.topic === topic);
    const text = local.map(entry => entry.text).join(' ');
    const prior = follow && !reportOutside ? previous.find(item => item.topic === topic) : null;
    const explicitPoa = local.some(entry => rules.poa.test(entry.text));
    const intents = /\b(chu ky cua ai|whose signature)\b/.test(text) ? ['signer'] : poaIntents(text);
    const year = topic === th ? safeAnnuityYear(text) : { value: null };
    const filing = topic === vn ? filingYear(text) : { value: null };
    const explicitExact = exact.test(text);
    const fields = fieldNames.filter(field =>
      (field !== 'prepay' || topic === th) && (prior?.fields.includes(field) ||
      (field === 'deadline' && explicitExact) || (field === 'documents' && inspection.sharedDocuments) || rules[field].test(text) ||
      (field === 'poa' && prior?.fields.includes('poa') && intents[0] !== 'requirement') ||
      local.some(({ index }) => proposals.some(item => item.clause === index + 1 && item.fields.includes(field) &&
        (field !== 'fee' || modelFeeCue.test(entries[index].text.replace(/\b(nien phi|annual fees?|maintenance fees?)\b/g, '')))))));
    if (!fields.length) {
      unmatched = true;
      continue;
    }
    if (topic === th && fields.includes('prepay') && fields.includes('fee') && !year.mentioned && !prior?.fields.includes('fee') &&
        !local.some(entry => !rules.prepay.test(entry.text) && rules.fee.test(entry.text))) fields.splice(fields.indexOf('fee'), 1);
    const focusedPoa = explicitPoa || intents.some(intent => !['requirement', 'formality'].includes(intent)) ||
      /\b(cong chung|ban scan|notari[zs]\w*|apostille)\b/.test(text);
    const previousPoa = prior ? [prior.poa, ...prior.poaAlso] : [];
    const withoutPaper = intents.filter(intent => intent !== 'formality' ||
      (!/\b(van bang giay|giay chung nhan|certificate)\b/.test(text) &&
        !(intents.includes('reuse') && /\b(da nop ban goc|ban goc da nop|original (?:was |has been )?filed)\b/.test(text))) ||
      /\b(cong chung|ban scan|notari[zs]\w*|apostille)\b/.test(text));
    const modelPoa = local.flatMap(({ index }) => proposals.filter(item => item.clause === index + 1 && item.fields.includes('poa')).map(item => item.poa));
    const requirement = /\b(co can (?:giay uy quyen|poa)|is (?:a )?(?:power of attorney|poa) required|poa qua dai dien)\b/.test(text);
    const selectedPoa = focusedPoa ? [...(requirement && !intents.includes('direct') ? ['requirement'] : []),
      ...(withoutPaper.length ? withoutPaper : ['requirement'])] : modelPoa;
    const poa = fields.includes('poa') ? [...new Set([...selectedPoa, ...previousPoa])] : [];
    const appliesToFees = fields.some(field => feeFields.includes(field));
    active.push({ topic, fields, year: topic === th && fields.includes('fee') ? (year.mentioned ? year.value : prior?.year ?? null) : null,
      filingYear: appliesToFees ? (filing.mentioned ? filing.value : prior?.filingYear ?? null) : null,
      unclearFilingDate: Boolean(appliesToFees && (filing.mentioned ? !filing.value : prior?.unclearFilingDate)),
      exactDeadline: fields.includes('deadline') && (explicitExact || Boolean(prior?.exactDeadline)),
      historical: topic === vn && (historical.test(text) || filing.beforeJuly || (filing.mentioned ? filing.value && filing.value < 2026 : prior?.historical)) ? true : false,
      poa: poa[0] ?? 'requirement', poaAlso: poa.slice(1) });
  }
  if (entries.some(entry => !entry.topic && fieldNames.some(field => rules[field].test(entry.text) || (field === 'deadline' && exact.test(entry.text))))) unmatched = true;
  return { inputs: active, unmatched };
}

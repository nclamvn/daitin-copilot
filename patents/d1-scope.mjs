import { CaseError } from '../copilot/m3/workflow.mjs';

const rule = 'selected_d1_excerpts_v1';
const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const assessment = /\b(?:khong|chua|thieu|vang|co|mo ta|de cap|cho thay|tiet lo|the hien|bao gom|xuat hien|has|contains?|describes?|discloses?|disclosure|mentions?|shows?|includes?|provides?|teaches|omits?|lacks?|absen(?:t|ce)|silent|insufficient|not|cannot find|fails? to|supports?)\b/;
const whole = /\b(?:toan bo|toan van|ca tai lieu|ca ban mo ta|entire|whole|full (?:text|document|reference|disclosure)|all pages|throughout)\b/;
const absolute = /\b(?:hoan toan khong|khong he|tuyet doi khong|khong co (?:o |trong )?bat ky|bat ky (?:trang|phan|vi tri) nao|nowhere|anywhere in|never (?:mentions?|discloses?|contains?|shows?))\b/;
const legalFinding = /\b(?:chung minh|ket luan|khang dinh|proves?|establish(?:es|ed)?|demonstrates?).{0,90}\b(?:mat tinh moi|khong co tinh moi|khong moi|khong co trinh do sang tao|lack of novelty|not novel|invalid(?:ity)?|no inventive step)\b/;
const reviewAction = /\b(?:(?:can|phai|de nghi|nen|hay|se|chua)\s+(?:mo|doc|kiem|ra soat|doi chieu|xac minh|chon|gan|bo sung)|(?:need to|should|must|please|still need to)\s+(?:read|inspect|review|verify|open|compare|check|select|obtain|add)|not yet (?:reviewed|verified|selected)|(?:chua du (?:co so|chung cu)|khong the|cannot|not enough evidence)\s+(?:de |to )?(?:ket luan|suy ra|xac nhan|conclude|infer|establish|confirm)|(?:full|entire) (?:text|reference|document).{0,40}\b(?:needs?|requires?) (?:review|verification))\b/;
const scopedBefore = /\b(?:(?:doan|phan|trich doan)(?:\s+(?:trich|van ban|mo ta|duoc chon|da chon|trong|tu|cua)){0,5}|(?:excerpts?|passages?|sections?)(?:\s+(?:selected|from|in|of|the)){0,4})\s*$/;
const scopedAfter = /^\s+(?:excerpts?|passages?|sections?)\b/;
const scopedText = /\b(?:doan(?: trich)? (?:d\s*-?\s*1 )?(?:da|duoc) chon|(?:selected|pinned|cited) (?:d\s*-?\s*1 )?(?:excerpts?|passages?)|(?:doan|trich doan) d\s*-?\s*1|d\s*-?\s*1 (?:excerpts?|passages?))\b/;
const absentSelection = /\b(?:chua (?:co|chon|gan)|khong co|no|without)\s+(?:(?:tai lieu|doan|excerpt|reference)\s+)?d\s*-?\s*1(?:\s+(?:duoc chon|selected|pinned|was selected|available))?(?:[.!?]|$)/;
const indirectReference = /\b(?:the reference|the document|this reference|this document|tai lieu doi chung|ban mo ta doi chung|tai lieu nay|ban mo ta nay)\b/;
const continuation = /^(?:\s*|\s*(?:however|tuy nhien|ngoai ra)[,:]?\s*)(?:it|tai lieu nay|ban mo ta nay|khong|chua|not found|not shown)\b/;
const unqualifiedAbsence = /^\s*(?:(?:tuy nhien|ngoai ra|however)[,:]?\s*)?(?:khong tim thay|chua tim thay|khong thay|chua thay|not found|not shown|no evidence of)\b/;
const explicitOtherSource = /\b(?:trong yeu cau bao ho|trong thong bao|in the (?:target claim|office action|notice))\b/;
const english = text => /\b(?:the|of|in|is|has|does|doesn't|not|no|describes?|discloses?|contains?|lacks?|mentions?|provides?|shows?|excerpt|passage|fails|without|cannot|need|should)\b/i.test(text) && !/[\p{M}đĐ]/u.test(text.normalize('NFD'));

function aliasesFor(pinned) {
  const publications = pinned.flatMap(({ record, source }) => [record.publicationIdentifier, source.publicationIdentifier]);
  const tokens = publications.filter(value => typeof value === 'string').map(value => value.replace(/[^A-Z0-9]/gi, ''))
    .filter(value => /^[a-z]{2}\d{5,}(?:[a-z]\d*)?$/i.test(value));
  // Publication numbers are often rendered with spaces, commas or a kind-code suffix.
  const variants = [...new Set(tokens)].flatMap(value => [value, value.replace(/([A-Z])[0-9]*$/i, '')]);
  const ids = [...new Set(variants)].sort((a, b) => b.length - a.length)
    .map(value => [...value].map(escape).join('[ ,./-]*'));
  const label = `(?:D[ \\u00a0-]*1${ids.length ? '|' + ids.join('|') : ''})`;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:tài liệu(?: đối chứng)? |đối chứng |the )?(${label})(?: (?:reference|document|publication))?(?![\\p{L}\\p{N}]|-[\\p{L}\\p{N}]|\\.pdf\\b)`, 'giu');
}

function unsupported(receipt) {
  receipt.rejected = true;
  throw new CaseError('AI đã nhận định vượt phạm vi đoạn D1 đã chọn. Giữ bản đang lưu. Hãy yêu cầu đối chiếu trong các đoạn đã gắn hoặc bổ sung chứng cứ.', 422);
}

function scopeProse(text, aliases, pinned, receipt, { matrixNote = false, feature = false } = {}) {
  if (typeof text !== 'string' || !text.trim()) return text;
  // Preserve paragraph and sentence separators, and restrict edits to generated
  // prose. Structured quotations and span hashes never enter this function.
  const parts = text.split(/((?<=[.!?;])\s+|\n+)/);
  let previousD1 = false;
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i];
    const plain = fold(sentence);
    const mentionsD1 = [...sentence.matchAll(aliases)].length > 0;
    const claims = assessment.test(plain);
    const action = reviewAction.test(plain);
    if (mentionsD1 && !pinned.length) {
      // An instruction to select/review missing D1 is valid. An assertion about
      // a supposedly selected excerpt is not.
      if (scopedText.test(plain) || (claims && !action && !absentSelection.test(plain)) || legalFinding.test(plain)) unsupported(receipt);
      continue;
    }
    if (!pinned.length) continue;
    const implicitD1 = indirectReference.test(plain) || (!explicitOtherSource.test(plain) &&
      (unqualifiedAbsence.test(plain) || ((previousD1 || matrixNote) && continuation.test(plain))));
    const aboutD1 = mentionsD1 || matrixNote || (implicitD1 && claims);
    previousD1 = mentionsD1 || implicitD1;
    if (!aboutD1) continue;
    const wholeAt = plain.search(whole), reviewAt = plain.search(reviewAction);
    const explicitWholeFinding = wholeAt >= 0 && claims && (reviewAt < 0 || wholeAt < reviewAt);
    const legalAt = plain.search(legalFinding);
    if (absolute.test(plain) || explicitWholeFinding || (legalAt >= 0 && (reviewAt < 0 || legalAt < reviewAt))) unsupported(receipt);
    if (feature && mentionsD1 && claims) unsupported(receipt);
    if (feature || !claims) continue;

    const sourceQuotes = [...sentence.matchAll(/[“"«]([^”"»]+)[”"»]/g)]
      .filter(match => pinned.some(({ record }) => record.text.includes(match[1])));
    const isEnglish = english(sentence);
    let scoped = sentence.replace(aliases, (name, label, start) => {
      const before = fold(sentence.slice(0, start));
      const after = fold(sentence.slice(start + name.length));
      if (scopedBefore.test(before) || scopedAfter.test(after) ||
          sourceQuotes.some(match => start >= match.index && start < match.index + match[0].length)) return name;
      // Preserve explicit prospective review of the original/full text.
      if (action && /\b(?:toan bo|toan van|ban goc|ca tai lieu|entire|whole|original|full text)(?: cua| of| of the)?\s*$/.test(before)) return name;
      if (action && !assessment.test(after) && reviewAction.test(before)) return name;
      const initial = !before.trim();
      if (isEnglish) return `${initial ? 'The' : 'the'} selected ${label} excerpt`;
      return `${initial ? 'Đoạn' : 'đoạn'} ${label} đã chọn`;
    });
    if (scoped === sentence && implicitD1 && !action && !scopedText.test(plain) && !mentionsD1) {
      scoped = isEnglish ? 'Within the selected D1 excerpts: ' + sentence : 'Trong các đoạn D1 đã chọn: ' + sentence;
    }
    if (scoped !== sentence) receipt.rewrittenSentences++;
    parts[i] = scoped;
  }
  return parts.join('');
}

export function guardModelD1Scope(matter, patch, targets, receipt = { rule, rewrittenSentences: 0 }) {
  const pinned = matter.pinnedEvidence.filter(item => matter.d1RecordIds.includes(item.record.id));
  const aliases = aliasesFor(pinned);
  const result = { ...patch };
  if (targets.includes('matrix') && Array.isArray(patch?.matrix?.rows)) {
    result.matrix = { ...patch.matrix, rows: patch.matrix.rows.map(row => row && ({ ...row,
      feature: scopeProse(row.feature, aliases, pinned, receipt, { feature: true }),
      analysis: scopeProse(row.analysis, aliases, pinned, receipt, { matrixNote: true }),
      missing: scopeProse(row.missing, aliases, pinned, receipt, { matrixNote: true })
    })) };
  }
  if (targets.includes('response') && patch?.response) {
    result.response = { ...patch.response, text: scopeProse(patch.response.text, aliases, pinned, receipt) };
  }
  return result;
}

export const newD1ScopeReceipt = () => ({ rule, rewrittenSentences: 0 });

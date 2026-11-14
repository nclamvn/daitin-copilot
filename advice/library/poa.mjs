export const normalize = text => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd')
  .replace(/[^a-z0-9]+/g, ' ').trim();

export const mentionsPoa = text => /\b(poa|power of attorney|uy quyen)\b/.test(text);
export const followUp = text => /^(vay|the thi|the con|con viec|con|neu vay|and|then|what about|in that case)\b/.test(text);

export const poaFields = {
  requirement: 'yêu cầu về giấy ủy quyền (POA)',
  signer: 'người có thẩm quyền ký POA',
  reuse: 'việc có cần POA mới hay có thể dùng lại bản đã lưu',
  formality: 'yêu cầu về công chứng hoặc hình thức của POA',
  direct: 'yêu cầu POA khi chủ thể tự nộp',
};

export function poaIntents(text) {
  const intents = [];
  if (/\b(ai ky|ai phai ky|ai can ky|ai duoc ky|ai co the ky|ai co quyen ky|ai co tham quyen ky|do ai ky|nguoi ky|who (must |should |can )?sign\w*|whose signature)\b/.test(text)) intents.push('signer');
  if (/\b(dung lai|su dung lai|reuse\w*|tai su dung|poa cu|poa moi|existing (poa|power of attorney|authori[sz]ation)|new (poa|power of attorney)|fresh (poa|power of attorney)|uy quyen (moi|cu|da luu|da co|truoc do)|ky lai|ban (moi|cu|da luu)|giay (moi|cu|da luu))\b/.test(text)) intents.push('reuse');
  if (/\b(cong chung|chung thuc|apostille|notari[sz]\w*|legali[sz]\w*|hop phap hoa|ban goc|ban scan|ban sao|original|scan|copy|digital signature|chu ky so)\b/.test(text)) intents.push('formality');
  if (/\b(tu nop|nop truc tiep|khong qua dai dien|without (an? )?(agent|representative)|directly)\b/.test(text)) intents.push('direct');
  return intents.length ? intents : ['requirement'];
}

export function coversPoa(row, intent, text) {
  const evidence = normalize(row.statement ?? row.answerText ?? row.quote);
  if (intent === 'signer') {
    return ['signed-owner', 'signed'].includes(row.value) &&
      /\b(chu ky cua|do chu so huu ky|signed by|chu kieu dang ky)\b/.test(evidence);
  }
  if (intent === 'reuse') return ['reuse-valid', 'reuse', 'new', 'always-new'].includes(row.value);
  if (intent === 'formality') {
    const notary = /\b(cong chung|notari[sz]\w*)\b/.test(text);
    const other = /\b(chung thuc|apostille|legali[sz]\w*|hop phap hoa|ban goc|ban scan|ban sao|original|scan|copy|digital signature|chu ky so)\b/.test(text);
    return notary && !other && row.value === 'notary';
  }
  if (intent === 'direct') return !['agent-required', 'agent-signed', 'reuse-valid', 'reuse', 'new', 'always-new'].includes(row.value)
    && !/\b(qua (hang )?dai dien|khi hang|do hang nop|cung hang dai dien|through (our firm|an agent)|via (an |the |appointed )?agent)\b/.test(evidence);
  return true;
}

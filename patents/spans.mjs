import { CaseError, hash } from '../copilot/m3/workflow.mjs';

const spanId = (role, recordId, recordSHA256, start, end) =>
  role + '-' + hash(recordId + '\0' + recordSHA256).slice(0, 12) + '-' + start + '-' + end;
export const spanMetadata = ({ text, ...metadata }) => metadata;

export function prefixPatentSpan(span, text, role) {
  if (!span.text.startsWith(text)) throw new CaseError('Phạm vi đối chiếu không khớp đoạn nguồn đã ghim.', 422);
  const end = span.start + text.length;
  return { ...span, text, end, id: spanId(role, span.recordId, span.recordSHA256, span.start, end) };
}

// Offsets index the original JS UTF-16 record text. No OCR cleanup, translation,
// fuzzy matching or whitespace normalization is used to create a quotation.
function spans(recordId, text, role, sourceSHA256 = null, selectedText) {
  const allowedStart = selectedText === undefined ? 0 : text.indexOf(selectedText);
  if (allowedStart < 0) throw new CaseError('Phạm vi yêu cầu không khớp bản nguồn đã ghim.', 422);
  const allowedEnd = selectedText === undefined ? text.length : allowedStart + selectedText.length;
  const recordSHA256 = hash(text), output = [];
  const push = (start, end) => {
    start = Math.max(start, allowedStart); end = Math.min(end, allowedEnd);
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end - start < 20) return;
    output.push({ id: spanId(role, recordId, recordSHA256, start, end),
      recordId, sourceSHA256, recordSHA256, start, end, offsetBasis: 'record_text_utf16', text: text.slice(start, end) });
  };
  let start = 0;
  for (const match of text.matchAll(/\n[ \t]*\n+/g)) {
    segment(start, match.index); start = match.index + match[0].length;
  }
  segment(start, text.length);
  function segment(start, end) {
    while (end - start > 1000) {
      const limit = start + 1000;
      let cut = -1;
      for (const boundary of ['. ', '; ', '\n', ' ']) {
        const found = text.lastIndexOf(boundary, limit);
        if (found >= start + 200) { cut = found + (boundary === '\n' ? 0 : 1); break; }
      }
      if (cut <= start) cut = limit;
      push(start, cut); start = cut;
    }
    push(start, end);
  }
  if (!output.length && text.slice(allowedStart, allowedEnd).trim()) {
    const trimmed = text.slice(allowedStart, allowedEnd).trim();
    const start = text.indexOf(trimmed, allowedStart), end = start + trimmed.length;
    output.push({ id: spanId(role, recordId, recordSHA256, start, end),
      recordId, sourceSHA256, recordSHA256, start, end, offsetBasis: 'record_text_utf16', text: text.slice(start, end) });
  }
  return { options: output.slice(0, 16), total: output.length };
}

export function buildPatentSpanOptions(matter, claimContext) {
  const target = matter.pinnedEvidence.find(item => item.record.id === matter.claimRecordId);
  const claimSources = target ? [target] : [{ record: { id: 'case:claim', text: matter.claimText }, source: {} }];
  claimSources.push(...matter.pinnedEvidence.filter(item => claimContext.inheritedRecordIds?.includes(item.record.id)));
  const collect = (items, role) => {
    const groups = items.map(item => spans(item.record.id, item.record.text, role, item.source.sha256 ?? null,
      role === 'claim' && item.record.id === matter.claimRecordId ? matter.claimText : undefined));
    const options = groups.flatMap(group => group.options).slice(0, 64);
    return { options, available: groups.reduce((sum, group) => sum + group.total, 0), offered: options.length };
  };
  const claim = collect(claimSources, 'claim');
  const d1 = collect(matter.pinnedEvidence.filter(item => matter.d1RecordIds.includes(item.record.id)), 'd1');
  return { claim: claim.options, d1: d1.options,
    coverage: { claim: { available: claim.available, offered: claim.offered }, d1: { available: d1.available, offered: d1.offered },
      method: 'source_paragraphs_split_at_native_boundaries_max1000chars_first16_per_record_first64_per_role' } };
}

export function composePatentResponse(response) {
  if (!response || typeof response.observed !== 'string' || typeof response.unresolved !== 'string') return response;
  const paragraphs = [
    response.observed.trim() && 'Đối chiếu đoạn đã chọn: ' + response.observed.trim(),
    response.unresolved.trim() && 'Điểm cần xác minh: ' + response.unresolved.trim(),
    typeof response.text === 'string' && response.text.trim()
  ].filter(Boolean);
  return { text: paragraphs.join('\n\n'), evidenceIds: response.evidenceIds };
}

export function materializePatentSpans(patch, spanOptions, { composeResponse = true } = {}) {
  const result = structuredClone(patch);
  if (result.matrix !== undefined) {
    if (!Array.isArray(result.matrix?.rows) || !result.matrix.rows.length || result.matrix.rows.length > 8) throw new CaseError('Ma trận từ mô hình chưa có hàng hợp lệ.', 422);
    const claims = new Map(spanOptions.claim.map(item => [item.id, item]));
    const d1s = new Map(spanOptions.d1.map(item => [item.id, item]));
    result.matrix.rows = result.matrix.rows.map(row => {
      const claim = claims.get(row.claimSpanId);
      const d1 = row.d1SpanId === null ? null : d1s.get(row.d1SpanId);
      if (!claim || (row.d1SpanId !== null && !d1)) throw new CaseError('Mã đoạn trích từ mô hình không thuộc các lựa chọn nguồn đã ghim.', 422);
      return { feature: row.feature, claimQuote: claim.text, d1RecordId: d1?.recordId ?? null,
        d1Quote: d1?.text ?? '', assessment: row.assessment, analysis: row.analysis, missing: row.missing,
        claimSpan: spanMetadata(claim), d1Span: d1 ? spanMetadata(d1) : null };
    });
  }
  if (composeResponse && result.response) result.response = composePatentResponse(result.response);
  return result;
}

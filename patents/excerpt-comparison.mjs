import { prefixPatentSpan, spanMetadata } from './spans.mjs';

// These rules compare short, pinned text. They neither interpret the scope of a
// claim nor determine what an entire publication discloses.
const clean = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim().replace(/\.$/u, '');
const numberWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const binaryQuantity = /\b(\d{1,9}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:[ -]|‑)(bits?|bytes?)\b/gu;
const terminalField = /^The last field of the ([\p{L}\p{N} -]{1,60}) is an? (.{3,150})$/u;
const endsWithField = /^The ([\p{L}\p{N} -]{1,60}) ends with an? (.{3,150}) field$/u;

function normalizeBinary(text) {
  const quantities = [...text.matchAll(binaryQuantity)];
  if (quantities.length !== 1) return null;
  const [quantity, amount, unit] = quantities[0];
  const value = /^\d/u.test(amount) ? Number(amount) : numberWords.indexOf(amount);
  const bits = unit.startsWith('byte') ? value * 8 : value;
  const normalized = text.replace(quantity, `{${bits} bits}`);
  const terminal = normalized.match(terminalField) ?? normalized.match(endsWithField);
  const unitName = unit.startsWith('byte') ? 'byte' : 'bit';
  return { bits, normalized: terminal ? `${terminal[1]}::last-field::${terminal[2]}` : normalized, terminal: Boolean(terminal), unitName };
}

const quantityPattern = /(?<![\p{L}\p{N}])(?<comparator>greater than or equal to|less than or equal to|greater than|less than|at least|at most|no more than|no less than|above|below|over|under|after|before|≥|≤|>=|<=|>|<)\s*(?<number>[+-]?\d+(?:[.,]\d+)?)\s*(?<unit>milliseconds?|seconds?|minutes?|hours?|ms|s|min|Hz|kHz|MHz|GHz|°\s*[CF]|[CF]|mm|cm|nm|μm|µm|Pa|kPa|MPa|V|mV|A|mA|%)(?![\p{L}\p{N}]|[.,]\d)/gu;
const comparatorText = { 'greater than or equal to': 'ít nhất', 'less than or equal to': 'không quá', 'greater than': 'trên',
  'less than': 'dưới', 'at least': 'ít nhất', 'at most': 'không quá', 'no more than': 'không quá', 'no less than': 'ít nhất',
  above: 'trên', below: 'dưới', over: 'trên', under: 'dưới', after: 'sau', before: 'trước', '≥': 'ít nhất', '≤': 'không quá',
  '>=': 'ít nhất', '<=': 'không quá', '>': 'trên', '<': 'dưới' };
const unitText = { second: 'giây', seconds: 'giây', s: 'giây', millisecond: 'mili giây', milliseconds: 'mili giây', ms: 'mili giây',
  minute: 'phút', minutes: 'phút', min: 'phút', hour: 'giờ', hours: 'giờ' };
const quantities = text => [...text.matchAll(quantityPattern)];
const unitOf = ({ unit }) => unitText[unit] ?? (unit ?? '').replace(/\s/gu, '');
const describe = matches => matches.map(({ groups }) =>
  [comparatorText[groups.comparator], groups.number, unitOf(groups)].filter(Boolean).join(' ')).join(', ');
const quantityTemplate = text => text.replace(quantityPattern, '{quantity}');
const exactAmount = amount => amount.replace(/^\+/u, '').replace(/(\.\d*?[1-9])0+$|\.0+$/u, '$1');

const exclusiveState = /\bonly (?:while|when|if)\s+(?:the |an? )?[\p{L}\p{N} -]{1,70} (?:is|are) (on|off|open|closed|enabled|disabled)\b/gu;
const inverse = { on: 'off', off: 'on', open: 'closed', closed: 'open', enabled: 'disabled', disabled: 'enabled' };
const stateText = { on: 'bật', off: 'tắt', open: 'mở', closed: 'đóng', enabled: 'được kích hoạt', disabled: 'bị vô hiệu hóa' };
function stateOf(text) {
  const matches = [...text.matchAll(exclusiveState)];
  if (matches.length !== 1 || /\b(?:not|cannot|never|unless)\b/u.test(text)) return null;
  const [condition, state] = matches[0];
  return { state, template: text.replace(condition, condition.slice(0, -state.length) + '{state}') };
}

function commonMeasuredClause(claimText, d1Text) {
  // Only an identical affirmative quantitative clause before a distinct verb
  // phrase qualifies. The residual phrases are quoted, never treated as proof.
  const compound = /^(.{4,140}\b(?:has|have|includes?|contains?)\b.{3,140}) and ((?:can|cannot|may|is|are|uses?|sits?|rests?|fits?|operates?)\b.{3,150})[.!?]?$/u;
  const claim = claimText.match(compound), d1 = d1Text.match(compound);
  if (!claim || !d1 || claim[1] !== d1[1] || claim[2] === d1[2] || /\b(?:no|not|without|unless|either|or|if|when|and)\b/u.test(claim[1]) ||
      !/\b\d+(?:[.,]\d+)?[ -](?:micrometers?|millimeters?|centimeters?|nanometers?|μm|µm|mm|cm|nm|Hz|kHz|MHz|grams?|kilograms?)\b/u.test(claim[1])) return null;
  return { common: claim[1], claimRemainder: claim[2].replace(/[.!?]$/u, ''), d1Remainder: d1[2].replace(/[.!?]$/u, '') };
}

export function comparePatentExcerpts(claimText, d1Text) {
  if (!claimText || !d1Text || Math.max(claimText.length, d1Text.length) > 360 || /\?/u.test(claimText + d1Text)) return null;
  const claim = clean(claimText), d1 = clean(d1Text);
  const claimQuantities = quantities(claim), d1Quantities = quantities(d1);
  if (claim === d1) {
    const limits = describe(claimQuantities);
    return { kind: 'literal_match', assessment: 'disclosed',
      observed: `Yêu cầu bảo hộ và đoạn D1 đã chọn cùng ghi “${claimText}”${limits ? ` Các điều kiện được ghi là ${limits}.` : ''}`,
      unresolved: '' };
  }
  const claimBinary = normalizeBinary(claim), d1Binary = normalizeBinary(d1);
  if (claimBinary && d1Binary && claimBinary.unitName !== d1Binary.unitName && claimBinary.normalized === d1Binary.normalized) {
    const bits = claimBinary.bits;
    return { kind: 'equivalent_binary_units', assessment: 'disclosed',
      observed: `Yêu cầu bảo hộ ghi “${claimText}” Đoạn D1 đã chọn ghi “${d1Text}” Quy đổi ${bits} bit ÷ 8 = ${bits / 8} byte${claimBinary.terminal ? ', giữ nguyên vị trí trường cuối trong cả hai đoạn' : ''}.`,
      unresolved: '' };
  }
  if (claimQuantities.length && claimQuantities.length === d1Quantities.length && quantityTemplate(claim) === quantityTemplate(d1)) {
    const values = claimQuantities.map(({ groups }, index) => [groups, d1Quantities[index].groups]);
    const sameUnits = values.every(([left, right]) => unitOf(left) === unitOf(right));
    const different = values.some(([left, right]) =>
      comparatorText[left.comparator] !== comparatorText[right.comparator] || exactAmount(left.number) !== exactAmount(right.number));
    const claimLimits = describe(claimQuantities), d1Limits = describe(d1Quantities);
    if (sameUnits && different) return { kind: 'different_explicit_limits', assessment: 'different',
      observed: `Yêu cầu bảo hộ ghi ${claimLimits} (“${claimText}”). Đoạn D1 đã chọn ghi ${d1Limits} (“${d1Text}”). Hai đoạn ghi điều kiện khác nhau.`,
      unresolved: '' };
  }
  const claimState = stateOf(claim), d1State = stateOf(d1);
  if (claimState && d1State && claimState.template === d1State.template && inverse[claimState.state] === d1State.state) {
    return { kind: 'different_exclusive_condition', assessment: 'different',
      observed: `Yêu cầu bảo hộ ghi chỉ khi ở trạng thái ${stateText[claimState.state]} (“${claimText}”). Đoạn D1 đã chọn ghi chỉ khi ở trạng thái ${stateText[d1State.state]} (“${d1Text}”).`,
      unresolved: '' };
  }
  const partial = commonMeasuredClause(claimText, d1Text);
  if (partial) return { kind: 'shared_measured_clause', assessment: 'uncertain', ...partial,
    observed: `Cả yêu cầu bảo hộ và đoạn D1 đã chọn cùng ghi “${partial.common}”.`,
    unresolved: `Yêu cầu bảo hộ còn ghi “${partial.claimRemainder}”. Đoạn D1 đã chọn ghi “${partial.d1Remainder}”. Mô tả này chưa xác nhận điều kiện riêng trong yêu cầu bảo hộ.` };
  return null;
}

const insufficientKind = 'insufficient_excerpt_comparison';
const mentionsD1 = text => /\bD\s*-?\s*1\b/iu.test(text);
const shortStatement = text => text.length <= 240 && !/[\r\n;!?]|\.(?!\d)/u.test(text.replace(/\.$/u, ''));

function confirmedIndependentPair(matter, claim, d1) {
  if (!claim || !d1 || matter.claimRecordId !== claim.recordId || matter.d1RecordIds.length !== 1 ||
      claim.recordId === d1.recordId || !claim.sourceSHA256 || claim.sourceSHA256 === d1.sourceSHA256) return false;
  return [claim, d1].every(span => shortStatement(span.text) && matter.pinnedEvidence.some(({ record, source }) =>
    record.id === span.recordId && record.text === span.text && source.kind === 'case_document' &&
    (record.textFidelity ?? source.textFidelity) === 'pdf_text_user_confirmed'));
}

const artifactPattern = /hình\s+(?:cắt|tách cụm|chiếu)|mặt\s+cắt|sơ\s+đồ(?:\s+hoặc\s+tín\s+hiệu)?|tín\s+hiệu/iu;
const originalPattern = /(?:bản|tài liệu)\s+gốc/iu;
function requestedReviewTarget(instruction, instructionsText, pattern) {
  const actionPattern = /xem|kiểm|đối chiếu|xác minh|chỉ rõ|nêu|tìm/iu;
  for (const value of [instruction, instructionsText]) {
    if (typeof value !== 'string') continue;
    for (const clause of value.split(/[.!?;\n]+/u)) {
      const artifact = clause.match(pattern)?.[0];
      if (artifact && actionPattern.test(clause) && !/không\s+(?:cần|được|dùng|yêu cầu|xem|kiểm)|đừng|bỏ qua/iu.test(clause)) {
        return artifact.toLocaleLowerCase('vi').replace(/\s+/gu, ' ');
      }
    }
  }
  return null;
}

function independentComponentPerUnit(claim, d1) {
  const relation = clean(claim).match(/^(?:each|every) ([\p{L}\p{N} -]{2,65}?) (?:has|includes|contains|uses|is provided with) (?:its own|its separate|an? separate) (?:independently|separately) (?:actuated|controlled) ([\p{L}\p{N} -]{2,65})$/iu);
  if (!relation || /\b(?:each|every|own|independent(?:ly)?|separate(?:ly)?)\b/iu.test(d1)) return null;
  const [, unit, component] = relation;
  const plurals = [unit + 's', unit + 'es', unit.replace(/y$/iu, 'ies')].filter(value => value !== unit);
  const repeatedUnit = new RegExp(`(?<![\\p{L}\\p{N}])(?:${plurals.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
  return repeatedUnit.test(clean(d1)) ? { unit, component } : null;
}

function prospectiveIndependentControl({ unit, component }) {
  return `Xem sơ đồ trong bản gốc, nếu có, để lần từ từng “${unit}” đến “${component}” tương ứng. Kiểm xem mỗi bộ phận có cơ cấu dẫn động hoặc đường tín hiệu điều khiển riêng, cho phép vận hành độc lập hay không.`;
}

function enableAndObservedEvent(claim, d1) {
  const enable = claim.replace(/\.$/u, '').match(/^(.+?)\s+enables\s+(.+)$/iu);
  const sequence = d1.replace(/\.$/u, '').match(/^(.+?)\s+(?:after|when|once)\s+.+$/iu);
  if (!enable || !sequence || !/\b(?:lights|blinks|flashes|illuminates|displays|sounds|indicates|reports|appears)\b/iu.test(sequence[1])) return null;
  return { input: enable[1], output: enable[2], event: sequence[1] };
}

function prospectiveCheck(artifact, claim, d1, modal) {
  if (modal && /sơ đồ|tín hiệu/iu.test(artifact)) {
    return `Đối chiếu ${artifact} để lần theo đường điều khiển từ “${modal.input}” tới tín hiệu cho phép “${modal.output}” hoạt động, nếu có. Kiểm riêng sự kiện “${modal.event}” ghi trong đoạn D1 đã chọn.`;
  }
  return `Xem ${artifact}, nếu có trong bản gốc, để xác định vị trí và kiểm chức năng của bộ phận theo yêu cầu (“${claim}”). Kiểm riêng vị trí và chức năng của bộ phận trong đoạn D1 đã chọn (“${d1}”).`;
}

function withoutInternalCitations(text, matter) {
  if (typeof text !== 'string') return text;
  for (const { record } of matter.pinnedEvidence) {
    if (!/^pdf-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(record.id)) continue;
    text = text.replace(new RegExp(record.id, 'giu'), matter.d1RecordIds.includes(record.id) ? 'đối chứng đã gắn' : 'yêu cầu bảo hộ đã gắn');
  }
  return text;
}

// Preserve the model's scope-bounded observations wherever no rule proves a
// comparison. Disclosed remains a reviewable suggestion, not an attestation.
export function applyPatentExcerptComparison(matter, patch, spanOptions, receipt, instruction) {
  const result = structuredClone(patch);
  const onePair = spanOptions.claim.length === 1 && spanOptions.d1.length === 1;
  const claim = onePair ? spanOptions.claim[0] : null;
  const d1 = onePair ? spanOptions.d1[0] : null;
  const pair = onePair ? comparePatentExcerpts(claim.text, d1.text) : null;
  const needsOriginal = recordIds => matter.pinnedEvidence.some(({ record, source }) => recordIds.includes(record.id) &&
    (/ocr/i.test(record.textFidelity ?? source.textFidelity ?? '') || record.requiresOriginalCheck || source.requiresOriginalCheck));
  const keepOriginalWarning = (row, comparison) => {
    return needsOriginal([row.claimSpan.recordId, row.d1RecordId]) ?
      'Luật sư cần đối chiếu bản gốc vì đoạn này có lớp chữ chưa được kiểm chứng.' : comparison.unresolved;
  };
  const boundedUnknown = !pair && confirmedIndependentPair(matter, claim, d1) && !needsOriginal([claim.recordId, d1.recordId]);
  const modal = boundedUnknown ? enableAndObservedEvent(claim.text, d1.text) : null;
  const independence = boundedUnknown ? independentComponentPerUnit(claim.text, d1.text) : null;
  const observed = boundedUnknown ? `Yêu cầu bảo hộ ghi “${claim.text}” Đoạn D1 đã chọn ghi “${d1.text}”` : '';
  const unresolved = 'Đoạn D1 đã chọn chưa đủ căn cứ xác nhận đặc điểm ghi trong yêu cầu bảo hộ.';
  const response = result.response;
  const responseCanUsePair = response && typeof response.observed === 'string' && typeof response.unresolved === 'string' &&
    Array.isArray(response.evidenceIds) && new Set(response.evidenceIds).size === response.evidenceIds.length &&
    new Set([claim?.recordId, d1?.recordId, ...response.evidenceIds]).size <= 8;
  const responseInScope = boundedUnknown && responseCanUsePair &&
    response.evidenceIds.every(id => [claim.recordId, d1.recordId, 'case:claim', 'case:notice', 'case:instructions'].includes(id));
  const artifact = responseInScope && !result.matrix ? requestedReviewTarget(instruction, matter.instructionsText, artifactPattern) : null;
  const checkIndependence = independence && !result.matrix && requestedReviewTarget(instruction, matter.instructionsText, originalPattern);
  const priorMatrixRun = boundedUnknown && matter.proposals?.findLast(proposal => proposal.targets.includes('matrix'))?.run;
  const priorUncertainty = priorMatrixRun?.excerptComparison?.rowKinds?.includes(insufficientKind) &&
    matter.sections.matrix.rows.some(row => row.d1RecordId === d1.recordId && row.d1Quote === d1.text && row.claimQuote === claim.text);
  let modelNeedsFallback = Boolean(responseInScope && !response.evidenceIds.includes(d1.recordId) &&
    mentionsD1([response.observed, response.unresolved, response.nextCheck ?? response.text].join(' ')));
  if (result.matrix) result.matrix.rows = result.matrix.rows.map(row => {
    if (boundedUnknown && (modal || independence || row.assessment === 'different' || (!row.d1Span &&
        mentionsD1([row.analysis, row.missing].join(' '))))) {
      modelNeedsFallback = true;
      receipt.rowKinds.push(insufficientKind);
      return { ...row, feature: claim.text, d1RecordId: d1.recordId, d1Quote: d1.text, d1Span: spanMetadata(d1),
        assessment: 'uncertain', analysis: observed, missing: unresolved };
    }
    const usedD1 = row.d1Span ? spanOptions.d1.find(span => span.id === row.d1Span.id) :
      pair && row.claimSpan.id === claim.id ? d1 : null;
    const comparison = comparePatentExcerpts(row.claimQuote, usedD1?.text);
    if (!comparison || comparison.kind === 'shared_measured_clause') return row.assessment === 'disclosed'
      ? { ...row, assessment: 'uncertain', missing: row.missing || 'Luật sư cần kiểm đoạn D1 có thể hiện đầy đủ chính dấu hiệu này.' } : row;
    receipt.rowKinds.push(comparison.kind);
    return { ...row, d1RecordId: usedD1.recordId, d1Quote: usedD1.text, d1Span: spanMetadata(usedD1), assessment: comparison.assessment,
      analysis: comparison.observed, missing: keepOriginalWarning({ ...row, d1RecordId: usedD1.recordId }, comparison) };
  });
  if (pair?.kind === 'shared_measured_clause' && result.matrix && claim.text.startsWith(pair.common) && d1.text.startsWith(pair.common)) {
    const [first] = result.matrix.rows;
    result.matrix.rows = [
      { ...first, feature: 'Thông số kỹ thuật trùng trong hai đoạn', claimQuote: pair.common, d1RecordId: d1.recordId,
        claimSpan: spanMetadata(prefixPatentSpan(claim, pair.common, 'claim')), d1Span: spanMetadata(prefixPatentSpan(d1, pair.common, 'd1')),
        d1Quote: pair.common, assessment: 'disclosed', analysis: pair.observed,
        missing: keepOriginalWarning({ ...first, d1RecordId: d1.recordId }, { unresolved: '' }) },
      { ...first, feature: 'Điều kiện kỹ thuật còn cần đối chiếu', claimQuote: claim.text, d1RecordId: d1.recordId,
        claimSpan: spanMetadata(claim), d1Span: spanMetadata(d1), d1Quote: d1.text, assessment: 'uncertain', analysis: pair.unresolved,
        missing: keepOriginalWarning({ ...first, d1RecordId: d1.recordId }, { unresolved: 'Kiểm bản gốc để xác nhận đúng điều kiện ghi trong yêu cầu bảo hộ.' }) }
    ];
    receipt.rowKinds.push(pair.kind);
  }
  if (pair && responseCanUsePair && !needsOriginal([claim.recordId, d1.recordId])) {
    response.observed = pair.observed;
    response.unresolved = pair.unresolved;
    response.evidenceIds = [...new Set([claim.recordId, d1.recordId, ...response.evidenceIds])];
    receipt.responseKind = pair.kind;
  } else if (responseInScope && (modal || modelNeedsFallback || priorUncertainty || artifact || checkIndependence)) {
    response.observed = observed;
    response.unresolved = unresolved;
    response.evidenceIds = [...new Set([claim.recordId, d1.recordId, ...response.evidenceIds])];
    if (checkIndependence) {
      response.nextCheck = prospectiveIndependentControl(independence);
      receipt.perUnitControlCheck = true;
    } else if (artifact) {
      response.nextCheck = prospectiveCheck(artifact, claim.text, d1.text, modal);
      receipt.operatorArtifactCheck = true;
    } else if (result.matrix) {
      const check = independence ?
        `Đối chiếu bản gốc để xác định mỗi “${independence.unit}” có “${independence.component}” riêng và được điều khiển độc lập hay không.` :
        modal ? prospectiveCheck('sơ đồ hoặc tín hiệu', claim.text, d1.text, modal) :
          'Xem hình hoặc mô tả kỹ thuật nếu có trong bản gốc để xác định vị trí và chức năng của từng bộ phận nêu trên.';
      response.text = 'Việc cần kiểm: ' + check;
    }
    receipt.responseKind = insufficientKind;
  }
  if (response) {
    for (const field of ['observed', 'unresolved', 'nextCheck', 'text']) {
      if (typeof response[field] === 'string') response[field] = withoutInternalCitations(response[field], matter);
    }
  }
  return result;
}
